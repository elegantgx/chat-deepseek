package ipc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/elegantgx/chat-deepseek/internal/account"
	"github.com/elegantgx/chat-deepseek/internal/auth"
)

type accountEntry struct {
	ID        string   `json:"id"`
	Username  string   `json:"username"`
	Groups    []string `json:"groups"`
	Disabled  bool     `json:"disabled"`
	CreatedAt string   `json:"createdAt"`
	Self      bool     `json:"self"`
}

type accountListResult struct {
	Accounts []accountEntry `json:"accounts"`
}

type accountAddParams struct {
	Username *string   `json:"username"`
	Password *string   `json:"password"`
	Groups   *[]string `json:"groups"`
}

type accountPasswordParams struct {
	Username *string `json:"username"`
	Password *string `json:"password"`
}

type accountDeleteParams struct {
	Username *string `json:"username"`
}

type okResult struct {
	OK bool `json:"ok"`
}

func (s *Server) accountList(_ json.RawMessage) (any, *rpcError) {
	s.authOp.Lock()
	defer s.authOp.Unlock()

	state, rpcErr := s.authenticate(account.GroupAdmin)
	if rpcErr != nil {
		return nil, rpcErr
	}
	defer state.close()
	users, err := state.accounts.List(context.Background())
	if err != nil {
		return nil, internalError("读取账户列表失败", err)
	}
	entries := make([]accountEntry, 0, len(users))
	for _, user := range users {
		entries = append(entries, accountEntry{
			ID:        user.ID,
			Username:  user.Username,
			Groups:    groupNames(user.Groups),
			Disabled:  user.Disabled,
			CreatedAt: formatRFC3339Millis(user.CreatedAt),
			Self:      user.ID == state.user.ID,
		})
	}
	return accountListResult{Accounts: entries}, nil
}

func (s *Server) accountAdd(params json.RawMessage) (any, *rpcError) {
	payload := accountAddParams{}
	if rpcErr := decodeParams(params, &payload); rpcErr != nil {
		return nil, rpcErr
	}
	if payload.Username == nil || strings.TrimSpace(*payload.Username) == "" {
		return nil, badRequestError("缺少参数 username")
	}
	if payload.Password == nil || *payload.Password == "" {
		return nil, badRequestError("缺少参数 password")
	}
	username := strings.TrimSpace(*payload.Username)
	if err := account.ValidateUsername(username); err != nil {
		return nil, badRequestError("用户名需为 1-64 个字母、数字或 . _ -")
	}
	if rpcErr := validateNewPassword(*payload.Password); rpcErr != nil {
		return nil, rpcErr
	}

	// groups 省略（或空数组）时默认 User；只有真正指定了组才需要 Owner，
	// 与 CLI `user add` 的 `len(groups) > 0` 判断保持一致。
	groups := []account.Group{account.GroupUser}
	groupsSpecified := false
	if payload.Groups != nil {
		parsed, rpcErr := parseGroups(*payload.Groups)
		if rpcErr != nil {
			return nil, rpcErr
		}
		if len(parsed) > 0 {
			groups = parsed
			groupsSpecified = true
		}
	}

	s.authOp.Lock()
	defer s.authOp.Unlock()
	state, rpcErr := s.authenticate(account.GroupAdmin)
	if rpcErr != nil {
		return nil, rpcErr
	}
	defer state.close()
	if groupsSpecified && highestRank(state.user) < account.GroupOwner.Rank() {
		return nil, permissionDeniedError("只有 Owner 可以指定组；Admin 只能创建普通 User")
	}

	hash, err := auth.HashPassword(*payload.Password)
	if err != nil {
		if errors.Is(err, auth.ErrInvalidPassword) {
			return nil, badRequestError("密码至少 8 位")
		}
		return nil, internalError("生成密码哈希失败", err)
	}
	if _, err := state.accounts.Create(context.Background(), username, hash, groups); err != nil {
		switch {
		case errors.Is(err, account.ErrUsernameTaken):
			return nil, conflictError("用户名已存在：" + clip(username, 80))
		case errors.Is(err, account.ErrInvalidUser):
			return nil, badRequestError("用户名需为 1-64 个字母、数字或 . _ -")
		case errors.Is(err, account.ErrInvalidGroup):
			return nil, badRequestError("未知组")
		}
		return nil, internalError("创建账户失败", err)
	}
	return okResult{OK: true}, nil
}

