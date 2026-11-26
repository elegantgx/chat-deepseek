package ipc

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/elegantgx/chat-deepseek/internal/account"
	"github.com/elegantgx/chat-deepseek/internal/auth"
	"github.com/elegantgx/chat-deepseek/internal/config"
	"github.com/elegantgx/chat-deepseek/internal/database"
)

// authIdentity 是 auth.whoami / auth.login 的返回形状。
// 未登录时只输出 authenticated:false，不能带出任何账户信息。
type authIdentity struct {
	Authenticated bool     `json:"authenticated"`
	Username      string   `json:"username,omitempty"`
	Groups        []string `json:"groups,omitempty"`
	ExpiresAt     string   `json:"expiresAt,omitempty"`
}

type authLogoutResult struct {
	OK bool `json:"ok"`
}

type authLoginParams struct {
	Username *string `json:"username"`
	Password *string `json:"password"`
}

// sessionRenewer 是滑动续期的实现签名；测试可替换以验证续期失败时的降级。
type sessionRenewer func(db *sql.DB, file *ipcSession, session *auth.Session, now time.Time) (int64, error)

// authState 是一次已认证请求持有的数据库句柄与账户信息。
// 调用方必须 defer state.close()。
type authState struct {
	db        *sql.DB
	accounts  *account.Store
	sessions  *auth.SessionStore
	user      *account.User
	expiresAt int64
}

func (a *authState) close() {
	if a.db != nil {
		_ = a.db.Close()
	}
}

var errStoreNotInitialized = errors.New("数据目录尚未初始化")

// openExistingDatabase 只打开已初始化的数据目录，避免读操作凭空创建数据库。
func openExistingDatabase(dir string) (*sql.DB, error) {
	if _, err := os.Stat(config.DatabasePath(dir)); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("%w：%s；先运行 chat-deepseek setup 或 backup restore", errStoreNotInitialized, dir)
		}
		return nil, fmt.Errorf("检查数据库文件失败: %w", err)
	}
	return database.Open(dir)
}

func identityFor(user *account.User, expiresAt int64) authIdentity {
	return authIdentity{
		Authenticated: true,
		Username:      user.Username,
		Groups:        groupNames(user.Groups),
		ExpiresAt:     formatRFC3339Millis(expiresAt),
	}
}

func formatRFC3339Millis(millis int64) string {
	return time.UnixMilli(millis).Format(time.RFC3339)
}

// authenticate 校验当前 ipc 进程的会话文件、数据库会话和账户状态，
// 再按 CLI 的规则检查最小权限。调用方必须持有 s.authOp。
func (s *Server) authenticate(minimum account.Group) (*authState, *rpcError) {
	file, err := s.readOwnSession()
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			// 损坏的会话文件直接清掉，避免挡住下一次 login。
			s.removeOwnSession()
		}
		return nil, unauthenticatedError("需要先登录")
	}
	if !sameFilePath(file.DataDir, s.dataDir) {
		return nil, unauthenticatedError(fmt.Sprintf(
			"当前登录的数据目录是 %s，本次请求指向 %s；请重新登录",
			file.DataDir,
			s.dataDir,
		))
	}
	now := s.now()
	if file.ExpiresAt <= now.UnixMilli() {
		s.removeOwnSession()
		return nil, unauthenticatedError("登录已过期，请重新登录")
	}

	db, err := openExistingDatabase(s.dataDir)
	if err != nil {
		s.removeOwnSession()
		if errors.Is(err, errStoreNotInitialized) {
			return nil, unauthenticatedError("登录已失效，请重新登录")
		}
		return nil, internalError("打开数据库失败", err)
	}
	sessions := auth.NewSessionStore(db)
	ctx := context.Background()
	session, err := sessions.GetByTokenHash(ctx, auth.ScopeCLI, auth.HashToken(file.Token))
	if err != nil {
		_ = db.Close()
		s.removeOwnSession()
		if errors.Is(err, auth.ErrSessionNotFound) {
			return nil, unauthenticatedError("登录已失效，请重新登录")
		}
		return nil, internalError("读取登录会话失败", err)
	}
	if session.ExpiresAt <= now.UnixMilli() {
		_ = sessions.Delete(ctx, session.ID)
		_ = db.Close()
		s.removeOwnSession()
		return nil, unauthenticatedError("登录已过期，请重新登录")
	}
	accounts := account.NewStore(db)
	user, err := accounts.GetByID(ctx, session.UserID)
	if err != nil || user.Disabled {
		_ = db.Close()
		s.removeOwnSession()
		if err != nil && !errors.Is(err, account.ErrUserNotFound) {
			return nil, internalError("读取登录账户失败", err)
		}
		return nil, unauthenticatedError("登录已失效，请重新登录")
	}
	if highestRank(user) < minimum.Rank() {
		_ = db.Close()
		return nil, permissionDeniedError(requiredGroupMessage(minimum))
	}
	expiresAt := session.ExpiresAt
	// 滑动续期：只要这次请求通过了认证与权限检查，就把会话续到 now+TTL。
	// 刷新失败不改变本次请求的结果，退回旧有效期（TTL 只是兜底）。
	renew := s.renewSession
	if s.renewHook != nil {
		renew = s.renewHook
	}
	if renewed, err := renew(db, file, session, now); err != nil {
		s.logf("刷新登录态失败: %v", err)
	} else {
		expiresAt = renewed
	}
	return &authState{
		db:        db,
		accounts:  accounts,
		sessions:  sessions,
		user:      user,
		expiresAt: expiresAt,
	}, nil
}

