package ipc

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/elegantgx/chat-deepseek/internal/config"
	"github.com/elegantgx/chat-deepseek/internal/service"
)

// useUninstalledService 让服务方法走本地进程分支：平台支持 systemd，但 unit 没装。
func useUninstalledService(server *Server) *fakeServiceController {
	fake := &fakeServiceController{status: service.Status{Supported: true}}
	server.newService = func() serviceController { return fake }
	server.newLogTailer = func() (logTailer, error) { return &fakeLogTailer{}, nil }
	return fake
}

// sleepProcessCmd 用系统 sleep 冒充 serve，避免真的启动 HTTP 服务。
// Windows 没有 sleep；相关用例在 Windows 上跳过。
func sleepProcessCmd(t *testing.T, calls *int) func(string, []string) *exec.Cmd {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("本地进程用例用 sleep 子进程，Windows 上跳过")
	}
	return func(string, []string) *exec.Cmd {
		if calls != nil {
			*calls++
		}
		return exec.Command("sleep", "30")
	}
}

func TestServiceStartFallsBackToLocalProcess(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")
	server.localStartTimeout = 150 * time.Millisecond
	fake := useUninstalledService(server)

	if runtime.GOOS == "windows" {
		t.Skip("本地进程用例用 sleep 子进程，Windows 上跳过")
	}
	var spawned int
	var gotBinary string
	var gotArgs []string
	server.newProcessCmd = func(binary string, args []string) *exec.Cmd {
		spawned++
		gotBinary = binary
		gotArgs = append([]string(nil), args...)
		return exec.Command("sleep", "30")
	}

	value, rpcErr := server.serviceStart(nil)
	if rpcErr != nil {
		t.Fatalf("service.start: %+v", rpcErr)
	}
	t.Cleanup(func() {
		if err := server.stopLocalProcess(); err != nil {
			t.Errorf("清理本地进程: %v", err)
		}
	})
	result := value.(serviceStateResult)
	if result.State != "starting" {
		t.Fatalf("state = %q，期望 starting（sleep 不监听端口）", result.State)
	}
	if result.PID <= 0 {
		t.Fatalf("pid = %d，本地进程应返回真实 pid", result.PID)
	}
	if result.Listen != "127.0.0.1:1" {
		t.Fatalf("listen = %q", result.Listen)
	}
	if starts, _, _ := fake.counts(); starts != 0 {
		t.Fatalf("unit 未安装时不应调用 systemd 控制器 Start，调用 %d 次", starts)
	}
	if spawned != 1 {
		t.Fatalf("本地 spawn 调用 %d 次，期望 1 次", spawned)
	}
	if !filepath.IsAbs(gotBinary) {
		t.Fatalf("二进制路径 = %q，期望绝对路径", gotBinary)
	}
	wantArgs := []string{
		"serve",
		"--data-dir", server.dataDir,
		"--listen", "127.0.0.1:1",
		"--no-browser",
	}
	if !reflect.DeepEqual(gotArgs, wantArgs) {
		t.Fatalf("参数 = %v，期望 %v", gotArgs, wantArgs)
	}

	// mode 与 state 正交：端口没通（sleep 不监听），但进程归 ipc 管。
	statusValue, rpcErr := server.systemStatus()
	if rpcErr != nil {
		t.Fatalf("system.status: %+v", rpcErr)
	}
	info := statusValue.(statusResult).Service
	if info.Mode != serviceModeProcess {
		t.Fatalf("mode = %q，期望 %q", info.Mode, serviceModeProcess)
	}
	if info.State != stateStopped {
		t.Fatalf("state = %q，期望 stopped", info.State)
	}
}

