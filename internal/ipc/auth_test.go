package ipc

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/elegantgx/chat-deepseek/internal/account"
	"github.com/elegantgx/chat-deepseek/internal/auth"
	"github.com/elegantgx/chat-deepseek/internal/config"
	"github.com/elegantgx/chat-deepseek/internal/database"
)

func TestAuthWhoamiWithoutSession(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")

	value, rpcErr := server.authWhoami()
	if rpcErr != nil {
		t.Fatalf("whoami: %+v", rpcErr)
	}
	identity := value.(authIdentity)
	if identity.Authenticated || identity.Initialized || identity.Username != "" || identity.ExpiresAt != "" || len(identity.Groups) != 0 {
		t.Fatalf("未登录时应只返回 authenticated:false 与 initialized:false，得到 %+v", identity)
	}
	data, err := json.Marshal(identity)
	if err != nil {
		t.Fatalf("序列化: %v", err)
	}
	if string(data) != `{"authenticated":false,"initialized":false}` {
		t.Fatalf("JSON = %s", data)
	}
}

func TestAuthWhoamiInitializedWithoutSession(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	seedActiveOwner(t, dir)

	value, rpcErr := server.authWhoami()
	if rpcErr != nil {
		t.Fatalf("whoami: %+v", rpcErr)
	}
	identity := value.(authIdentity)
	if identity.Authenticated || !identity.Initialized {
		t.Fatalf("有 Owner 但未登录时应返回 initialized:true，得到 %+v", identity)
	}
}

func TestAuthSetupCreatesFirstOwnerAndLogsIn(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")

	value, rpcErr := server.authSetup(jsonParams(t, map[string]string{
		"username": "owner",
		"password": testAccountPassword,
	}))
	if rpcErr != nil {
		t.Fatalf("setup: %+v", rpcErr)
	}
	identity := value.(authIdentity)
	if !identity.Authenticated || !identity.Initialized || identity.Username != "owner" {
		t.Fatalf("setup 返回 %+v", identity)
	}
	if len(identity.Groups) != 2 || identity.Groups[0] != "User" || identity.Groups[1] != "Owner" {
		t.Fatalf("groups = %v，期望 [User Owner]", identity.Groups)
	}
	if _, err := server.readOwnSession(); err != nil {
		t.Fatalf("setup 后应写入会话文件: %v", err)
	}
	initialized, err := database.Initialized(dir)
	if err != nil || !initialized {
		t.Fatalf("setup 后应存在活动 Owner：initialized=%v err=%v", initialized, err)
	}

	db, err := openExistingDatabase(dir)
	if err != nil {
		t.Fatalf("打开数据库: %v", err)
	}
	var users int
	if err := db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&users); err != nil {
		_ = db.Close()
		t.Fatalf("统计用户: %v", err)
	}
	_ = db.Close()
	if users != 1 {
		t.Fatalf("setup 后用户数 = %d，期望 1", users)
	}

	// setup 直接登录；退出后能用刚设置的密码正常登录。
	value, rpcErr = server.authWhoami()
	if rpcErr != nil || !value.(authIdentity).Authenticated {
		t.Fatalf("setup 后 whoami = %+v / %+v", value, rpcErr)
	}
	if _, rpcErr := server.authLogout(nil); rpcErr != nil {
		t.Fatalf("logout: %+v", rpcErr)
	}
	loginAs(t, server, "owner", testAccountPassword)

	// 已有活动 Owner 时再 setup 必须拒绝，不能变成「凭接口重置管理员」。
	_, rpcErr = server.authSetup(jsonParams(t, map[string]string{
		"username": "another",
		"password": testAccountPassword,
	}))
	if rpcErr == nil || rpcErr.Code != codeConflict {
		t.Fatalf("重复 setup = %+v，期望 conflict", rpcErr)
	}
	db, err = openExistingDatabase(dir)
	if err != nil {
		t.Fatalf("打开数据库: %v", err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&users); err != nil {
		_ = db.Close()
		t.Fatalf("统计用户: %v", err)
	}
	_ = db.Close()
	if users != 1 {
		t.Fatalf("被拒绝的 setup 不应创建用户，当前 %d 个", users)
	}
}