func (s *Server) accountPassword(params json.RawMessage) (any, *rpcError) {
	payload := accountPasswordParams{}
	if rpcErr := decodeParams(params, &payload); rpcErr != nil {
		return nil, rpcErr
	}
	if payload.Username == nil || strings.TrimSpace(*payload.Username) == "" {
		return nil, badRequestError("缺少参数 username")
	}
	if payload.Password == nil || *payload.Password == "" {
		return nil, badRequestError("缺少参数 password")
	}
	if rpcErr := validateNewPassword(*payload.Password); rpcErr != nil {
		return nil, rpcErr
	}
	username := strings.TrimSpace(*payload.Username)

	s.authOp.Lock()
	defer s.authOp.Unlock()
	state, rpcErr := s.authenticate(account.GroupAdmin)
	if rpcErr != nil {
		return nil, rpcErr
	}
	defer state.close()
	ctx := context.Background()
	target, err := state.accounts.GetByUsername(ctx, username)
	if err != nil {
		if errors.Is(err, account.ErrUserNotFound) {
			return nil, notFoundError("账户不存在：" + clip(username, 80))
		}
		return nil, internalError("读取账户失败", err)
	}
	if rpcErr := canOperate(state.user, target); rpcErr != nil {
		return nil, rpcErr
	}
	hash, err := auth.HashPassword(*payload.Password)
	if err != nil {
		if errors.Is(err, auth.ErrInvalidPassword) {
			return nil, badRequestError("密码至少 8 位")
		}
		return nil, internalError("生成密码哈希失败", err)
	}
	if err := state.accounts.SetPassword(ctx, target.ID, hash); err != nil {
		if errors.Is(err, account.ErrUserNotFound) {
			return nil, notFoundError("账户不存在：" + clip(username, 80))
		}
		return nil, internalError("更新密码失败", err)
	}
	// 与 CLI reset-password 一致：改密后吊销目标账户的全部登录会话。
	if err := state.sessions.DeleteByUser(ctx, target.ID); err != nil {
		return nil, internalError("吊销登录会话失败", err)
	}
	if target.ID == state.user.ID {
		// 当前 ipc 进程的 token 也被吊销了，清掉文件避免下次请求再走一遍失效流程。
		s.removeOwnSession()
	}
	return okResult{OK: true}, nil
}

func (s *Server) accountDelete(params json.RawMessage) (any, *rpcError) {
	payload := accountDeleteParams{}
	if rpcErr := decodeParams(params, &payload); rpcErr != nil {
		return nil, rpcErr
	}
	if payload.Username == nil || strings.TrimSpace(*payload.Username) == "" {
		return nil, badRequestError("缺少参数 username")
	}
	username := strings.TrimSpace(*payload.Username)

	s.authOp.Lock()
	defer s.authOp.Unlock()
	state, rpcErr := s.authenticate(account.GroupAdmin)
	if rpcErr != nil {
		return nil, rpcErr
	}
	defer state.close()
	ctx := context.Background()
	target, err := state.accounts.GetByUsername(ctx, username)
	if err != nil {
		if errors.Is(err, account.ErrUserNotFound) {
			return nil, notFoundError("账户不存在：" + clip(username, 80))
		}
		return nil, internalError("读取账户失败", err)
	}
	if rpcErr := canOperate(state.user, target); rpcErr != nil {
		return nil, rpcErr
	}
	if target.ID == state.user.ID {
		return nil, permissionDeniedError("不能删除自己")
	}
	if err := state.accounts.Delete(ctx, target.ID); err != nil {
		switch {
		case errors.Is(err, account.ErrUserNotFound):
			return nil, notFoundError("账户不存在：" + clip(username, 80))
		case errors.Is(err, account.ErrLastOwner):
			return nil, permissionDeniedError("不能删除最后一名活动 Owner")
		}
		return nil, internalError("删除账户失败", err)
	}
	return okResult{OK: true}, nil
}

// canOperate 要求操作者权限严格高于目标账户；Owner 可以操作任何账户。
func canOperate(operator, target *account.User) *rpcError {
	if highestRank(operator) >= account.GroupOwner.Rank() {
		return nil
	}
	if highestRank(target) >= highestRank(operator) {
		return permissionDeniedError(fmt.Sprintf("只有 Owner 可以操作 %s 账户", target.Username))
	}
	return nil
}

func parseGroups(values []string) ([]account.Group, *rpcError) {
	groups := make([]account.Group, 0, len(values))
	for _, value := range values {
		group, ok := account.ParseGroup(value)
		if !ok {
			return nil, badRequestError(fmt.Sprintf(
				"未知组 %q（可用：User、Admin、Owner）",
				clip(value, 80),
			))
		}
		groups = append(groups, group)
	}
	return groups, nil
}

func validateNewPassword(password string) *rpcError {
	if err := auth.ValidatePassword(password); err != nil {
		return badRequestError("密码至少 8 位")
	}
	return nil
}

// decodeParams 只接受 JSON 对象；未知字段由 encoding/json 忽略，便于向前兼容。
func decodeParams(params json.RawMessage, target any) *rpcError {
	trimmed := strings.TrimSpace(string(params))
	if trimmed == "" || trimmed == "null" {
		return badRequestError("缺少参数")
	}
	if err := json.Unmarshal(params, target); err != nil {
		return badRequestError("参数必须是 JSON 对象")
	}
	return nil
}