func TestLocalProcessOutputIsBufferedAndFormatted(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")

	var events bytes.Buffer
	server.setWriter(&protocolWriter{out: bufio.NewWriter(&events)})
	t.Cleanup(func() { server.setWriter(nil) })

	var readers sync.WaitGroup
	readers.Add(1)
	server.consumeProcessOutput(strings.NewReader("hello\n\nfirst\rsecond\r\n"), "stdout", &readers)
	readers.Add(1)
	server.consumeProcessOutput(strings.NewReader("boom"), "stderr", &readers)
	readers.Wait()

	lines := server.procLog.tail(10)
	want := []string{
		"info hello",
		"info first / second",
		"error boom",
	}
	if len(lines) != len(want) {
		t.Fatalf("缓冲 = %v，期望 %d 行（空行丢弃、\r 折叠成 /）", lines, len(want))
	}
	for index, line := range lines {
		if !logLineContract.MatchString(line) {
			t.Fatalf("第 %d 行不符合 HH:MM:SS LEVEL message: %q", index+1, line)
		}
		if got := strings.ToLower(line[len("15:04:05 "):]); !strings.HasSuffix(got, want[index]) {
			t.Fatalf("第 %d 行 = %q，期望结尾 %q", index+1, line, want[index])
		}
	}

	// 事件与快照同源：每行一条 event.service.log，stream 与来源一致。
	rawEvents := strings.Split(strings.TrimSuffix(events.String(), "\n"), "\n")
	if len(rawEvents) != len(want) {
		t.Fatalf("事件数 = %d，期望 %d: %v", len(rawEvents), len(want), rawEvents)
	}
	for index, raw := range rawEvents {
		var event struct {
			JSONRPC string          `json:"jsonrpc"`
			Method  string          `json:"method"`
			Params  serviceLogEvent `json:"params"`
		}
		if err := json.Unmarshal([]byte(raw), &event); err != nil {
			t.Fatalf("解析事件 %d: %v", index, err)
		}
		if event.Method != "event.service.log" || event.JSONRPC != "2.0" {
			t.Fatalf("事件 %d = %+v", index, event)
		}
		if event.Params.Line != lines[index] {
			t.Fatalf("事件行 %q != 快照行 %q", event.Params.Line, lines[index])
		}
	}
	if rawEvents[0] == "" || !strings.Contains(rawEvents[0], `"stream":"stdout"`) {
		t.Fatalf("stdout 事件 stream 不对: %s", rawEvents[0])
	}
	if !strings.Contains(rawEvents[2], `"stream":"stderr"`) {
		t.Fatalf("stderr 事件 stream 不对: %s", rawEvents[2])
	}
	if strings.Contains(rawEvents[1], "\r") {
		t.Fatalf("事件行不能带回车: %s", rawEvents[1])
	}

	// service.logs 优先从缓冲取最近 N 行，不碰 journal。
	value, rpcErr := server.serviceLogs(jsonParams(t, map[string]int{"tail": 2}))
	if rpcErr != nil {
		t.Fatalf("service.logs: %+v", rpcErr)
	}
	result := value.(serviceLogsResult)
	if len(result.Lines) != 2 || result.Lines[0] != lines[1] || result.Lines[1] != lines[2] {
		t.Fatalf("service.logs = %v，期望最后两行 %v", result.Lines, lines[1:])
	}
	value, rpcErr = server.serviceLogs(jsonParams(t, map[string]int{"tail": maxLogTail + 1}))
	if rpcErr != nil {
		t.Fatalf("service.logs 超上限: %+v", rpcErr)
	}
	if !value.(serviceLogsResult).Truncated {
		t.Fatal("tail 超上限时应保留 truncated=true")
	}

	// 缓冲有界：超过容量后只保留最近 2000 行。
	for index := 0; index < localLogCapacity+100; index++ {
		server.procLog.add(fmt.Sprintf("filler %d", index))
	}
	if got := len(server.procLog.tail(localLogCapacity + 10)); got != localLogCapacity {
		t.Fatalf("缓冲长度 = %d，期望上限 %d", got, localLogCapacity)
	}
	if tail := server.procLog.tail(1); tail[0] != fmt.Sprintf("filler %d", localLogCapacity+99) {
		t.Fatalf("最近一行 = %q", tail[0])
	}
}

func TestServiceStopTerminatesLocalProcess(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")
	server.localStartTimeout = 100 * time.Millisecond
	server.localStopTimeout = 2 * time.Second
	fake := useUninstalledService(server)

	var spawned int
	server.newProcessCmd = sleepProcessCmd(t, &spawned)

	if _, rpcErr := server.serviceStart(nil); rpcErr != nil {
		t.Fatalf("service.start: %+v", rpcErr)
	}
	process := server.localProcess()
	if process == nil {
		t.Fatal("service.start 后应有本地进程")
	}

	value, rpcErr := server.serviceStop(nil)
	if rpcErr != nil {
		t.Fatalf("service.stop: %+v", rpcErr)
	}
	if value.(serviceStopResult).State != stateStopped {
		t.Fatalf("service.stop = %+v", value)
	}
	select {
	case <-process.done:
	default:
		t.Fatal("service.stop 返回时子进程应已经退出并被回收")
	}
	if server.localProcessRunning() {
		t.Fatal("停止后不应再登记本地进程")
	}
	if starts, stops, _ := fake.counts(); starts != 0 || stops != 0 {
		t.Fatalf("本地模式不应调用 systemd：starts=%d stops=%d", starts, stops)
	}
}