func TestAuthSetupValidatesInput(t *testing.T) {
	cases := []struct {
		name    string
		params  map[string]any
		message string
	}{
		{
			name:    "缺少用户名",
			params:  map[string]any{"password": testAccountPassword},
			message: "缺少参数 username",
		},
		{
			name:    "缺少密码",
			params:  map[string]any{"username": "owner"},
			message: "缺少参数 password",
		},
		{
			name:    "非法用户名",
			params:  map[string]any{"username": "bad name", "password": testAccountPassword},
			message: "用户名需为 1-64 个字母、数字或 . _ -",
		},
		{
			name:    "密码过短",
			params:  map[string]any{"username": "owner", "password": "short"},
			message: "密码至少 8 位",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server, dir := newTestServer(t, "127.0.0.1:1")
			_, rpcErr := server.authSetup(jsonParams(t, tc.params))
			if rpcErr == nil || rpcErr.Code != codeBadRequest {
				t.Fatalf("setup = %+v，期望 bad_request", rpcErr)
			}
			if rpcErr.Message != tc.message {
				t.Fatalf("message = %q，期望 %q", rpcErr.Message, tc.message)
			}
			if initialized, err := database.Initialized(dir); err != nil || initialized {
				t.Fatalf("校验失败不应创建数据目录：initialized=%v err=%v", initialized, err)
			}
		})
	}
}

func TestAuthLoginWhoamiAndSessionFile(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	seedAccount(t, dir, "admin", []account.Group{account.GroupAdmin})

	before := time.Now()
	identity := loginAs(t, server, "admin", testAccountPassword)
	if len(identity.Groups) != 2 || identity.Groups[0] != "User" || identity.Groups[1] != "Admin" {
		t.Fatalf("groups = %v，期望 [User Admin]", identity.Groups)
	}
	expires, err := time.Parse(time.RFC3339, identity.ExpiresAt)
	if err != nil {
		t.Fatalf("expiresAt = %q: %v", identity.ExpiresAt, err)
	}
	if expires.Before(before.Add(11*time.Hour)) || expires.After(before.Add(13*time.Hour)) {
		t.Fatalf("expiresAt = %v，期望约 12 小时后", expires)
	}
	if !strings.Contains(identity.ExpiresAt, "+") && !strings.HasSuffix(identity.ExpiresAt, "Z") {
		t.Fatalf("expiresAt 必须是带时区的 RFC3339: %q", identity.ExpiresAt)
	}

	value, rpcErr := server.authWhoami()
	if rpcErr != nil {
		t.Fatalf("whoami: %+v", rpcErr)
	}
	again := value.(authIdentity)
	againExpires, err := time.Parse(time.RFC3339, again.ExpiresAt)
	if err != nil {
		t.Fatalf("whoami expiresAt = %q: %v", again.ExpiresAt, err)
	}
	if !again.Authenticated || again.Username != "admin" || len(again.Groups) != 2 {
		t.Fatalf("whoami = %+v，login = %+v", again, identity)
	}
	if againExpires.Before(expires) {
		t.Fatalf("whoami 续期后 %v 不应早于 login 的 %v", againExpires, expires)
	}

	session, err := server.readOwnSession()
	if err != nil {
		t.Fatalf("读取会话文件: %v", err)
	}
	if session.Version != 1 || session.Token == "" || session.DataDir != dir || session.Username != "admin" {
		t.Fatalf("会话文件 = %+v", session)
	}
	if session.ExpiresAt/1000 != againExpires.Unix() {
		t.Fatalf("会话文件 expires_at = %d，whoami = %d", session.ExpiresAt, againExpires.UnixMilli())
	}
	if server.host.Start == 0 {
		t.Fatal("hostKey.Start 不能为 0")
	}
	path := server.sessionPath()
	wantName := fmt.Sprintf("%d-%d.json", os.Getpid(), processStartTime())
	if filepath.Base(path) != wantName {
		t.Fatalf("会话文件名 = %q，期望 %q", filepath.Base(path), wantName)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatalf("stat 会话文件: %v", err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("会话文件权限 = %o，期望 600", info.Mode().Perm())
		}
	}

	db, err := openExistingDatabase(dir)
	if err != nil {
		t.Fatalf("打开数据库: %v", err)
	}
	defer func() { _ = db.Close() }()
	var tokenHash string
	if err := db.QueryRow(`SELECT token_hash FROM auth_sessions`).Scan(&tokenHash); err != nil {
		t.Fatalf("读取 token_hash: %v", err)
	}
	if tokenHash != auth.HashToken(session.Token) {
		t.Fatalf("数据库 token_hash 与文件 token 不匹配")
	}
	if tokenHash == session.Token {
		t.Fatal("数据库不应保存明文 token")
	}
}

