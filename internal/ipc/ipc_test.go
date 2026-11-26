package ipc

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/elegantgx/chat-deepseek/internal/buildinfo"
	"github.com/elegantgx/chat-deepseek/internal/config"
)

type testResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  json.RawMessage `json:"result"`
	Error   *rpcError       `json:"error"`
}

func newTestServer(t *testing.T, listen string) (*Server, string) {
	t.Helper()
	dir := t.TempDir()
	if err := config.Save(dir, config.Config{
		Listen:    listen,
		APIOrigin: "https://api.deepseek.com",
	}); err != nil {
		t.Fatalf("写入测试配置: %v", err)
	}
	server, err := New(dir, io.Discard)
	if err != nil {
		t.Fatalf("创建服务: %v", err)
	}
	server.probeTimeout = 100 * time.Millisecond
	return server, dir
}

func requestLine(id int, method string) string {
	return fmt.Sprintf(`{"jsonrpc":"2.0","id":%d,"method":%q,"params":{}}`, id, method)
}

func parseResponses(t *testing.T, output string) []testResponse {
	t.Helper()
	output = strings.TrimSuffix(output, "\n")
	if output == "" {
		return nil
	}
	lines := strings.Split(output, "\n")
	responses := make([]testResponse, 0, len(lines))
	for i, line := range lines {
		if !json.Valid([]byte(line)) {
			t.Fatalf("stdout 第 %d 行不是 JSON: %q", i+1, line)
		}
		var resp testResponse
		if err := json.Unmarshal([]byte(line), &resp); err != nil {
			t.Fatalf("解析响应: %v", err)
		}
		responses = append(responses, resp)
	}
	return responses
}

func serve(t *testing.T, server *Server, input string) ([]testResponse, string) {
	t.Helper()
	var out bytes.Buffer
	if err := server.Serve(strings.NewReader(input), &out); err != nil {
		t.Fatalf("Serve: %v", err)
	}
	return parseResponses(t, out.String()), out.String()
}

func byID(t *testing.T, responses []testResponse) map[int]testResponse {
	t.Helper()
	result := make(map[int]testResponse, len(responses))
	for _, resp := range responses {
		if string(resp.ID) == "null" {
			continue
		}
		var id int
		if err := json.Unmarshal(resp.ID, &id); err != nil {
			t.Fatalf("响应 id 不是数字: %s", resp.ID)
		}
		result[id] = resp
	}
	return result
}

