package ipc

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/elegantgx/chat-deepseek/internal/account"
	"github.com/elegantgx/chat-deepseek/internal/auth"
	"github.com/elegantgx/chat-deepseek/internal/database"
)

// testAccountPassword 是所有认证测试共用的明文密码；用同一个 Argon2 哈希，
// 避免每个用例都生成一次 64 MiB 内存的哈希。
const testAccountPassword = "password123"

var testHashOnce struct {
	sync.Once
	value string
	err   error
}

func testPasswordHash(t *testing.T) string {
	t.Helper()
	testHashOnce.Do(func() {
		testHashOnce.value, testHashOnce.err = auth.HashPassword(testAccountPassword)
	})
	if testHashOnce.err != nil {
		t.Fatalf("生成测试密码哈希: %v", testHashOnce.err)
	}
	return testHashOnce.value
}

// seedAccount 直接写数据库创建账户，跳过 IPC 参数校验，便于精确构造边界状态。
func seedAccount(t *testing.T, dir, username string, groups []account.Group) *account.User {
	t.Helper()
	db, err := database.Open(dir)
	if err != nil {
		t.Fatalf("打开测试数据库: %v", err)
	}
	defer func() { _ = db.Close() }()
	user, err := account.NewStore(db).Create(
		context.Background(),
		username,
		testPasswordHash(t),
		groups,
	)
	if err != nil {
		t.Fatalf("创建测试账户 %s: %v", username, err)
	}
	return user
}

func seedDisabledAccount(t *testing.T, dir, username string) *account.User {
	t.Helper()
	user := seedAccount(t, dir, username, nil)
	db, err := database.Open(dir)
	if err != nil {
		t.Fatalf("打开测试数据库: %v", err)
	}
	defer func() { _ = db.Close() }()
	if err := account.NewStore(db).SetDisabled(context.Background(), user.ID, true); err != nil {
		t.Fatalf("禁用测试账户: %v", err)
	}
	return user
}

// seedOwnerMarkers 只保证数据库里存在活动 Owner，供 service.install 初始化检查使用。
func seedActiveOwner(t *testing.T, dir string) {
	t.Helper()
	db, err := database.Open(dir)
	if err != nil {
		t.Fatalf("打开测试数据库: %v", err)
	}
	defer func() { _ = db.Close() }()
	if _, err := account.NewStore(db).Create(
		context.Background(),
		"owner",
		"test-password-hash",
		[]account.Group{account.GroupOwner},
	); err != nil {
		t.Fatalf("创建测试 Owner: %v", err)
	}
}

func loginAs(t *testing.T, server *Server, username, password string) authIdentity {
	t.Helper()
	value, rpcErr := server.authLogin(jsonParams(t, map[string]string{
		"username": username,
		"password": password,
	}))
	if rpcErr != nil {
		t.Fatalf("login %s: %+v", username, rpcErr)
	}
	identity, ok := value.(authIdentity)
	if !ok {
		t.Fatalf("login 返回类型 = %T", value)
	}
	if !identity.Authenticated || identity.Username != username {
		t.Fatalf("login 返回 %+v", identity)
	}
	return identity
}

// seedSessionForUser 伪造一个低权限用户的 CLI 会话，用来验证 account.* 的 Admin 门槛。
func seedSessionForUser(t *testing.T, server *Server, user *account.User) {
	t.Helper()
	const token = "test-session-token-for-permission"
	now := server.now()
	db, err := openExistingDatabase(server.dataDir)
	if err != nil {
		t.Fatalf("打开测试数据库: %v", err)
	}
	session, err := auth.NewSessionStore(db).Create(context.Background(), auth.SessionParams{
		UserID:    user.ID,
		TokenHash: auth.HashToken(token),
		Scope:     auth.ScopeCLI,
		UserAgent: "chat-deepseek ipc test",
		TTL:       time.Hour,
	}, now)
	_ = db.Close()
	if err != nil {
		t.Fatalf("创建测试会话: %v", err)
	}
	if err := server.writeOwnSession(&ipcSession{
		DataDir:   server.dataDir,
		UserID:    user.ID,
		Username:  user.Username,
		Token:     token,
		ExpiresAt: session.ExpiresAt,
	}); err != nil {
		t.Fatalf("写入测试会话文件: %v", err)
	}
}

func requestWithParams(t *testing.T, id int, method string, params any) string {
	t.Helper()
	data, err := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"method":  method,
		"params":  params,
	})
	if err != nil {
		t.Fatalf("编码请求: %v", err)
	}
	return string(data)
}