func TestAuthWhoamiSlidesExpiry(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	seedAccount(t, dir, "admin", []account.Group{account.GroupAdmin})

	base := time.Now()
	server.now = func() time.Time { return base }
	identity := loginAs(t, server, "admin", testAccountPassword)
	initial, err := time.Parse(time.RFC3339, identity.ExpiresAt)
	if err != nil {
		t.Fatalf("login expiresAt: %v", err)
	}
	if want := base.Add(12 * time.Hour); initial.Unix() != want.Unix() {
		t.Fatalf("login expiresAt = %v，期望 %v", initial, want)
	}

	// 过期前 1 小时调用 whoami：应把有效期推到 now+12h，而不是保留 login 的旧值。
	server.now = func() time.Time { return base.Add(11 * time.Hour) }
	value, rpcErr := server.authWhoami()
	if rpcErr != nil {
		t.Fatalf("whoami: %+v", rpcErr)
	}
	renewed := value.(authIdentity)
	renewedExpires, err := time.Parse(time.RFC3339, renewed.ExpiresAt)
	if err != nil {
		t.Fatalf("whoami expiresAt: %v", err)
	}
	wantRenewed := base.Add(23 * time.Hour)
	if renewedExpires.Unix() != wantRenewed.Unix() {
		t.Fatalf("续期后 expiresAt = %v，期望 %v", renewedExpires, wantRenewed)
	}
	if renewedExpires.Unix() <= initial.Unix() {
		t.Fatalf("续期后 %v 应晚于 login 的 %v", renewedExpires, initial)
	}

	file, err := server.readOwnSession()
	if err != nil {
		t.Fatalf("读取会话文件: %v", err)
	}
	if file.ExpiresAt/1000 != wantRenewed.Unix() {
		t.Fatalf("会话文件 expires_at = %d，期望 %d", file.ExpiresAt, wantRenewed.UnixMilli())
	}
	db, err := openExistingDatabase(dir)
	if err != nil {
		t.Fatalf("打开数据库: %v", err)
	}
	defer func() { _ = db.Close() }()
	var dbExpires int64
	if err := db.QueryRow(`SELECT expires_at FROM auth_sessions`).Scan(&dbExpires); err != nil {
		t.Fatalf("读取数据库 expires_at: %v", err)
	}
	if dbExpires != wantRenewed.UnixMilli() {
		t.Fatalf("数据库 expires_at = %d，期望 %d", dbExpires, wantRenewed.UnixMilli())
	}
}