func TestServeReadOnlyMethods(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("监听测试端口: %v", err)
	}
	defer func() { _ = listener.Close() }()

	server, dir := newTestServer(t, listener.Addr().String())
	backupDir := filepath.Join(dir, "backups")
	if err := os.MkdirAll(backupDir, 0o700); err != nil {
		t.Fatalf("创建备份目录: %v", err)
	}
	archive := filepath.Join(backupDir, "chat-deepseek-20261126-021400.zip")
	if err := os.WriteFile(archive, []byte("0123456789"), 0o600); err != nil {
		t.Fatalf("写入测试备份: %v", err)
	}

	input := strings.Join([]string{
		requestLine(1, "system.status"),
		requestLine(2, "system.capabilities"),
		requestLine(3, "config.get"),
		requestLine(4, "backup.list"),
	}, "\n") + "\n"
	responses, _ := serve(t, server, input)
	if len(responses) != 4 {
		t.Fatalf("期望 4 个响应，得到 %d", len(responses))
	}
	got := byID(t, responses)
	for id, resp := range got {
		if resp.JSONRPC != "2.0" {
			t.Errorf("id=%d jsonrpc=%q", id, resp.JSONRPC)
		}
		if resp.Error != nil {
			t.Errorf("id=%d 返回错误: %+v", id, resp.Error)
		}
	}

	var status statusResult
	if err := json.Unmarshal(got[1].Result, &status); err != nil {
		t.Fatalf("解析 status: %v", err)
	}
	if status.Version != buildinfo.Version || status.DataDir != dir {
		t.Errorf("status 基础字段不对: %+v", status)
	}
	if status.Service.State != stateRunning {
		t.Errorf("status.state=%q，期望 running", status.Service.State)
	}
	if status.Service.Listen != listener.Addr().String() || status.Service.Source != "probe" {
		t.Errorf("status.service 不对: %+v", status.Service)
	}

	var caps capabilitiesResult
	if err := json.Unmarshal(got[2].Result, &caps); err != nil {
		t.Fatalf("解析 capabilities: %v", err)
	}
	if caps.IPCVersion != 1 || caps.Platform == "" {
		t.Errorf("capabilities 版本/平台不对: %+v", caps)
	}
	if len(caps.Methods) != len(server.methods) {
		t.Errorf("capabilities 方法数=%d，注册表=%d", len(caps.Methods), len(server.methods))
	}
	for i, name := range caps.Methods {
		if name != server.methodOrder[i] {
			t.Errorf("methods[%d]=%q，注册表=%q", i, name, server.methodOrder[i])
		}
	}
	if caps.Features.Systemd || caps.Features.SSH || caps.Features.Autostart {
		t.Errorf("systemd/ssh/autostart 应保持 false: %+v", caps.Features)
	}
	if !caps.Features.Backup || !caps.Features.Service {
		t.Errorf("backup/service 特性应为 true: %+v", caps.Features)
	}

	var cfg configResult
	if err := json.Unmarshal(got[3].Result, &cfg); err != nil {
		t.Fatalf("解析 config.get: %v", err)
	}
	if cfg.DataDir != dir || cfg.Listen != listener.Addr().String() {
		t.Errorf("config.get 路径/监听不对: %+v", cfg)
	}
	if cfg.APIOrigin != "https://api.deepseek.com" || cfg.BackupDir != backupDir {
		t.Errorf("config.get 来源/备份目录不对: %+v", cfg)
	}
	if cfg.Version != buildinfo.Version {
		t.Errorf("config.get version=%q", cfg.Version)
	}
	var rawConfig map[string]json.RawMessage
	if err := json.Unmarshal(got[3].Result, &rawConfig); err != nil {
		t.Fatalf("解析原始 config.get: %v", err)
	}
	if len(rawConfig) != 5 {
		t.Errorf("config.get 应只有 5 个字段，得到 %d: %s", len(rawConfig), got[3].Result)
	}
	for _, forbidden := range []string{"public_url", "publicUrl", "password", "key", "secret"} {
		if _, ok := rawConfig[forbidden]; ok {
			t.Errorf("config.get 不应返回 %q", forbidden)
		}
	}

	var list backupListResult
	if err := json.Unmarshal(got[4].Result, &list); err != nil {
		t.Fatalf("解析 backup.list: %v", err)
	}
	if list.Dir != backupDir || len(list.Backups) != 1 {
		t.Fatalf("backup.list 结果不对: %+v", list)
	}
	entry := list.Backups[0]
	if entry.File != filepath.Base(archive) || entry.Path != archive || entry.Size != 10 {
		t.Errorf("backup 条目不对: %+v", entry)
	}
	if _, err := time.Parse(time.RFC3339, entry.MTime); err != nil {
		t.Errorf("mtime 不是 RFC3339: %q (%v)", entry.MTime, err)
	}
}

func TestUnknownMethod(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")
	responses, _ := serve(t, server, requestLine(9, "no.such.method")+"\n")
	if len(responses) != 1 {
		t.Fatalf("期望 1 个响应，得到 %d", len(responses))
	}
	resp := responses[0]
	if string(resp.ID) != "9" {
		t.Errorf("id=%s，期望 9", resp.ID)
	}
	if resp.Error == nil || resp.Error.Code != codeNotFound {
		t.Fatalf("期望 not_found，得到 %+v", resp.Error)
	}
	if len(resp.Result) != 0 {
		t.Errorf("错误响应不应带 result: %s", resp.Result)
	}
}

