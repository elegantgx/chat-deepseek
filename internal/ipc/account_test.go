package ipc

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/elegantgx/chat-deepseek/internal/account"
)

func accountEntries(t *testing.T, server *Server) map[string]accountEntry {
	t.Helper()
	value, rpcErr := server.accountList(nil)
	if rpcErr != nil {
		t.Fatalf("account.list: %+v", rpcErr)
	}
	result := value.(accountListResult)
	entries := make(map[string]accountEntry, len(result.Accounts))
	for _, entry := range result.Accounts {
		entries[entry.Username] = entry
	}
	return entries
}

func TestAccountListAndSelf(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	seedAccount(t, dir, "admin", []account.Group{account.GroupAdmin})
	seedAccount(t, dir, "owner", []account.Group{account.GroupOwner})
	seedDisabledAccount(t, dir, "zoe")
	loginAs(t, server, "admin", testAccountPassword)

	value, rpcErr := server.accountList(nil)
	if rpcErr != nil {
		t.Fatalf("account.list: %+v", rpcErr)
	}
	result := value.(accountListResult)
	if len(result.Accounts) != 3 {
		t.Fatalf("accounts = %+v", result.Accounts)
	}
	for i := 1; i < len(result.Accounts); i++ {
		if result.Accounts[i-1].Username > result.Accounts[i].Username {
			t.Fatalf("账户未按用户名排序: %+v", result.Accounts)
		}
	}
	entries := make(map[string]accountEntry, len(result.Accounts))
	for _, entry := range result.Accounts {
		entries[entry.Username] = entry
		if _, err := time.Parse(time.RFC3339, entry.CreatedAt); err != nil {
			t.Fatalf("%s createdAt = %q: %v", entry.Username, entry.CreatedAt, err)
		}
		if entry.ID == "" {
			t.Fatalf("%s 缺少 id", entry.Username)
		}
		if entry.Username != "admin" && entry.Self {
			t.Fatalf("%s self=true，只有当前会话用户应为 self", entry.Username)
		}
		if entry.Username == "admin" && !entry.Self {
			t.Fatal("当前会话用户应为 self")
		}
	}
	if got := entries["admin"].Groups; len(got) != 2 || got[0] != "User" || got[1] != "Admin" {
		t.Fatalf("admin groups = %v", got)
	}
	if got := entries["owner"].Groups; len(got) != 2 || got[0] != "User" || got[1] != "Owner" {
		t.Fatalf("owner groups = %v", got)
	}
	if !entries["zoe"].Disabled {
		t.Fatal("zoe 应为 disabled")
	}
	data, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("序列化: %v", err)
	}
	for _, forbidden := range []string{"password", "hash", "token", "secret"} {
		if strings.Contains(strings.ToLower(string(data)), forbidden) {
			t.Fatalf("account.list 不应包含 %q: %s", forbidden, data)
		}
	}
}

func TestAccountAddGroupsAndConflict(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	seedAccount(t, dir, "owner", []account.Group{account.GroupOwner})
	loginAs(t, server, "owner", testAccountPassword)

	// 省略 groups 默认 User。
	value, rpcErr := server.accountAdd(jsonParams(t, map[string]any{
		"username": "alice",
		"password": "alice-password",
	}))
	if rpcErr != nil || !value.(okResult).OK {
		t.Fatalf("account.add alice = %+v / %+v", value, rpcErr)
	}
	// 组名大小写不敏感，输出规范名并去重。
	value, rpcErr = server.accountAdd(jsonParams(t, map[string]any{
		"username": "bob",
		"password": "bob-password",
		"groups":   []string{"admin", "Admin"},
	}))
	if rpcErr != nil || !value.(okResult).OK {
		t.Fatalf("account.add bob = %+v / %+v", value, rpcErr)
	}

	entries := accountEntries(t, server)
	if got := entries["alice"].Groups; len(got) != 1 || got[0] != "User" {
		t.Fatalf("alice groups = %v", got)
	}
	if got := entries["bob"].Groups; len(got) != 2 || got[0] != "User" || got[1] != "Admin" {
		t.Fatalf("bob groups = %v", got)
	}

	_, rpcErr = server.accountAdd(jsonParams(t, map[string]any{
		"username": "BOB",
		"password": "bob-password",
	}))
	if rpcErr == nil || rpcErr.Code != codeConflict {
		t.Fatalf("重复用户名 = %+v，期望 conflict", rpcErr)
	}

	badCases := []struct {
		name    string
		params  map[string]any
		message string
	}{
		{"bad-username", map[string]any{"username": "bad name", "password": "password123"}, "用户名需为"},
		{"short-password", map[string]any{"username": "carol", "password": "short"}, "密码至少 8 位"},
		{"unknown-group", map[string]any{"username": "carol", "password": "password123", "groups": []string{"Super"}}, "未知组"},
		{"missing-username", map[string]any{"password": "password123"}, "缺少参数 username"},
		{"missing-password", map[string]any{"username": "carol"}, "缺少参数 password"},
	}
	for _, tc := range badCases {
		t.Run(tc.name, func(t *testing.T) {
			_, rpcErr := server.accountAdd(jsonParams(t, tc.params))
			if rpcErr == nil || rpcErr.Code != codeBadRequest {
				t.Fatalf("error = %+v，期望 bad_request", rpcErr)
			}
			if !strings.Contains(rpcErr.Message, tc.message) {
				t.Fatalf("message = %q，期望包含 %q", rpcErr.Message, tc.message)
			}
			if strings.Contains(rpcErr.Message, "password123") {
				t.Fatalf("错误信息不能包含密码: %q", rpcErr.Message)
			}
		})
	}
	if _, rpcErr := server.accountAdd(json.RawMessage(`{"username":"carol","password":12345678}`)); rpcErr == nil || rpcErr.Code != codeBadRequest {
		t.Fatalf("错误类型 password = %+v，期望 bad_request", rpcErr)
	}
}