func TestAuthReloginReplacesSession(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	seedAccount(t, dir, "admin", []account.Group{account.GroupAdmin})

	loginAs(t, server, "admin", testAccountPassword)
	first, err := server.readOwnSession()
	if err != nil {
		t.Fatalf("第一次 login 会话文件: %v", err)
	}
	loginAs(t, server, "admin", testAccountPassword)
	second, err := server.readOwnSession()
	if err != nil {
		t.Fatalf("第二次 login 会话文件: %v", err)
	}
	if first.Token == second.Token {
		t.Fatal("重新 login 应生成新 token")
	}

	db, err := openExistingDatabase(dir)
	if err != nil {
		t.Fatalf("打开数据库: %v", err)
	}
	defer func() { _ = db.Close() }()
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM auth_sessions`).Scan(&count); err != nil {
		t.Fatalf("统计会话: %v", err)
	}
	if count != 1 {
		t.Fatalf("重新 login 后数据库会话数 = %d，期望 1", count)
	}
	var oldCount int
	if err := db.QueryRow(
		`SELECT COUNT(*) FROM auth_sessions WHERE token_hash = ?`,
		auth.HashToken(first.Token),
	).Scan(&oldCount); err != nil {
		t.Fatalf("查询旧会话: %v", err)
	}
	if oldCount != 0 {
		t.Fatalf("旧 token 仍有 %d 条会话", oldCount)
	}
}

func TestAuthRenewFailureKeepsOldExpiry(t *testing.T) {
	dir := t.TempDir()
	if err := config.Save(dir, config.Config{Listen: "127.0.0.1:1"}); err != nil {
		t.Fatalf("写入配置: %v", err)
	}
	var stderr bytes.Buffer
	server, err := New(dir, &stderr)
	if err != nil {
		t.Fatalf("创建服务: %v", err)
	}
	server.sessionRoot = t.TempDir()
	seedAccount(t, dir, "admin", []account.Group{account.GroupAdmin})

	base := time.Now()
	server.now = func() time.Time { return base }
	identity := loginAs(t, server, "admin", testAccountPassword)
	before, err := server.readOwnSession()
	if err != nil {
		t.Fatalf("读取会话文件: %v", err)
	}

	// 时间推进 1h：如果续期成功，expiresAt 会变成 base+13h；注入失败后应保持旧值。
	server.now = func() time.Time { return base.Add(time.Hour) }
	server.renewHook = func(_ *sql.DB, _ *ipcSession, _ *auth.Session, _ time.Time) (int64, error) {
		return 0, fmt.Errorf("模拟续期写失败")
	}
	value, rpcErr := server.authWhoami()
	if rpcErr != nil {
		t.Fatalf("whoami: %+v", rpcErr)
	}
	renewed := value.(authIdentity)
	if !renewed.Authenticated {
		t.Fatal("续期失败不应让已认证请求变成未登录")
	}
	if renewed.ExpiresAt != identity.ExpiresAt {
		t.Fatalf("续期失败后 expiresAt = %q，期望保持 %q", renewed.ExpiresAt, identity.ExpiresAt)
	}
	if !strings.Contains(stderr.String(), "刷新登录态失败") {
		t.Fatalf("续期失败应写 stderr，得到 %q", stderr.String())
	}

	after, err := server.readOwnSession()
	if err != nil {
		t.Fatalf("再次读取会话文件: %v", err)
	}
	if after.ExpiresAt != before.ExpiresAt {
		t.Fatalf("续期失败后文件 expires_at = %d，期望保持 %d", after.ExpiresAt, before.ExpiresAt)
	}
	db, err := openExistingDatabase(dir)
	if err != nil {
		t.Fatalf("打开数据库: %v", err)
	}
	defer func() { _ = db.Close() }()
	var dbExpires int64
	if err := db.QueryRow(`SELECT expires_at FROM auth_sessions`).Scan(&dbExpires); err != nil {
		t.Fatalf("读取数据库 expires_at: %v", err)
	}
	if dbExpires != before.ExpiresAt {
		t.Fatalf("续期失败后数据库 expires_at = %d，期望保持 %d", dbExpires, before.ExpiresAt)
	}
}

func TestServeCleansUpSessionOnExit(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	seedAccount(t, dir, "admin", []account.Group{account.GroupAdmin})

	login := requestWithParams(t, 1, "auth.login", map[string]string{
		"username": "admin",
		"password": testAccountPassword,
	})
	responses, _ := serve(t, server, login+"\n")
	if len(responses) != 1 || responses[0].Error != nil {
		t.Fatalf("login responses = %+v", responses)
	}
	if _, err := server.readOwnSession(); !os.IsNotExist(err) {
		t.Fatalf("Serve 退出后应删除会话文件: %v", err)
	}
	db, err := openExistingDatabase(dir)
	if err != nil {
		t.Fatalf("打开数据库: %v", err)
	}
	defer func() { _ = db.Close() }()
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM auth_sessions`).Scan(&count); err != nil {
		t.Fatalf("统计会话: %v", err)
	}
	if count != 0 {
		t.Fatalf("Serve 退出后数据库仍有 %d 条会话", count)
	}
}

