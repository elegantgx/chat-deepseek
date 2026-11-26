package ipc

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/elegantgx/chat-deepseek/internal/config"
)

func readConfigFile(t *testing.T, dir string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(dir, "config.json"))
	if err != nil {
		t.Fatalf("读取 config.json: %v", err)
	}
	return string(data)
}

func TestConfigSetUpdatesProjectionAndPreservesUnknown(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	original := `{
  "listen": "127.0.0.1:1",
  "public_url": "https://chat.example.com",
  "api_origin": "https://api.deepseek.com",
  "custom_field": {"keep": true}
}
`
	if err := os.WriteFile(filepath.Join(dir, "config.json"), []byte(original), 0o600); err != nil {
		t.Fatalf("写入测试配置: %v", err)
	}
	customBackup := filepath.Join(t.TempDir(), "snapshots")

	// config.set 与 CLI config set 一样，不要求登录。
	value, rpcErr := server.configSet(jsonParams(t, map[string]string{
		"listen":    "0.0.0.0:8091",
		"apiOrigin": "https://api.example.com/",
		"backupDir": customBackup,
	}))
	if rpcErr != nil {
		t.Fatalf("config.set: %+v", rpcErr)
	}
	result := value.(configResult)
	if result.DataDir != dir || result.Listen != "0.0.0.0:8091" ||
		result.APIOrigin != "https://api.example.com" || result.BackupDir != customBackup ||
		result.Version != server.version {
		t.Fatalf("config.set = %+v", result)
	}

	raw := map[string]json.RawMessage{}
	if err := json.Unmarshal([]byte(readConfigFile(t, dir)), &raw); err != nil {
		t.Fatalf("解析 config.json: %v", err)
	}
	var listen, publicURL string
	_ = json.Unmarshal(raw["listen"], &listen)
	_ = json.Unmarshal(raw["public_url"], &publicURL)
	if listen != "0.0.0.0:8091" || publicURL != "https://chat.example.com" {
		t.Fatalf("config.json listen=%q public_url=%q", listen, publicURL)
	}
	if _, ok := raw["custom_field"]; !ok {
		t.Fatal("config.set 不应丢掉未知字段")
	}
	cfg, err := config.Load(dir)
	if err != nil {
		t.Fatalf("重新读取配置: %v", err)
	}
	if cfg.Listen != "0.0.0.0:8091" || cfg.APIOrigin != "https://api.example.com" ||
		cfg.BackupDir != customBackup || cfg.PublicURL != "https://chat.example.com" {
		t.Fatalf("config.Load = %+v", cfg)
	}
}

func TestConfigSetValidation(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	before := readConfigFile(t, dir)

	cases := map[string]string{
		"empty":          `{}`,
		"unknown-only":   `{"unknown":1}`,
		"empty-listen":   `{"listen":""}`,
		"bad-listen":     `{"listen":"127.0.0.1"}`,
		"bad-scheme":     `{"apiOrigin":"ftp://example.com"}`,
		"no-host":        `{"apiOrigin":"https://"}`,
		"with-query":     `{"apiOrigin":"https://example.com/?a=1"}`,
		"with-fragment":  `{"apiOrigin":"https://example.com/#x"}`,
		"relative-dir":   `{"backupDir":"relative/path"}`,
		"wrong-type":     `{"listen":123}`,
		"not-object":     `[]`,
		"missing-params": ``,
	}
	for name, params := range cases {
		t.Run(name, func(t *testing.T) {
			_, rpcErr := server.configSet(json.RawMessage(params))
			if rpcErr == nil || rpcErr.Code != codeBadRequest {
				t.Fatalf("error = %+v，期望 bad_request", rpcErr)
			}
			if got := readConfigFile(t, dir); got != before {
				t.Fatalf("校验失败不应修改 config.json:\n%s", got)
			}
		})
	}
}

func TestConfigSetClearsBackupDir(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	custom := filepath.Join(t.TempDir(), "snapshots")
	if _, rpcErr := server.configSet(jsonParams(t, map[string]string{"backupDir": custom})); rpcErr != nil {
		t.Fatalf("config.set: %+v", rpcErr)
	}
	value, rpcErr := server.configSet(jsonParams(t, map[string]string{"backupDir": ""}))
	if rpcErr != nil {
		t.Fatalf("config.set clear: %+v", rpcErr)
	}
	result := value.(configResult)
	if result.BackupDir != filepath.Join(dir, "backups") {
		t.Fatalf("清除后 backupDir = %q", result.BackupDir)
	}
	if strings.Contains(readConfigFile(t, dir), "backup_dir") {
		t.Fatalf("清除后 config.json 不应保留 backup_dir: %s", readConfigFile(t, dir))
	}
}
