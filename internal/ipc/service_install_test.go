package ipc

import (
	"bytes"
	"encoding/json"
	"errors"
	"log"
	"path/filepath"
	"strings"
	"testing"

	"github.com/elegantgx/chat-deepseek/internal/service"
)

func TestServiceInstallReturnsUnitPath(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	seedActiveOwner(t, dir)
	fake := &fakeServiceController{
		installResult: service.InstallResult{UnitPath: "/tmp/chat-deepseek.service"},
	}
	useFakeService(server, fake)

	value, rpcErr := server.serviceInstall(nil)
	if rpcErr != nil {
		t.Fatalf("service.install: %+v", rpcErr)
	}
	result := value.(serviceInstallResult)
	if !result.OK || result.UnitPath != "/tmp/chat-deepseek.service" {
		t.Fatalf("service.install = %+v", result)
	}

	fake.mu.Lock()
	opts := fake.lastInstall
	installs := fake.installs
	fake.mu.Unlock()
	if installs != 1 {
		t.Fatalf("Install 调用 %d 次", installs)
	}
	if opts.Scope != service.ScopeUser || opts.DataDir != dir || !filepath.IsAbs(opts.Binary) || opts.Force {
		t.Fatalf("InstallOptions = %+v", opts)
	}
}

func TestServiceInstallForceParam(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	seedActiveOwner(t, dir)
	fake := &fakeServiceController{installResult: service.InstallResult{UnitPath: "/tmp/chat-deepseek.service"}}
	useFakeService(server, fake)

	if _, rpcErr := server.serviceInstall(jsonParams(t, map[string]bool{"force": true})); rpcErr != nil {
		t.Fatalf("force=true: %+v", rpcErr)
	}
	fake.mu.Lock()
	force := fake.lastInstall.Force
	fake.mu.Unlock()
	if !force {
		t.Fatal("force=true 应传给 InstallOptions.Force")
	}

	if _, rpcErr := server.serviceInstall(jsonParams(t, map[string]bool{"force": false})); rpcErr != nil {
		t.Fatalf("force=false: %+v", rpcErr)
	}
	fake.mu.Lock()
	force = fake.lastInstall.Force
	fake.mu.Unlock()
	if force {
		t.Fatal("force=false 不应覆盖已有 unit")
	}

	fake.mu.Lock()
	before := fake.installs
	fake.mu.Unlock()
	_, rpcErr := server.serviceInstall(json.RawMessage(`{"force":"yes"}`))
	if rpcErr == nil || rpcErr.Code != codeBadRequest {
		t.Fatalf("非法 force = %+v，期望 bad_request", rpcErr)
	}
	fake.mu.Lock()
	after := fake.installs
	fake.mu.Unlock()
	if after != before {
		t.Fatalf("参数非法时不应调用 Install（before=%d after=%d）", before, after)
	}
}

func TestServiceInstallEnableParam(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	seedActiveOwner(t, dir)
	fake := &fakeServiceController{
		installResult: service.InstallResult{UnitPath: "/tmp/chat-deepseek.service"},
	}
	useFakeService(server, fake)

	cases := []struct {
		name   string
		params json.RawMessage
		want   bool
	}{
		{name: "缺省", params: nil, want: false},
		{name: "null", params: json.RawMessage(`null`), want: false},
		{name: "false", params: json.RawMessage(`{"enable":false}`), want: false},
		{name: "true", params: json.RawMessage(`{"enable":true}`), want: true},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if _, rpcErr := server.serviceInstall(testCase.params); rpcErr != nil {
				t.Fatalf("service.install: %+v", rpcErr)
			}
			fake.mu.Lock()
			enable := fake.lastInstall.Enable
			fake.mu.Unlock()
			if enable != testCase.want {
				t.Fatalf("InstallOptions.Enable = %v，期望 %v", enable, testCase.want)
			}
		})
	}
}

func TestServiceInstallInvalidEnable(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	seedActiveOwner(t, dir)
	fake := &fakeServiceController{installResult: service.InstallResult{UnitPath: "/tmp/x"}}
	useFakeService(server, fake)

	_, rpcErr := server.serviceInstall(json.RawMessage(`{"enable":"yes"}`))
	if rpcErr == nil || rpcErr.Code != codeBadRequest {
		t.Fatalf("非法 enable = %+v，期望 bad_request", rpcErr)
	}
	if !strings.HasPrefix(rpcErr.Message, "enable") {
		t.Fatalf("message = %q，应以字段名开头", rpcErr.Message)
	}
	if fake.installs != 0 {
		t.Fatal("参数非法时不应调用 Install")
	}
}