func TestAuthLoginRejectsBadCredentials(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	seedAccount(t, dir, "admin", []account.Group{account.GroupAdmin})
	seedDisabledAccount(t, dir, "blocked")
	seedAccount(t, dir, "plain", nil)

	cases := []struct {
		name    string
		params  string
		code    string
		message string
	}{
		{"unknown", `{"username":"nobody","password":"password123"}`, codeUnauthenticated, "账户不存在"},
		{"wrong-password", `{"username":"admin","password":"wrong-password"}`, codeUnauthenticated, "密码错误"},
		{"disabled", `{"username":"blocked","password":"password123"}`, codeUnauthenticated, "账户已被禁用"},
		{"not-admin", `{"username":"plain","password":"password123"}`, codePermissionDenied, "该账户没有 CLI 管理权限"},
		{"missing-username", `{"password":"password123"}`, codeBadRequest, "缺少参数 username"},
		{"missing-password", `{"username":"admin"}`, codeBadRequest, "缺少参数 password"},
		{"empty-username", `{"username":"  ","password":"password123"}`, codeBadRequest, "缺少参数 username"},
		{"too-long", `{"username":"admin","password":"` + strings.Repeat("x", auth.MaxPasswordLength+1) + `"}`, codeBadRequest, "密码过长"},
		{"not-object", `"admin"`, codeBadRequest, "参数必须是 JSON 对象"},
		{"missing-params", ``, codeBadRequest, "缺少参数 username"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, rpcErr := server.authLogin(json.RawMessage(tc.params))
			if rpcErr == nil || rpcErr.Code != tc.code {
				t.Fatalf("error = %+v，期望 %s", rpcErr, tc.code)
			}
			if !strings.Contains(rpcErr.Message, tc.message) {
				t.Fatalf("message = %q，期望包含 %q", rpcErr.Message, tc.message)
			}
			if strings.Contains(rpcErr.Message, "password123") {
				t.Fatalf("错误信息不能包含密码: %q", rpcErr.Message)
			}
		})
	}
	if _, err := server.readOwnSession(); !os.IsNotExist(err) {
		t.Fatalf("失败的 login 不应留下会话文件: %v", err)
	}
}