func TestAccountGroupsRequireOwner(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	seedAccount(t, dir, "admin", []account.Group{account.GroupAdmin})
	loginAs(t, server, "admin", testAccountPassword)

	_, rpcErr := server.accountAdd(jsonParams(t, map[string]any{
		"username": "alice",
		"password": "alice-password",
		"groups":   []string{"User"},
	}))
	if rpcErr == nil || rpcErr.Code != codePermissionDenied {
		t.Fatalf("指定 groups = %+v，期望 permission_denied", rpcErr)
	}
	if rpcErr.Message != "只有 Owner 可以指定组；Admin 只能创建普通 User" {
		t.Fatalf("message = %q", rpcErr.Message)
	}
	if _, ok := accountEntries(t, server)["alice"]; ok {
		t.Fatal("权限不足时不应创建账户")
	}

	// 不传 groups（或传空数组）时 Admin 可以创建普通 User。
	value, rpcErr := server.accountAdd(jsonParams(t, map[string]any{
		"username": "alice",
		"password": "alice-password",
		"groups":   []string{},
	}))
	if rpcErr != nil || !value.(okResult).OK {
		t.Fatalf("groups=[]: %+v / %+v", value, rpcErr)
	}
	value, rpcErr = server.accountAdd(jsonParams(t, map[string]any{
		"username": "bob",
		"password": "bob-password",
	}))
	if rpcErr != nil || !value.(okResult).OK {
		t.Fatalf("省略 groups: %+v / %+v", value, rpcErr)
	}
	if got := accountEntries(t, server)["alice"].Groups; len(got) != 1 || got[0] != "User" {
		t.Fatalf("alice groups = %v", got)
	}
}

func TestAccountPasswordResetAndRevocation(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	seedAccount(t, dir, "owner", []account.Group{account.GroupOwner})
	seedAccount(t, dir, "admin", []account.Group{account.GroupAdmin})
	loginAs(t, server, "owner", testAccountPassword)

	// 先建一个普通账户。
	if _, rpcErr := server.accountAdd(jsonParams(t, map[string]any{
		"username": "alice",
		"password": "alice-password",
	})); rpcErr != nil {
		t.Fatalf("account.add: %+v", rpcErr)
	}

	const newPassword = "alice-new-password"
	value, rpcErr := server.accountPassword(jsonParams(t, map[string]any{
		"username": "alice",
		"password": newPassword,
	}))
	if rpcErr != nil || !value.(okResult).OK {
		t.Fatalf("account.password = %+v / %+v", value, rpcErr)
	}

	db, err := openExistingDatabase(dir)
	if err != nil {
		t.Fatalf("打开数据库: %v", err)
	}
	accounts := account.NewStore(db)
	alice, err := accounts.GetByUsername(context.Background(), "alice")
	if err != nil {
		_ = db.Close()
		t.Fatalf("读取 alice: %v", err)
	}
	valid, err := accounts.VerifyPassword(context.Background(), alice.ID, newPassword)
	if err != nil || !valid {
		_ = db.Close()
		t.Fatalf("新密码校验失败: %v / %v", valid, err)
	}
	old, err := accounts.VerifyPassword(context.Background(), alice.ID, "alice-password")
	if err != nil || old {
		_ = db.Close()
		t.Fatalf("旧密码仍可用: %v / %v", old, err)
	}
	_ = db.Close()

	if _, rpcErr := server.accountPassword(jsonParams(t, map[string]any{
		"username": "nobody",
		"password": newPassword,
	})); rpcErr == nil || rpcErr.Code != codeNotFound {
		t.Fatalf("不存在账户 = %+v，期望 not_found", rpcErr)
	}
	if _, rpcErr := server.accountPassword(jsonParams(t, map[string]any{
		"username": "alice",
		"password": "short",
	})); rpcErr == nil || rpcErr.Code != codeBadRequest {
		t.Fatalf("过短密码 = %+v，期望 bad_request", rpcErr)
	}

	// Admin 不能重置同级或更高权限账户。
	if _, rpcErr := server.authLogout(nil); rpcErr != nil {
		t.Fatalf("logout: %+v", rpcErr)
	}
	loginAs(t, server, "admin", testAccountPassword)
	if _, rpcErr := server.accountPassword(jsonParams(t, map[string]any{
		"username": "owner",
		"password": newPassword,
	})); rpcErr == nil || rpcErr.Code != codePermissionDenied ||
		rpcErr.Message != "只有 Owner 可以操作 owner 账户" {
		t.Fatalf("Admin 重置 Owner = %+v", rpcErr)
	}
	if _, rpcErr := server.accountPassword(jsonParams(t, map[string]any{
		"username": "admin",
		"password": newPassword,
	})); rpcErr == nil || rpcErr.Code != codePermissionDenied {
		t.Fatalf("Admin 重置自己 = %+v，期望 permission_denied", rpcErr)
	}

	// Owner 可以改自己的密码；改密会吊销全部会话，当前 whoami 立即失效。
	if _, rpcErr := server.authLogout(nil); rpcErr != nil {
		t.Fatalf("logout: %+v", rpcErr)
	}
	loginAs(t, server, "owner", testAccountPassword)
	value, rpcErr = server.accountPassword(jsonParams(t, map[string]any{
		"username": "owner",
		"password": "owner-new-password",
	}))
	if rpcErr != nil || !value.(okResult).OK {
		t.Fatalf("Owner 重置自己 = %+v / %+v", value, rpcErr)
	}
	who, rpcErr := server.authWhoami()
	if rpcErr != nil || who.(authIdentity).Authenticated {
		t.Fatalf("改密后 whoami = %+v / %+v", who, rpcErr)
	}
	if _, err := server.readOwnSession(); err == nil {
		t.Fatal("改密吊销会话后应删除本地会话文件")
	}
}