func TestServiceInstallResultCarriesWarnings(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	seedActiveOwner(t, dir)
	// 换成可观测的 stderr：warnings 属于用户可见信息，必须随结果返回，
	// 不再走 s.logf，否则桌面端看不见。
	var stderr bytes.Buffer
	server.logger = log.New(&stderr, "ipc: ", 0)
	warning := "未开启 linger：注销后服务会停止。以该用户执行：loginctl enable-linger <user>"
	fake := &fakeServiceController{
		installResult: service.InstallResult{
			UnitPath: "/tmp/chat-deepseek.service",
			Enabled:  true,
			Warnings: []string{warning},
		},
	}
	useFakeService(server, fake)

	value, rpcErr := server.serviceInstall(json.RawMessage(`{"enable":true}`))
	if rpcErr != nil {
		t.Fatalf("service.install: %+v", rpcErr)
	}
	result := value.(serviceInstallResult)
	if !result.Enabled {
		t.Fatal("enabled 应原样透传 InstallResult.Enabled")
	}
	if len(result.Warnings) != 1 || result.Warnings[0] != warning {
		t.Fatalf("warnings = %v，期望原样透传 %q", result.Warnings, warning)
	}
	if strings.Contains(stderr.String(), "linger") {
		t.Fatalf("warnings 不应写 stderr: %q", stderr.String())
	}

	// 没有 warning 时必须是 []，不能让界面拿到 null。
	fake.installResult = service.InstallResult{UnitPath: "/tmp/chat-deepseek.service"}
	value, rpcErr = server.serviceInstall(nil)
	if rpcErr != nil {
		t.Fatalf("service.install: %+v", rpcErr)
	}
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("编码结果: %v", err)
	}
	if !strings.Contains(string(data), `"warnings":[]`) {
		t.Fatalf("空 warnings 应为 []: %s", data)
	}
	if strings.Contains(string(data), `"warnings":null`) {
		t.Fatalf("warnings 不应是 null: %s", data)
	}
}

func TestServiceInstallUnavailable(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	seedActiveOwner(t, dir)
	fake := &fakeServiceController{
		supportErr: errors.New("当前平台不支持 systemd 服务；请用 tmux 托管"),
	}
	useFakeService(server, fake)

	_, rpcErr := server.serviceInstall(nil)
	if rpcErr == nil || rpcErr.Code != codeUnavailable {
		t.Fatalf("service.install = %+v，期望 unavailable", rpcErr)
	}
	if rpcErr.Message != "当前平台不支持 systemd 服务；请用 tmux 托管" {
		t.Fatalf("message = %q", rpcErr.Message)
	}
	if fake.installs != 0 {
		t.Fatal("平台不支持时不应调用 Install")
	}
}

func TestServiceInstallRequiresInitializedDataDir(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")
	fake := &fakeServiceController{installResult: service.InstallResult{UnitPath: "/tmp/x"}}
	useFakeService(server, fake)

	_, rpcErr := server.serviceInstall(nil)
	if rpcErr == nil || rpcErr.Code != codeUnavailable {
		t.Fatalf("service.install = %+v，期望 unavailable", rpcErr)
	}
	if !strings.Contains(rpcErr.Message, "数据目录尚未初始化") {
		t.Fatalf("message = %q", rpcErr.Message)
	}
	if fake.installs != 0 {
		t.Fatal("数据目录未初始化时不应写 unit")
	}
}

func TestServiceInstallErrorBecomesUnavailable(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	seedActiveOwner(t, dir)
	fake := &fakeServiceController{installErr: errors.New("unit 已存在：/tmp/chat-deepseek.service；如需覆盖请加 --force")}
	useFakeService(server, fake)

	_, rpcErr := server.serviceInstall(nil)
	if rpcErr == nil || rpcErr.Code != codeUnavailable {
		t.Fatalf("service.install = %+v，期望 unavailable", rpcErr)
	}
}

func TestServiceUninstall(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")
	fake := &fakeServiceController{uninstallDone: true}
	useFakeService(server, fake)

	value, rpcErr := server.serviceUninstall(nil)
	if rpcErr != nil || !value.(okResult).OK {
		t.Fatalf("service.uninstall = %+v / %+v", value, rpcErr)
	}
	fake.mu.Lock()
	uninstalls := fake.uninstalls
	fake.mu.Unlock()
	if uninstalls != 1 {
		t.Fatalf("Uninstall 调用 %d 次", uninstalls)
	}

	// unit 本来就不存在时仍返回 ok，保持 CLI 的幂等语义。
	fake.uninstallDone = false
	if value, rpcErr := server.serviceUninstall(nil); rpcErr != nil || !value.(okResult).OK {
		t.Fatalf("未安装时 service.uninstall = %+v / %+v", value, rpcErr)
	}

	fake.removeErr = errors.New("删除 unit 文件失败: permission denied")
	if _, rpcErr := server.serviceUninstall(nil); rpcErr == nil || rpcErr.Code != codeUnavailable {
		t.Fatalf("service.uninstall 错误 = %+v，期望 unavailable", rpcErr)
	}

	fake.removeErr = nil
	fake.supportErr = errors.New("当前平台不支持 systemd 服务")
	if _, rpcErr := server.serviceUninstall(nil); rpcErr == nil || rpcErr.Code != codeUnavailable {
		t.Fatalf("service.uninstall 平台错误 = %+v，期望 unavailable", rpcErr)
	}
}

func TestServiceInstallSerialized(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")
	fake := &fakeServiceController{}
	useFakeService(server, fake)

	// 占住服务操作信号量，模拟 start/stop/restart 正在进行。
	server.serviceOp <- struct{}{}
	defer func() { <-server.serviceOp }()
	_, rpcErr := server.serviceInstall(nil)
	if rpcErr == nil || rpcErr.Code != codeUnavailable {
		t.Fatalf("并发 service.install = %+v，期望 unavailable", rpcErr)
	}
	if rpcErr.Message != "服务操作正在进行，请稍候" {
		t.Fatalf("message = %q", rpcErr.Message)
	}
}