func TestAuthLogoutRevokesSession(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	seedAccount(t, dir, "admin", []account.Group{account.GroupAdmin})
	loginAs(t, server, "admin", testAccountPassword)

	value, rpcErr := server.authLogout(nil)
	if rpcErr != nil {
		t.Fatalf("logout: %+v", rpcErr)
	}
	if !value.(authLogoutResult).OK {
		t.Fatalf("logout = %+v", value)
	}
	if _, err := server.readOwnSession(); !os.IsNotExist(err) {
		t.Fatalf("logout 后会话文件应删除: %v", err)
	}
	value, rpcErr = server.authWhoami()
	if rpcErr != nil || value.(authIdentity).Authenticated {
		t.Fatalf("logout 后 whoami = %+v / %+v", value, rpcErr)
	}
	db, err := openExistingDatabase(dir)
	if err != nil {
		t.Fatalf("打开数据库: %v", err)
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM auth_sessions`).Scan(&count); err != nil {
		_ = db.Close()
		t.Fatalf("统计会话: %v", err)
	}
	_ = db.Close()
	if count != 0 {
		t.Fatalf("logout 后数据库仍有 %d 条会话", count)
	}

	// 幂等：未登录再 logout 仍返回 ok。
	value, rpcErr = server.authLogout(nil)
	if rpcErr != nil || !value.(authLogoutResult).OK {
		t.Fatalf("第二次 logout = %+v / %+v", value, rpcErr)
	}
}

func TestAuthWhoamiExpiredSession(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	seedAccount(t, dir, "admin", []account.Group{account.GroupAdmin})
	loginAs(t, server, "admin", testAccountPassword)

	if _, err := server.readOwnSession(); err != nil {
		t.Fatalf("登录后应存在会话文件: %v", err)
	}
	// 把 ipc 的时钟拨过 15 分钟 TTL；文件与数据库都应判定过期。
	base := time.Now()
	server.now = func() time.Time { return base.Add(13 * time.Hour) }
	value, rpcErr := server.authWhoami()
	if rpcErr != nil {
		t.Fatalf("whoami: %+v", rpcErr)
	}
	if value.(authIdentity).Authenticated {
		t.Fatal("过期会话不应再认证成功")
	}
	if _, err := server.readOwnSession(); !os.IsNotExist(err) {
		t.Fatalf("过期后应删除本地会话文件: %v", err)
	}
}

func TestAuthLoginDoesNotLeakPassword(t *testing.T) {
	dir := t.TempDir()
	if err := config.Save(dir, config.Config{Listen: "127.0.0.1:1"}); err != nil {
		t.Fatalf("写入配置: %v", err)
	}
	var stderr bytes.Buffer
	server, err := New(dir, &stderr)
	if err != nil {
		t.Fatalf("创建服务: %v", err)
	}
	server.sessionRoot = t.TempDir()
	seedAccount(t, dir, "admin", []account.Group{account.GroupAdmin})

	const secret = "ultra-secret-password"
	request := requestWithParams(t, 1, "auth.login", map[string]string{
		"username": "admin",
		"password": secret,
	})
	responses, output := serve(t, server, request+"\n")
	if len(responses) != 1 || responses[0].Error == nil || responses[0].Error.Code != codeUnauthenticated {
		t.Fatalf("responses = %+v", responses)
	}
	if strings.Contains(output, secret) || strings.Contains(stderr.String(), secret) {
		t.Fatalf("密码泄漏到输出: stdout=%q stderr=%q", output, stderr.String())
	}
	// 成功登录的响应也不能带 token 或密码。
	loginAs(t, server, "admin", testAccountPassword)
	value, _ := server.authWhoami()
	data, _ := json.Marshal(value)
	if strings.Contains(string(data), secret) || strings.Contains(string(data), "token") {
		t.Fatalf("登录响应含敏感字段: %s", data)
	}
}

func TestAccountMethodsRequireAdmin(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	user := seedAccount(t, dir, "plain", nil)
	seedSessionForUser(t, server, user)

	calls := map[string]func(json.RawMessage) (any, *rpcError){
		"account.list":     server.accountList,
		"account.add":      server.accountAdd,
		"account.password": server.accountPassword,
		"account.delete":   server.accountDelete,
	}
	params := map[string]json.RawMessage{
		"account.list":     nil,
		"account.add":      jsonParams(t, map[string]any{"username": "new-user", "password": testAccountPassword}),
		"account.password": jsonParams(t, map[string]any{"username": "plain", "password": testAccountPassword}),
		"account.delete":   jsonParams(t, map[string]any{"username": "plain"}),
	}
	for name, call := range calls {
		_, rpcErr := call(params[name])
		if rpcErr == nil || rpcErr.Code != codePermissionDenied {
			t.Fatalf("%s error = %+v，期望 permission_denied", name, rpcErr)
		}
		if rpcErr.Message != "需要 Admin 或 Owner 权限" {
			t.Fatalf("%s message = %q", name, rpcErr.Message)
		}
	}
}

func TestAccountMethodsUnauthenticated(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")
	calls := map[string]func(json.RawMessage) (any, *rpcError){
		"account.list":     server.accountList,
		"account.add":      server.accountAdd,
		"account.password": server.accountPassword,
		"account.delete":   server.accountDelete,
	}
	params := map[string]json.RawMessage{
		"account.list":     nil,
		"account.add":      jsonParams(t, map[string]any{"username": "new-user", "password": testAccountPassword}),
		"account.password": jsonParams(t, map[string]any{"username": "new-user", "password": testAccountPassword}),
		"account.delete":   jsonParams(t, map[string]any{"username": "new-user"}),
	}
	for name, call := range calls {
		_, rpcErr := call(params[name])
		if rpcErr == nil || rpcErr.Code != codeUnauthenticated {
			t.Fatalf("%s error = %+v，期望 unauthenticated", name, rpcErr)
		}
	}
}

func TestAuthSessionBelongsToCurrentProcess(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	seedAccount(t, dir, "admin", []account.Group{account.GroupAdmin})
	loginAs(t, server, "admin", testAccountPassword)

	original := server.host
	oldPath := server.sessionPath()
	// 模拟另一个 ipc 进程：PID/启动时间不同，它的会话文件路径也就不同。
	server.host = hostKey{PID: original.PID + 1, Start: original.Start + 1}
	value, rpcErr := server.authWhoami()
	if rpcErr != nil || value.(authIdentity).Authenticated {
		t.Fatalf("新进程 whoami = %+v / %+v，期望未登录", value, rpcErr)
	}
	if _, err := os.Stat(oldPath); err != nil {
		t.Fatalf("不应删除旧进程的会话文件: %v", err)
	}

	server.host = original
	value, rpcErr = server.authWhoami()
	if rpcErr != nil || !value.(authIdentity).Authenticated {
		t.Fatalf("原进程 whoami = %+v / %+v", value, rpcErr)
	}
}