func TestAccountDeletePermissions(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	seedAccount(t, dir, "owner", []account.Group{account.GroupOwner})
	seedAccount(t, dir, "admin", []account.Group{account.GroupAdmin})
	loginAs(t, server, "owner", testAccountPassword)

	if _, rpcErr := server.accountAdd(jsonParams(t, map[string]any{
		"username": "alice",
		"password": "alice-password",
	})); rpcErr != nil {
		t.Fatalf("account.add: %+v", rpcErr)
	}
	value, rpcErr := server.accountDelete(jsonParams(t, map[string]any{"username": "alice"}))
	if rpcErr != nil || !value.(okResult).OK {
		t.Fatalf("account.delete = %+v / %+v", value, rpcErr)
	}
	if _, ok := accountEntries(t, server)["alice"]; ok {
		t.Fatal("alice 应已删除")
	}
	if _, rpcErr := server.accountDelete(jsonParams(t, map[string]any{"username": "alice"})); rpcErr == nil || rpcErr.Code != codeNotFound {
		t.Fatalf("删除不存在账户 = %+v，期望 not_found", rpcErr)
	}
	if _, rpcErr := server.accountDelete(jsonParams(t, map[string]any{"username": "owner"})); rpcErr == nil ||
		rpcErr.Code != codePermissionDenied || rpcErr.Message != "不能删除自己" {
		t.Fatalf("Owner 删除自己 = %+v", rpcErr)
	}
	// Owner 可以删除 Admin。
	if _, rpcErr := server.accountDelete(jsonParams(t, map[string]any{"username": "admin"})); rpcErr != nil {
		t.Fatalf("Owner 删除 Admin: %+v", rpcErr)
	}

	// Admin 不能删除 Owner，也不能删除同级账户。
	seedAccount(t, dir, "admin2", []account.Group{account.GroupAdmin})
	if _, rpcErr := server.authLogout(nil); rpcErr != nil {
		t.Fatalf("logout: %+v", rpcErr)
	}
	loginAs(t, server, "admin2", testAccountPassword)
	if _, rpcErr := server.accountDelete(jsonParams(t, map[string]any{"username": "owner"})); rpcErr == nil ||
		rpcErr.Code != codePermissionDenied || rpcErr.Message != "只有 Owner 可以操作 owner 账户" {
		t.Fatalf("Admin 删除 Owner = %+v", rpcErr)
	}
	if _, rpcErr := server.accountDelete(jsonParams(t, map[string]any{"username": "admin2"})); rpcErr == nil ||
		rpcErr.Code != codePermissionDenied || rpcErr.Message != "只有 Owner 可以操作 admin2 账户" {
		t.Fatalf("Admin 删除自己 = %+v", rpcErr)
	}
}

func TestAccountParamsBadRequest(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	seedAccount(t, dir, "owner", []account.Group{account.GroupOwner})
	loginAs(t, server, "owner", testAccountPassword)

	for name, params := range map[string]string{
		"add-empty":      `{}`,
		"password-empty": `{}`,
		"delete-empty":   `{}`,
		"add-not-object": `[]`,
	} {
		var call func(json.RawMessage) (any, *rpcError)
		switch {
		case strings.HasPrefix(name, "add"):
			call = server.accountAdd
		case strings.HasPrefix(name, "password"):
			call = server.accountPassword
		default:
			call = server.accountDelete
		}
		_, rpcErr := call(json.RawMessage(params))
		if rpcErr == nil || rpcErr.Code != codeBadRequest {
			t.Fatalf("%s error = %+v，期望 bad_request", name, rpcErr)
		}
	}
}