func TestBadJSONThenContinue(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")
	input := "这不是 JSON\n" + requestLine(7, "system.capabilities") + "\n"
	responses, _ := serve(t, server, input)
	if len(responses) != 2 {
		t.Fatalf("坏 JSON 后应继续服务，期望 2 个响应，得到 %d", len(responses))
	}
	var bad, good *testResponse
	for i := range responses {
		if responses[i].Error != nil && responses[i].Error.Code == codeBadRequest {
			bad = &responses[i]
		}
		if string(responses[i].ID) == "7" {
			good = &responses[i]
		}
	}
	if bad == nil {
		t.Fatalf("缺少 bad_request 响应: %+v", responses)
	}
	if string(bad.ID) != "null" {
		t.Errorf("无法解析 id 时应返回 null，得到 %s", bad.ID)
	}
	if good == nil || good.Error != nil {
		t.Fatalf("后续请求应成功: %+v", responses)
	}
}

func TestStdoutOnlyProtocolLines(t *testing.T) {
	dir := t.TempDir()
	if err := config.Save(dir, config.Config{Listen: "127.0.0.1:1"}); err != nil {
		t.Fatalf("写入配置: %v", err)
	}
	var stderr bytes.Buffer
	server, err := New(dir, &stderr)
	if err != nil {
		t.Fatalf("创建服务: %v", err)
	}
	input := "坏 JSON\n" + requestLine(1, "no.such.method") + "\n\n" +
		requestLine(2, "system.status") + "\n"
	responses, output := serve(t, server, input)
	if len(responses) != 3 {
		t.Fatalf("空行不应产生响应；期望 3 个响应，得到 %d\n%s", len(responses), output)
	}
	for i, line := range strings.Split(strings.TrimSuffix(output, "\n"), "\n") {
		if !json.Valid([]byte(line)) {
			t.Errorf("第 %d 行不是协议 JSON: %q", i+1, line)
		}
		if strings.Contains(line, "ipc:") {
			t.Errorf("日志泄漏到 stdout: %q", line)
		}
	}
	if stderr.Len() == 0 {
		t.Error("坏请求应记录到 stderr")
	}
}

func TestCapabilitiesMatchesRegistry(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")
	value, rpcErr := server.systemCapabilities()
	if rpcErr != nil {
		t.Fatalf("capabilities: %+v", rpcErr)
	}
	caps := value.(capabilitiesResult)
	expected := []string{
		"system.status",
		"system.capabilities",
		"config.get",
		"backup.list",
		"backup.create",
		"backup.restore",
		"backup.delete",
		"service.start",
		"service.stop",
		"service.restart",
		"service.logs",
	}
	if len(caps.Methods) != len(expected) {
		t.Fatalf("methods=%v，期望 %v", caps.Methods, expected)
	}
	for i, name := range expected {
		if caps.Methods[i] != name {
			t.Errorf("methods[%d]=%q，期望 %q", i, caps.Methods[i], name)
		}
		if _, ok := server.methods[name]; !ok {
			t.Errorf("%q 不在注册表里", name)
		}
	}
	if len(server.methods) != len(expected) {
		t.Errorf("注册表有 %d 个方法，capabilities 有 %d 个", len(server.methods), len(expected))
	}
}

func TestBackupListMissingDirectory(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	value, rpcErr := server.backupList()
	if rpcErr != nil {
		t.Fatalf("backup.list: %+v", rpcErr)
	}
	result := value.(backupListResult)
	if result.Dir != filepath.Join(dir, "backups") {
		t.Errorf("dir=%q", result.Dir)
	}
	if result.Backups == nil {
		t.Fatal("目录不存在时应返回空数组，而不是 nil")
	}
	if len(result.Backups) != 0 {
		t.Errorf("期望空数组，得到 %+v", result.Backups)
	}
	data, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("序列化: %v", err)
	}
	if !strings.Contains(string(data), `"backups":[]`) {
		t.Errorf("JSON 应包含空数组: %s", data)
	}
}