func TestServiceModeProjection(t *testing.T) {
	t.Run("process", func(t *testing.T) {
		server, _ := newTestServer(t, "127.0.0.1:1")
		fake := &fakeServiceController{status: service.Status{Supported: true}}
		server.newService = func() serviceController { return fake }
		process := &localServiceProcess{pid: 4242, done: make(chan struct{})}
		server.procMu.Lock()
		server.proc = process
		server.procMu.Unlock()
		t.Cleanup(func() {
			server.procMu.Lock()
			server.proc = nil
			server.procMu.Unlock()
			close(process.done)
		})

		value, rpcErr := server.systemStatus()
		if rpcErr != nil {
			t.Fatalf("system.status: %+v", rpcErr)
		}
		info := value.(statusResult).Service
		if info.Mode != serviceModeProcess {
			t.Fatalf("mode = %q，期望 %q", info.Mode, serviceModeProcess)
		}
		fields := jsonFields(t, info)
		if _, ok := fields["mode"]; !ok {
			t.Fatalf("service 字段缺少 mode: %v", fields)
		}
	})

	for _, testCase := range []struct {
		name     string
		status   service.Status
		wantMode string
	}{
		{
			name:     "systemd",
			status:   service.Status{Supported: true, Installed: true},
			wantMode: serviceModeSystemd,
		},
		{
			name:     "none",
			status:   service.Status{Supported: true},
			wantMode: serviceModeNone,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			server, _ := newTestServer(t, "127.0.0.1:1")
			fake := &fakeServiceController{status: testCase.status}
			server.newService = func() serviceController { return fake }

			value, rpcErr := server.systemStatus()
			if rpcErr != nil {
				t.Fatalf("system.status: %+v", rpcErr)
			}
			if mode := value.(statusResult).Service.Mode; mode != testCase.wantMode {
				t.Fatalf("mode = %q，期望 %q", mode, testCase.wantMode)
			}
		})
	}
}

func TestServiceStartDoesNotSpawnWhenPortBusy(t *testing.T) {
	listener := liveListener(t)
	server, _ := newTestServer(t, listener.Addr().String())
	fake := useUninstalledService(server)

	spawned := false
	server.newProcessCmd = func(string, []string) *exec.Cmd {
		spawned = true
		return exec.Command("sleep", "30")
	}

	_, rpcErr := server.serviceStart(nil)
	if rpcErr == nil || rpcErr.Code != codeUnavailable {
		t.Fatalf("service.start = %+v，期望 unavailable", rpcErr)
	}
	if !strings.Contains(rpcErr.Message, "已被占用") {
		t.Fatalf("message = %q，应说明监听地址已被占用", rpcErr.Message)
	}
	if spawned {
		t.Fatal("端口已被占用时不应 spawn 本地进程")
	}
	if starts, _, _ := fake.counts(); starts != 0 {
		t.Fatalf("不应调用 systemd 控制器 Start，调用 %d 次", starts)
	}
}

func TestServiceStartLocalProcessEarlyExit(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("早期退出用例依赖 sh")
	}
	server, _ := newTestServer(t, "127.0.0.1:1")
	server.localStartTimeout = 2 * time.Second
	useUninstalledService(server)
	server.newProcessCmd = func(string, []string) *exec.Cmd {
		return exec.Command("sh", "-c", "echo 'listen failed: address already in use' >&2; exit 1")
	}

	_, rpcErr := server.serviceStart(nil)
	if rpcErr == nil || rpcErr.Code != codeUnavailable {
		t.Fatalf("service.start = %+v，期望 unavailable", rpcErr)
	}
	if !strings.Contains(rpcErr.Message, "本地服务进程启动失败") {
		t.Fatalf("message = %q，应说明本地进程启动失败", rpcErr.Message)
	}
	if !strings.Contains(rpcErr.Message, "listen failed") {
		t.Fatalf("message = %q，应带上最后几行输出", rpcErr.Message)
	}
}