// renewSession 同时更新数据库会话和本地会话文件的过期时间。
// 先写数据库再写文件：即使文件写失败，下一次请求仍会按数据库里的有效期重新续期。
func (s *Server) renewSession(
	db *sql.DB,
	file *ipcSession,
	session *auth.Session,
	now time.Time,
) (int64, error) {
	expiresAt := now.Add(s.sessionTTL).UnixMilli()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := db.ExecContext(
		ctx,
		`UPDATE auth_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?`,
		now.UnixMilli(),
		expiresAt,
		session.ID,
	); err != nil {
		return 0, fmt.Errorf("更新数据库会话: %w", err)
	}
	renewed := *file
	renewed.ExpiresAt = expiresAt
	if err := s.writeOwnSession(&renewed); err != nil {
		return 0, err
	}
	return expiresAt, nil
}

func requiredGroupMessage(minimum account.Group) string {
	if minimum == account.GroupAdmin {
		return "需要 Admin 或 Owner 权限"
	}
	return fmt.Sprintf("需要 %s 权限", minimum)
}

func highestRank(user *account.User) int {
	rank := 0
	for _, group := range user.Groups {
		if value := group.Rank(); value > rank {
			rank = value
		}
	}
	return rank
}

func groupNames(groups []account.Group) []string {
	names := make([]string, 0, len(groups))
	for _, group := range groups {
		names = append(names, string(group))
	}
	return names
}

func (s *Server) authWhoami() (any, *rpcError) {
	s.authOp.Lock()
	defer s.authOp.Unlock()

	// 空组表示只要求“已登录”，不额外要求管理权限。
	state, rpcErr := s.authenticate(account.Group(""))
	if rpcErr != nil {
		if rpcErr.Code == codeUnauthenticated {
			return authIdentity{Authenticated: false}, nil
		}
		return nil, rpcErr
	}
	defer state.close()
	return identityFor(state.user, state.expiresAt), nil
}

