package ipc

import (
	"encoding/json"
	"testing"

	"github.com/elegantgx/chat-deepseek/internal/account"
	"github.com/elegantgx/chat-deepseek/internal/service"
)

func jsonFields(t *testing.T, value any) map[string]json.RawMessage {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("序列化: %v", err)
	}
	fields := map[string]json.RawMessage{}
	if err := json.Unmarshal(data, &fields); err != nil {
		t.Fatalf("解析字段: %v", err)
	}
	return fields
}

func TestMethodJSONFieldNames(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	seedAccount(t, dir, "admin", []account.Group{account.GroupAdmin})

	value, rpcErr := server.authLogin(jsonParams(t, map[string]string{
		"username": "admin",
		"password": testAccountPassword,
	}))
	if rpcErr != nil {
		t.Fatalf("auth.login: %+v", rpcErr)
	}
	identity := jsonFields(t, value)
	for _, key := range []string{"authenticated", "username", "groups", "expiresAt"} {
		if _, ok := identity[key]; !ok {
			t.Fatalf("auth.login 缺少字段 %q: %v", key, identity)
		}
	}
	if len(identity) != 4 {
		t.Fatalf("auth.login 字段数 = %d: %v", len(identity), identity)
	}

	value, rpcErr = server.authWhoami()
	if rpcErr != nil {
		t.Fatalf("auth.whoami: %+v", rpcErr)
	}
	if who := jsonFields(t, value); len(who) != 4 {
		t.Fatalf("auth.whoami 字段 = %v", who)
	}

	value, rpcErr = server.accountList(nil)
	if rpcErr != nil {
		t.Fatalf("account.list: %+v", rpcErr)
	}
	list := jsonFields(t, value)
	var entries []map[string]json.RawMessage
	if err := json.Unmarshal(list["accounts"], &entries); err != nil {
		t.Fatalf("解析 accounts: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("accounts = %v", entries)
	}
	for _, key := range []string{"id", "username", "groups", "disabled", "createdAt", "self"} {
		if _, ok := entries[0][key]; !ok {
			t.Fatalf("account 条目缺少字段 %q: %v", key, entries[0])
		}
	}

	value, rpcErr = server.configSet(jsonParams(t, map[string]string{"listen": "127.0.0.1:8092"}))
	if rpcErr != nil {
		t.Fatalf("config.set: %+v", rpcErr)
	}
	configFields := jsonFields(t, value)
	for _, key := range []string{"dataDir", "listen", "apiOrigin", "backupDir", "version"} {
		if _, ok := configFields[key]; !ok {
			t.Fatalf("config.set 缺少字段 %q: %v", key, configFields)
		}
	}

	seedActiveOwner(t, dir)
	fake := &fakeServiceController{installResult: service.InstallResult{UnitPath: "/tmp/chat-deepseek.service"}}
	useFakeService(server, fake)
	value, rpcErr = server.serviceInstall(nil)
	if rpcErr != nil {
		t.Fatalf("service.install: %+v", rpcErr)
	}
	install := jsonFields(t, value)
	for _, key := range []string{"ok", "unitPath", "enabled", "warnings"} {
		if _, ok := install[key]; !ok {
			t.Fatalf("service.install 缺少字段 %q: %v", key, install)
		}
	}
	if len(install) != 4 {
		t.Fatalf("service.install 字段数 = %d: %v", len(install), install)
	}

	value, rpcErr = server.authLogout(nil)
	if rpcErr != nil {
		t.Fatalf("auth.logout: %+v", rpcErr)
	}
	if logout := jsonFields(t, value); len(logout) != 1 {
		t.Fatalf("auth.logout = %v", logout)
	}
}