func TestServeShutdownReapsLocalProcess(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")
	server.newProcessCmd = sleepProcessCmd(t, nil)

	cfg, err := config.Load(server.dataDir)
	if err != nil {
		t.Fatalf("读取配置: %v", err)
	}
	process, err := server.startLocalProcess(cfg)
	if err != nil {
		t.Fatalf("startLocalProcess: %v", err)
	}

	// Serve 读到 EOF 后的退出路径必须回收子进程，不能留孤儿。
	serve(t, server, "")

	select {
	case <-process.done:
	default:
		t.Fatal("Serve 返回后本地进程仍未被回收")
	}
	if server.localProcessRunning() {
		t.Fatal("Serve 返回后不应再登记本地进程")
	}
}

func TestServiceRestartLocalProcess(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")
	server.localStartTimeout = 100 * time.Millisecond
	server.localStopTimeout = 2 * time.Second
	useUninstalledService(server)

	var spawned int
	server.newProcessCmd = sleepProcessCmd(t, &spawned)

	if _, rpcErr := server.serviceStart(nil); rpcErr != nil {
		t.Fatalf("service.start: %+v", rpcErr)
	}
	t.Cleanup(func() {
		if err := server.stopLocalProcess(); err != nil {
			t.Errorf("清理本地进程: %v", err)
		}
	})
	first := server.localProcess()

	// 重复 start 不应该再 spawn。
	if _, rpcErr := server.serviceStart(nil); rpcErr != nil {
		t.Fatalf("重复 service.start: %+v", rpcErr)
	}
	if spawned != 1 {
		t.Fatalf("重复 start 又 spawn 了进程（共 %d 次）", spawned)
	}

	value, rpcErr := server.serviceRestart(nil)
	if rpcErr != nil {
		t.Fatalf("service.restart: %+v", rpcErr)
	}
	if value.(serviceStateResult).State != "starting" {
		t.Fatalf("service.restart = %+v", value)
	}
	second := server.localProcess()
	if second == nil || second == first {
		t.Fatal("restart 后应换成新的本地进程")
	}
	select {
	case <-first.done:
	default:
		t.Fatal("restart 应先回收旧进程")
	}
	if spawned != 2 {
		t.Fatalf("restart 后 spawn 次数 = %d，期望 2", spawned)
	}
	statusValue, rpcErr := server.systemStatus()
	if rpcErr != nil {
		t.Fatalf("system.status: %+v", rpcErr)
	}
	if mode := statusValue.(statusResult).Service.Mode; mode != serviceModeProcess {
		t.Fatalf("restart 后 mode = %q，期望 %q", mode, serviceModeProcess)
	}
}

func TestLocalProcessLogLevelFromSlogToken(t *testing.T) {
	cases := []struct {
		name        string
		stream      string
		raw         string
		wantLevel   string
		wantAbsent  string
		wantPresent string
	}{
		{
			name:        "stderr 带 level=INFO",
			stream:      "stderr",
			raw:         `time=2026-11-27T05:00:00.000+08:00 level=INFO msg="serve listening"`,
			wantLevel:   "INFO",
			wantAbsent:  "level=",
			wantPresent: "msg=\"serve listening\"",
		},
		{
			name:      "stderr 无级别回退 ERROR",
			stream:    "stderr",
			raw:       "boom",
			wantLevel: "ERROR",
		},
		{
			name:       "stdout 带 level=WARN",
			stream:     "stdout",
			raw:        "level=WARN disk nearly full",
			wantLevel:  "WARN",
			wantAbsent: "level=",
		},
		{
			name:       "DEBUG 归 INFO",
			stream:     "stderr",
			raw:        "level=DEBUG trace detail",
			wantLevel:  "INFO",
			wantAbsent: "level=",
		},
		{
			name:       "带引号的级别值",
			stream:     "stderr",
			raw:        `level="ERROR" failed to listen`,
			wantLevel:  "ERROR",
			wantAbsent: "level=",
		},
		{
			name:        "消息正文里的 level= 不误删",
			stream:      "stderr",
			raw:         `msg="level=INFO"`,
			wantLevel:   "ERROR",
			wantPresent: "level=INFO",
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			line := formatLocalLogLine(testCase.stream, testCase.raw)
			if !logLineContract.MatchString(line) {
				t.Fatalf("不符合 HH:MM:SS LEVEL message: %q", line)
			}
			if !strings.Contains(line, " "+testCase.wantLevel+" ") {
				t.Fatalf("line = %q，期望级别 %s", line, testCase.wantLevel)
			}
			if testCase.wantAbsent != "" && strings.Contains(line, testCase.wantAbsent) {
				t.Fatalf("line = %q，不应包含 %q", line, testCase.wantAbsent)
			}
			if testCase.wantPresent != "" && !strings.Contains(line, testCase.wantPresent) {
				t.Fatalf("line = %q，应保留 %q", line, testCase.wantPresent)
			}
		})
	}
}