func (s *Server) authLogin(params json.RawMessage) (any, *rpcError) {
	payload := authLoginParams{}
	trimmed := strings.TrimSpace(string(params))
	if trimmed != "" && trimmed != "null" {
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, badRequestError("参数必须是 JSON 对象，包含 username 和 password")
		}
	}
	if payload.Username == nil || strings.TrimSpace(*payload.Username) == "" {
		return nil, badRequestError("缺少参数 username")
	}
	if payload.Password == nil || *payload.Password == "" {
		return nil, badRequestError("缺少参数 password")
	}
	if len(*payload.Password) > auth.MaxPasswordLength {
		return nil, badRequestError("密码过长")
	}
	username := strings.TrimSpace(*payload.Username)
	password := *payload.Password

	s.authOp.Lock()
	defer s.authOp.Unlock()

	db, err := openExistingDatabase(s.dataDir)
	if err != nil {
		return nil, internalError("打开数据库失败", err)
	}
	defer func() { _ = db.Close() }()
	ctx := context.Background()
	accounts := account.NewStore(db)
	user, err := accounts.GetByUsername(ctx, username)
	if err != nil {
		if errors.Is(err, account.ErrUserNotFound) {
			// 与 CLI 一致：不存在的用户名也消耗一次哈希时间，降低枚举风险。
			auth.VerifyDummy(password)
			return nil, unauthenticatedError("账户不存在")
		}
		return nil, internalError("读取账户失败", err)
	}
	valid, err := accounts.VerifyPassword(ctx, user.ID, password)
	if err != nil {
		return nil, internalError("校验密码失败", err)
	}
	if !valid {
		return nil, unauthenticatedError("密码错误")
	}
	if user.Disabled {
		return nil, unauthenticatedError("账户已被禁用")
	}
	if highestRank(user) < account.GroupAdmin.Rank() {
		return nil, permissionDeniedError("该账户没有 CLI 管理权限")
	}

	now := s.now()
	sessions := auth.NewSessionStore(db)
	// 顺手清掉过期会话行；登录是低频操作，不会造成明显抖动。
	_, _ = sessions.DeleteExpired(ctx, now)
	token, tokenHash, _, err := auth.NewSessionSecrets()
	if err != nil {
		return nil, internalError("生成登录令牌失败", err)
	}
	session, err := sessions.Create(ctx, auth.SessionParams{
		UserID:    user.ID,
		TokenHash: tokenHash,
		Scope:     auth.ScopeCLI,
		UserAgent: "chat-deepseek ipc",
		TTL:       s.sessionTTL,
	}, now)
	if err != nil {
		return nil, internalError("创建登录会话失败", err)
	}
	// 同一个 ipc 进程重新 login 时清掉旧会话，避免数据库里留下孤儿行。
	if previous, err := s.readOwnSession(); err == nil {
		if old, err := sessions.GetByTokenHash(
			ctx,
			auth.ScopeCLI,
			auth.HashToken(previous.Token),
		); err == nil {
			_ = sessions.Delete(ctx, old.ID)
		}
	}
	if err := s.writeOwnSession(&ipcSession{
		DataDir:   s.dataDir,
		UserID:    user.ID,
		Username:  user.Username,
		Token:     token,
		ExpiresAt: session.ExpiresAt,
	}); err != nil {
		_ = sessions.Delete(ctx, session.ID)
		return nil, internalError("保存登录态失败", err)
	}
	s.cleanupExpiredSessionFiles(now)
	return identityFor(user, session.ExpiresAt), nil
}

// cleanupOwnSessionOnExit 在 Serve 退出时 best-effort 吊销本进程的会话：
// 删除数据库行和本地会话文件。任何失败只写 stderr，不影响进程退出码。
func (s *Server) cleanupOwnSessionOnExit() {
	file, err := s.readOwnSession()
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			s.removeOwnSession()
		}
		return
	}
	db, err := openExistingDatabase(s.dataDir)
	if err != nil {
		s.logf("清理登录态失败: %v", err)
		s.removeOwnSession()
		return
	}
	ctx := context.Background()
	sessions := auth.NewSessionStore(db)
	session, err := sessions.GetByTokenHash(ctx, auth.ScopeCLI, auth.HashToken(file.Token))
	switch {
	case err == nil:
		if err := sessions.Delete(ctx, session.ID); err != nil {
			s.logf("清理登录会话失败: %v", err)
		}
	case !errors.Is(err, auth.ErrSessionNotFound):
		s.logf("查找登录会话失败: %v", err)
	}
	_ = db.Close()
	s.removeOwnSession()
}

// authLogout 是幂等的：没有登录态也返回 ok，数据库不可用时仍会清掉本地文件。
func (s *Server) authLogout(_ json.RawMessage) (any, *rpcError) {
	s.authOp.Lock()
	defer s.authOp.Unlock()

	if file, err := s.readOwnSession(); err == nil {
		if db, err := openExistingDatabase(s.dataDir); err == nil {
			ctx := context.Background()
			sessions := auth.NewSessionStore(db)
			if session, err := sessions.GetByTokenHash(
				ctx,
				auth.ScopeCLI,
				auth.HashToken(file.Token),
			); err == nil {
				_ = sessions.Delete(ctx, session.ID)
			}
			_ = db.Close()
		}
	}
	s.removeOwnSession()
	return authLogoutResult{OK: true}, nil
}