func TestOversizedLineThenContinue(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")
	input := strings.Repeat("x", MaxLineBytes+1) + "\n" + requestLine(5, "system.capabilities") + "\n"
	responses, _ := serve(t, server, input)
	if len(responses) != 2 {
		t.Fatalf("超长行后应继续服务，期望 2 个响应，得到 %d", len(responses))
	}
	var bad, good *testResponse
	for i := range responses {
		if responses[i].Error != nil && responses[i].Error.Code == codeBadRequest {
			bad = &responses[i]
		}
		if string(responses[i].ID) == "5" {
			good = &responses[i]
		}
	}
	if bad == nil {
		t.Fatalf("超长行应为 bad_request: %+v", responses)
	}
	if good == nil || good.Error != nil {
		t.Fatalf("后续请求应成功: %+v", responses)
	}
}

func TestProbeStates(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("监听: %v", err)
	}
	addr := listener.Addr().String()
	if state := probeServiceState(addr, 100*time.Millisecond); state != stateRunning {
		t.Errorf("监听中应为 running，得到 %q", state)
	}
	if err := listener.Close(); err != nil {
		t.Fatalf("关闭监听: %v", err)
	}
	if state := probeServiceState(addr, 100*time.Millisecond); state != stateStopped {
		t.Errorf("监听关闭后应为 stopped，得到 %q", state)
	}
	if state := probeServiceState("不是地址", 100*time.Millisecond); state != stateUnknown {
		t.Errorf("非法地址应为 unknown，得到 %q", state)
	}
	if state := probeServiceState(addr, 0); state != stateStopped {
		t.Errorf("timeout 为 0 时应回落到默认值并得到 stopped，得到 %q", state)
	}
}

func TestStatusWithInvalidListenIsUnknown(t *testing.T) {
	server, _ := newTestServer(t, "not-a-host-port")
	value, rpcErr := server.systemStatus()
	if rpcErr != nil {
		t.Fatalf("status: %+v", rpcErr)
	}
	status := value.(statusResult)
	if status.Service.State != stateUnknown {
		t.Errorf("无效监听地址应为 unknown，得到 %q", status.Service.State)
	}
}

func TestRunEOFAndUsage(t *testing.T) {
	dir := t.TempDir()
	if err := config.Save(dir, config.Config{Listen: "127.0.0.1:1"}); err != nil {
		t.Fatalf("写入配置: %v", err)
	}
	var out, stderr bytes.Buffer
	if code := Run([]string{"--data-dir", dir}, strings.NewReader(""), &out, &stderr); code != 0 {
		t.Fatalf("stdin EOF 应以 0 退出，得到 %d（stderr=%s）", code, stderr.String())
	}
	if out.Len() != 0 {
		t.Errorf("EOF 不应产生输出: %q", out.String())
	}

	out.Reset()
	stderr.Reset()
	input := requestLine(1, "system.capabilities") + "\n"
	if code := Run([]string{"--data-dir", dir}, strings.NewReader(input), &out, &stderr); code != 0 {
		t.Fatalf("正常请求应以 0 退出，得到 %d（stderr=%s）", code, stderr.String())
	}
	if len(parseResponses(t, out.String())) != 1 {
		t.Errorf("期望 1 个响应: %q", out.String())
	}

	out.Reset()
	stderr.Reset()
	if code := Run([]string{"--no-such-flag"}, strings.NewReader(""), &out, &stderr); code != 2 {
		t.Errorf("未知参数应以 2 退出，得到 %d", code)
	}
	if out.Len() != 0 {
		t.Errorf("用法错误不应写 stdout: %q", out.String())
	}
}