func TestServiceLogsPrefersJournalWhenUnitInstalled(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")
	useInstalledService(server)
	// 本地模式留下的旧缓冲不应该在 unit 接管后继续挡住 journal。
	server.procLog.add("09:00:00 INFO stale local line")
	server.newLogTailer = func() (logTailer, error) {
		return &fakeLogTailer{lines: []string{"09:00:05 INFO journal line"}}, nil
	}

	value, rpcErr := server.serviceLogs(nil)
	if rpcErr != nil {
		t.Fatalf("service.logs: %+v", rpcErr)
	}
	lines := value.(serviceLogsResult).Lines
	if len(lines) != 1 || lines[0] != "09:00:05 INFO journal line" {
		t.Fatalf("装了 unit 时应读 journal，得到 %v", lines)
	}
}

func TestServiceLogsReturnsLocalHistoryWithoutUnit(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")
	useUninstalledService(server)
	server.procLog.add("09:00:00 INFO local history")

	tailerCalled := false
	server.newLogTailer = func() (logTailer, error) {
		tailerCalled = true
		return &fakeLogTailer{lines: []string{"journal line"}}, nil
	}

	value, rpcErr := server.serviceLogs(nil)
	if rpcErr != nil {
		t.Fatalf("service.logs: %+v", rpcErr)
	}
	lines := value.(serviceLogsResult).Lines
	if len(lines) != 1 || lines[0] != "09:00:00 INFO local history" {
		t.Fatalf("未装 unit 时应返回本地缓冲历史，得到 %v", lines)
	}
	if tailerCalled {
		t.Fatal("未装 unit 且没有活进程时不应读 journal")
	}
}

func TestServiceLogsStatusFailurePrefersBuffer(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")
	server.newService = func() serviceController {
		return &fakeServiceController{statusErr: errors.New("systemctl status 失败")}
	}
	server.procLog.add("09:00:00 INFO kept local line")

	tailerCalled := false
	server.newLogTailer = func() (logTailer, error) {
		tailerCalled = true
		return &fakeLogTailer{}, nil
	}

	value, rpcErr := server.serviceLogs(nil)
	if rpcErr != nil {
		t.Fatalf("service.logs: %+v", rpcErr)
	}
	lines := value.(serviceLogsResult).Lines
	if len(lines) != 1 || lines[0] != "09:00:00 INFO kept local line" {
		t.Fatalf("状态查询失败时应保守返回本地缓冲，得到 %v", lines)
	}
	if tailerCalled {
		t.Fatal("有本地缓冲时不应改读 journal")
	}
}

func TestServiceStopAfterLocalProcessExited(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("退出进程用例依赖 sh")
	}
	server, _ := newTestServer(t, "127.0.0.1:1")
	fake := useUninstalledService(server)
	cfg, err := config.Load(server.dataDir)
	if err != nil {
		t.Fatalf("读取配置: %v", err)
	}
	server.newProcessCmd = func(string, []string) *exec.Cmd {
		return exec.Command("sh", "-c", "exit 0")
	}
	process, err := server.startLocalProcess(cfg)
	if err != nil {
		t.Fatalf("startLocalProcess: %v", err)
	}
	select {
	case <-process.done:
	case <-time.After(5 * time.Second):
		t.Fatal("本地进程没有退出")
	}
	// 退出后保留登记，stop 才能识别出「本地模式已经停了」。
	if server.localProcess() == nil {
		t.Fatal("已退出的本地进程登记应保留")
	}
	if server.localProcessRunning() {
		t.Fatal("已退出的进程不应算 running")
	}

	value, rpcErr := server.serviceStop(nil)
	if rpcErr != nil {
		t.Fatalf("service.stop: %+v", rpcErr)
	}
	if value.(serviceStopResult).State != stateStopped {
		t.Fatalf("service.stop = %+v", value)
	}
	if starts, stops, _ := fake.counts(); starts != 0 || stops != 0 {
		t.Fatalf("进程已退出时 stop 不应落到 systemd：starts=%d stops=%d", starts, stops)
	}
	if server.localProcess() != nil {
		t.Fatal("stop 后应清掉本地进程登记")
	}
}
