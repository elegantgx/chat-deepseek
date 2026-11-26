package ipc

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/elegantgx/chat-deepseek/internal/config"
	"github.com/elegantgx/chat-deepseek/internal/service"
)

// fakeServiceController 让服务方法测试不依赖 systemd。
type fakeServiceController struct {
	mu         sync.Mutex
	starts     int
	stops      int
	restarts   int
	installs   int
	uninstalls int
	startErr   error
	stopErr    error
	restartErr error
	supportErr error
	installErr error
	removeErr  error
	pid        int
	gate       chan struct{}
	entered    chan struct{}
	once       sync.Once

	installResult service.InstallResult
	lastInstall   service.InstallOptions
	uninstallDone bool

	status      service.Status
	statusErr   error
	statusCalls int
}

func (f *fakeServiceController) Start(context.Context) error {
	f.mu.Lock()
	f.starts++
	f.mu.Unlock()
	if f.entered != nil {
		f.once.Do(func() { close(f.entered) })
	}
	if f.gate != nil {
		<-f.gate
	}
	return f.startErr
}

func (f *fakeServiceController) Stop(context.Context) error {
	f.mu.Lock()
	f.stops++
	f.mu.Unlock()
	return f.stopErr
}

func (f *fakeServiceController) Restart(context.Context) error {
	f.mu.Lock()
	f.restarts++
	f.mu.Unlock()
	return f.restartErr
}

func (f *fakeServiceController) MainPID(context.Context) (int, error) {
	return f.pid, nil
}

func (f *fakeServiceController) Status(context.Context) (service.Status, error) {
	f.mu.Lock()
	f.statusCalls++
	f.mu.Unlock()
	return f.status, f.statusErr
}

func (f *fakeServiceController) SupportError() error {
	return f.supportErr
}

func (f *fakeServiceController) Install(
	_ context.Context,
	opts service.InstallOptions,
) (service.InstallResult, error) {
	f.mu.Lock()
	f.installs++
	f.lastInstall = opts
	f.mu.Unlock()
	return f.installResult, f.installErr
}

func (f *fakeServiceController) Uninstall(context.Context) (bool, error) {
	f.mu.Lock()
	f.uninstalls++
	f.mu.Unlock()
	return f.uninstallDone, f.removeErr
}

func (f *fakeServiceController) counts() (int, int, int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.starts, f.stops, f.restarts
}

func useFakeService(server *Server, fake serviceController) {
	server.newService = func() serviceController { return fake }
	// 服务方法测试不依赖本机 journald；跟随源用空实现。
	server.newLogTailer = func() (logTailer, error) { return &fakeLogTailer{}, nil }
}

// useInstalledService 让 service.logs 通过「已安装」检查，避免测试受本机 unit 状态影响；
// 只替换 controller，日志源仍由各用例自己注入。
func useInstalledService(server *Server) *fakeServiceController {
	fake := &fakeServiceController{status: service.Status{Supported: true, Installed: true}}
	server.newService = func() serviceController { return fake }
	return fake
}

func writeDatabase(t *testing.T, dir, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, "chat.db"), []byte(content), 0o600); err != nil {
		t.Fatalf("写入 chat.db: %v", err)
	}
}

func jsonParams(t *testing.T, value any) json.RawMessage {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("序列化参数: %v", err)
	}
	return data
}

func liveListener(t *testing.T) net.Listener {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("监听: %v", err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	return listener
}

func TestServiceStartReturnsRunningStateAndPID(t *testing.T) {
	listener := liveListener(t)
	server, _ := newTestServer(t, listener.Addr().String())
	fake := &fakeServiceController{pid: 4242}
	useFakeService(server, fake)

	value, rpcErr := server.serviceStart(nil)
	if rpcErr != nil {
		t.Fatalf("service.start: %+v", rpcErr)
	}
	result := value.(serviceStateResult)
	if result.State != stateRunning || result.PID != 4242 || result.Listen != listener.Addr().String() {
		t.Fatalf("service.start = %+v", result)
	}
}

func TestServiceStartReportsStartingWhenNotListening(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")
	fake := &fakeServiceController{pid: 7}
	useFakeService(server, fake)

	value, rpcErr := server.serviceStart(nil)
	if rpcErr != nil {
		t.Fatalf("service.start: %+v", rpcErr)
	}
	result := value.(serviceStateResult)
	if result.State != "starting" {
		t.Fatalf("state = %q，期望 starting", result.State)
	}
	if result.Listen != "127.0.0.1:1" {
		t.Fatalf("listen = %q", result.Listen)
	}
}

func TestServiceStopAndRestart(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")
	fake := &fakeServiceController{pid: 9}
	useFakeService(server, fake)

	value, rpcErr := server.serviceStop(nil)
	if rpcErr != nil {
		t.Fatalf("service.stop: %+v", rpcErr)
	}
	if value.(serviceStopResult).State != stateStopped {
		t.Fatalf("service.stop = %+v", value)
	}
	value, rpcErr = server.serviceRestart(nil)
	if rpcErr != nil {
		t.Fatalf("service.restart: %+v", rpcErr)
	}
	if value.(serviceStateResult).State != "starting" {
		t.Fatalf("service.restart = %+v", value)
	}
	starts, stops, restarts := fake.counts()
	if starts != 0 || stops != 1 || restarts != 1 {
		t.Fatalf("calls starts=%d stops=%d restarts=%d", starts, stops, restarts)
	}
}

func TestServiceControllerErrorBecomesUnavailable(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")
	fake := &fakeServiceController{
		startErr:   errors.New("服务未安装（/tmp/chat-deepseek.service）；先运行 chat-deepseek service install"),
		stopErr:    errors.New("服务未安装"),
		restartErr: errors.New("服务未安装"),
	}
	useFakeService(server, fake)

	for name, call := range map[string]func(json.RawMessage) (any, *rpcError){
		"start":   server.serviceStart,
		"stop":    server.serviceStop,
		"restart": server.serviceRestart,
	} {
		_, rpcErr := call(nil)
		if rpcErr == nil || rpcErr.Code != codeUnavailable {
			t.Fatalf("%s error = %+v，期望 unavailable", name, rpcErr)
		}
	}
}

func TestConcurrentServiceStartOnlyOneSucceeds(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")
	fake := &fakeServiceController{
		gate:    make(chan struct{}),
		entered: make(chan struct{}),
	}
	useFakeService(server, fake)

	type outcome struct {
		value any
		err   *rpcError
	}
	first := make(chan outcome, 1)
	go func() {
		value, rpcErr := server.serviceStart(nil)
		first <- outcome{value: value, err: rpcErr}
	}()
	select {
	case <-fake.entered:
	case <-time.After(2 * time.Second):
		t.Fatal("第一个 start 没有进入 controller")
	}

	second := make(chan outcome, 1)
	go func() {
		value, rpcErr := server.serviceStart(nil)
		second <- outcome{value: value, err: rpcErr}
	}()
	select {
	case got := <-second:
		if got.err == nil || got.err.Code != codeUnavailable {
			t.Fatalf("并发 start 应返回 unavailable，得到 %+v", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("并发 start 被阻塞，应立即失败")
	}

	close(fake.gate)
	select {
	case got := <-first:
		if got.err != nil {
			t.Fatalf("第一个 start 失败: %+v", got.err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("第一个 start 没有完成")
	}
	if starts, _, _ := fake.counts(); starts != 1 {
		t.Fatalf("controller.Start 调用 %d 次，期望 1 次", starts)
	}
}

func TestBackupCreateSuccess(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	writeDatabase(t, dir, "database")

	value, rpcErr := server.backupCreate(nil)
	if rpcErr != nil {
		t.Fatalf("backup.create: %+v", rpcErr)
	}
	result := value.(backupCreateResult)
	backupDir := filepath.Join(dir, "backups")
	if !strings.HasPrefix(result.File, "chat-deepseek-") || !strings.HasSuffix(result.File, ".zip") {
		t.Fatalf("file = %q", result.File)
	}
	if result.Path != filepath.Join(backupDir, result.File) {
		t.Fatalf("path = %q", result.Path)
	}
	info, err := os.Stat(result.Path)
	if err != nil {
		t.Fatalf("备份文件不存在: %v", err)
	}
	if result.Size != info.Size() || result.Size <= 0 {
		t.Fatalf("size = %d, stat = %d", result.Size, info.Size())
	}
}

func TestBackupCreateRefusesRunningService(t *testing.T) {
	listener := liveListener(t)
	server, dir := newTestServer(t, listener.Addr().String())
	writeDatabase(t, dir, "database")

	_, rpcErr := server.backupCreate(nil)
	if rpcErr == nil || rpcErr.Code != codeUnavailable {
		t.Fatalf("backup.create error = %+v，期望 unavailable", rpcErr)
	}
	if rpcErr.Message != backupRunningMessage {
		t.Fatalf("message = %q，期望 %q", rpcErr.Message, backupRunningMessage)
	}
	if _, err := os.Stat(filepath.Join(dir, "backups")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("服务运行中不应创建 backups 目录: %v", err)
	}
}

func TestBackupCreateRefusesWAL(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	writeDatabase(t, dir, "database")
	if err := os.WriteFile(filepath.Join(dir, "chat.db-wal"), []byte("live"), 0o600); err != nil {
		t.Fatalf("写入 wal: %v", err)
	}
	_, rpcErr := server.backupCreate(nil)
	if rpcErr == nil || rpcErr.Code != codeUnavailable {
		t.Fatalf("backup.create error = %+v，期望 unavailable", rpcErr)
	}
	if rpcErr.Message != backupRunningMessage {
		t.Fatalf("message = %q，期望 %q", rpcErr.Message, backupRunningMessage)
	}
}

func TestBackupCreateWithoutDatabase(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")
	_, rpcErr := server.backupCreate(nil)
	if rpcErr == nil || rpcErr.Code != codeNotFound {
		t.Fatalf("backup.create error = %+v，期望 not_found", rpcErr)
	}
}

func TestBackupRestoreAndDelete(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	writeDatabase(t, dir, "original")

	created, rpcErr := server.backupCreate(nil)
	if rpcErr != nil {
		t.Fatalf("backup.create: %+v", rpcErr)
	}
	archive := created.(backupCreateResult)
	writeDatabase(t, dir, "changed")

	value, rpcErr := server.backupRestore(jsonParams(t, map[string]string{"file": archive.File}))
	if rpcErr != nil {
		t.Fatalf("backup.restore: %+v", rpcErr)
	}
	restored := value.(backupRestoreResult)
	if !restored.OK || !containsString(restored.Restored, "chat.db") {
		t.Fatalf("backup.restore = %+v", restored)
	}
	data, err := os.ReadFile(filepath.Join(dir, "chat.db"))
	if err != nil || string(data) != "original" {
		t.Fatalf("chat.db = %q, err = %v", data, err)
	}

	value, rpcErr = server.backupDelete(jsonParams(t, map[string]string{"file": archive.File}))
	if rpcErr != nil {
		t.Fatalf("backup.delete: %+v", rpcErr)
	}
	if !value.(backupDeleteResult).OK {
		t.Fatalf("backup.delete = %+v", value)
	}
	if _, err := os.Stat(archive.Path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("备份应已删除: %v", err)
	}
}

func TestBackupCreateUsesConfiguredDirectory(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	writeDatabase(t, dir, "database")
	custom := filepath.Join(t.TempDir(), "snapshots")
	if err := config.Save(dir, config.Config{
		Listen:    "127.0.0.1:1",
		APIOrigin: "https://api.deepseek.com",
		BackupDir: custom,
	}); err != nil {
		t.Fatalf("写入配置: %v", err)
	}
	value, rpcErr := server.backupCreate(nil)
	if rpcErr != nil {
		t.Fatalf("backup.create: %+v", rpcErr)
	}
	result := value.(backupCreateResult)
	if filepath.Dir(result.Path) != custom {
		t.Fatalf("path = %q，期望在 %q 下", result.Path, custom)
	}
}

func TestBackupRestoreRefusesWAL(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	writeDatabase(t, dir, "current")
	if err := os.WriteFile(filepath.Join(dir, "chat.db-wal"), []byte("live"), 0o600); err != nil {
		t.Fatalf("写入 wal: %v", err)
	}
	backupDir := filepath.Join(dir, "backups")
	archive := filepath.Join(backupDir, "chat-deepseek-20261127-010101.zip")
	writeZipEntries(t, archive, map[string]string{"chat.db": "restored"})

	_, rpcErr := server.backupRestore(jsonParams(t, map[string]string{"file": filepath.Base(archive)}))
	if rpcErr == nil || rpcErr.Code != codeUnavailable {
		t.Fatalf("backup.restore error = %+v，期望 unavailable", rpcErr)
	}
	if rpcErr.Message != restoreRunningMessage {
		t.Fatalf("message = %q，期望 %q", rpcErr.Message, restoreRunningMessage)
	}
}

func TestBackupRestoreRefusesRunningService(t *testing.T) {
	listener := liveListener(t)
	server, dir := newTestServer(t, listener.Addr().String())
	writeDatabase(t, dir, "current")
	backupDir := filepath.Join(dir, "backups")
	if err := os.MkdirAll(backupDir, 0o700); err != nil {
		t.Fatalf("创建备份目录: %v", err)
	}
	archive := filepath.Join(backupDir, "chat-deepseek-20261127-010101.zip")
	writeZipEntries(t, archive, map[string]string{"chat.db": "restored"})

	_, rpcErr := server.backupRestore(jsonParams(t, map[string]string{"file": filepath.Base(archive)}))
	if rpcErr == nil || rpcErr.Code != codeUnavailable {
		t.Fatalf("backup.restore error = %+v，期望 unavailable", rpcErr)
	}
	if rpcErr.Message != restoreRunningMessage {
		t.Fatalf("message = %q，期望 %q", rpcErr.Message, restoreRunningMessage)
	}
	data, _ := os.ReadFile(filepath.Join(dir, "chat.db"))
	if string(data) != "current" {
		t.Fatalf("服务运行中不应恢复数据: %q", data)
	}
}

func TestBackupPathTraversalRejected(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	writeDatabase(t, dir, "database")
	outside := filepath.Join(filepath.Dir(dir), "outside.zip")
	writeZipEntries(t, outside, map[string]string{"chat.db": "outside"})
	t.Cleanup(func() { _ = os.Remove(outside) })

	names := []string{
		"../outside.zip",
		"..\\outside.zip",
		outside,
		"nested/outside.zip",
		"..",
		".",
		"chat.db",
		"no-such.zip",
	}
	for _, name := range names {
		params := jsonParams(t, map[string]string{"file": name})
		for method, call := range map[string]func(json.RawMessage) (any, *rpcError){
			"restore": server.backupRestore,
			"delete":  server.backupDelete,
		} {
			_, rpcErr := call(params)
			wantCode := codeBadRequest
			if name == "no-such.zip" {
				wantCode = codeNotFound
			}
			if rpcErr == nil || rpcErr.Code != wantCode {
				t.Fatalf("%s(%q) error = %+v，期望 %s", method, name, rpcErr, wantCode)
			}
		}
	}
	if _, err := os.Stat(outside); err != nil {
		t.Fatalf("目录穿越不应删除备份目录外的文件: %v", err)
	}
}

func TestBackupDeleteRejectsSymlink(t *testing.T) {
	server, dir := newTestServer(t, "127.0.0.1:1")
	backupDir := filepath.Join(dir, "backups")
	if err := os.MkdirAll(backupDir, 0o700); err != nil {
		t.Fatalf("创建备份目录: %v", err)
	}
	outside := filepath.Join(t.TempDir(), "outside.zip")
	writeZipEntries(t, outside, map[string]string{"chat.db": "outside"})
	link := filepath.Join(backupDir, "link.zip")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("当前环境不能创建符号链接: %v", err)
	}

	_, rpcErr := server.backupDelete(jsonParams(t, map[string]string{"file": "link.zip"}))
	if rpcErr == nil || rpcErr.Code != codeBadRequest {
		t.Fatalf("backup.delete 符号链接 error = %+v，期望 bad_request", rpcErr)
	}
	if _, err := os.Stat(outside); err != nil {
		t.Fatalf("符号链接目标不应被删除: %v", err)
	}
}

func TestBackupDeleteMissingFile(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")
	_, rpcErr := server.backupDelete(jsonParams(t, map[string]string{"file": "missing.zip"}))
	if rpcErr == nil || rpcErr.Code != codeNotFound {
		t.Fatalf("backup.delete error = %+v，期望 not_found", rpcErr)
	}
}

// fakeLogTailer 用内存数据替代 journalctl。
type fakeLogTailer struct {
	lines   []string
	lastN   int
	tailErr error
	follow  func(context.Context, func(string, string)) error
}

func (f *fakeLogTailer) Tail(n int) ([]string, error) {
	f.lastN = n
	if f.tailErr != nil {
		return nil, f.tailErr
	}
	if n > len(f.lines) {
		n = len(f.lines)
	}
	return append([]string(nil), f.lines[len(f.lines)-n:]...), nil
}

func (f *fakeLogTailer) Follow(ctx context.Context, emit func(string, string)) error {
	if f.follow != nil {
		return f.follow(ctx, emit)
	}
	<-ctx.Done()
	return nil
}

func TestServiceLogsReadsTail(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")
	useInstalledService(server)
	tailer := &fakeLogTailer{lines: []string{"first", "second", "third"}}
	server.newLogTailer = func() (logTailer, error) { return tailer, nil }

	value, rpcErr := server.serviceLogs(jsonParams(t, map[string]int{"tail": 2}))
	if rpcErr != nil {
		t.Fatalf("service.logs: %+v", rpcErr)
	}
	result := value.(serviceLogsResult)
	if len(result.Lines) != 2 || result.Lines[0] != "second" || result.Lines[1] != "third" {
		t.Fatalf("lines = %v", result.Lines)
	}
	if result.Truncated {
		t.Fatal("truncated 应为 false")
	}
}

func TestServiceLogsRejectsBadTail(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")
	server.newLogTailer = func() (logTailer, error) { return &fakeLogTailer{}, nil }

	for _, params := range []string{
		`{"tail":0}`,
		`{"tail":-1}`,
		`{"tail":"many"}`,
	} {
		_, rpcErr := server.serviceLogs(json.RawMessage(params))
		if rpcErr == nil || rpcErr.Code != codeBadRequest {
			t.Fatalf("params %s error = %+v，期望 bad_request", params, rpcErr)
		}
	}
}

func TestServiceLogsClampsHugeTail(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")
	useInstalledService(server)
	tailer := &fakeLogTailer{lines: []string{"only"}}
	server.newLogTailer = func() (logTailer, error) { return tailer, nil }

	value, rpcErr := server.serviceLogs(jsonParams(t, map[string]int{"tail": maxLogTail + 1}))
	if rpcErr != nil {
		t.Fatalf("service.logs: %+v", rpcErr)
	}
	if tailer.lastN != maxLogTail {
		t.Fatalf("Tail 收到 %d，期望截断到 %d", tailer.lastN, maxLogTail)
	}
	if !value.(serviceLogsResult).Truncated {
		t.Fatal("超过上限时应返回 truncated=true")
	}
}

func TestServiceLogsUnavailableWithoutSource(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")
	useInstalledService(server)
	server.newLogTailer = func() (logTailer, error) {
		return nil, errors.New("当前环境没有可用的服务日志：找不到 journalctl")
	}
	_, rpcErr := server.serviceLogs(nil)
	if rpcErr == nil || rpcErr.Code != codeUnavailable {
		t.Fatalf("service.logs error = %+v，期望 unavailable", rpcErr)
	}
}

func TestEventLineFormat(t *testing.T) {
	var buffer bytes.Buffer
	writer := &protocolWriter{out: bufio.NewWriter(&buffer)}
	writer.writeEvent("event.service.log", serviceLogEvent{Line: "hello", Stream: "stderr"})

	line := strings.TrimSuffix(buffer.String(), "\n")
	if strings.Contains(line, "\n") {
		t.Fatalf("事件必须一行: %q", line)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal([]byte(line), &raw); err != nil {
		t.Fatalf("事件不是 JSON: %v (%q)", err, line)
	}
	if _, ok := raw["id"]; ok {
		t.Fatalf("事件不能带 id: %s", line)
	}
	var method string
	if err := json.Unmarshal(raw["method"], &method); err != nil || method != "event.service.log" {
		t.Fatalf("method = %s, err = %v", raw["method"], err)
	}
	var params struct {
		Line   string `json:"line"`
		Stream string `json:"stream"`
	}
	if err := json.Unmarshal(raw["params"], &params); err != nil {
		t.Fatalf("解析 params: %v", err)
	}
	if params.Line != "hello" || params.Stream != "stderr" {
		t.Fatalf("params = %+v", params)
	}
	t.Logf("事件行：%s", line)
}

func TestStartLogTailEmitsEvent(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")
	emitted := make(chan struct{})
	tailer := &fakeLogTailer{follow: func(ctx context.Context, emit func(string, string)) error {
		emit("log line", "stdout")
		close(emitted)
		<-ctx.Done()
		return nil
	}}
	server.newLogTailer = func() (logTailer, error) { return tailer, nil }

	var buffer bytes.Buffer
	server.setWriter(&protocolWriter{out: bufio.NewWriter(&buffer)})
	server.startLogTail()
	select {
	case <-emitted:
	case <-time.After(2 * time.Second):
		t.Fatal("没有收到跟随事件")
	}
	server.stopLogTail()
	server.setWriter(nil)

	lines := strings.Split(strings.TrimSuffix(buffer.String(), "\n"), "\n")
	if len(lines) != 1 {
		t.Fatalf("期望 1 行事件，得到 %d: %q", len(lines), buffer.String())
	}
	var notification eventNotification
	if err := json.Unmarshal([]byte(lines[0]), &notification); err != nil {
		t.Fatalf("解析事件: %v", err)
	}
	if notification.Method != "event.service.log" {
		t.Fatalf("method = %q", notification.Method)
	}
}

func TestConcurrentEventAndResponseWritesStayLineDelimited(t *testing.T) {
	var buffer bytes.Buffer
	writer := &protocolWriter{out: bufio.NewWriter(&buffer)}
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(2)
		go func(i int) {
			defer wg.Done()
			writer.writeEvent("event.service.log", serviceLogEvent{Line: strings.Repeat("x", i), Stream: "stdout"})
		}(i)
		go func(i int) {
			defer wg.Done()
			writer.writeSuccess(json.RawMessage("1"), map[string]int{"i": i})
		}(i)
	}
	wg.Wait()

	for index, line := range strings.Split(strings.TrimSuffix(buffer.String(), "\n"), "\n") {
		if !json.Valid([]byte(line)) {
			t.Fatalf("第 %d 行不是完整 JSON: %q", index+1, line)
		}
	}
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func writeZipEntries(t *testing.T, path string, entries map[string]string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatalf("创建 zip 目录: %v", err)
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("创建 zip: %v", err)
	}
	zipWriter := zip.NewWriter(file)
	for name, content := range entries {
		entry, err := zipWriter.Create(name)
		if err != nil {
			t.Fatalf("创建 zip 条目 %s: %v", name, err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatalf("写入 zip 条目 %s: %v", name, err)
		}
	}
	if err := zipWriter.Close(); err != nil {
		t.Fatalf("关闭 zip: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("关闭文件: %v", err)
	}
}

// channelWriter 把 Serve 的 stdout 逐行送到 channel，便于在测试里等待事件。
type channelWriter struct {
	lines chan []byte
}

func (w *channelWriter) Write(data []byte) (int, error) {
	w.lines <- append([]byte(nil), data...)
	return len(data), nil
}

func TestServeEmitsServiceLogEventWithoutInterleaving(t *testing.T) {
	listener := liveListener(t)
	server, _ := newTestServer(t, listener.Addr().String())
	useInstalledService(server)
	tailer := &fakeLogTailer{follow: func(ctx context.Context, emit func(string, string)) error {
		emit("live line", "stdout")
		<-ctx.Done()
		return nil
	}}
	server.newLogTailer = func() (logTailer, error) { return tailer, nil }

	inputReader, inputWriter := io.Pipe()
	output := &channelWriter{lines: make(chan []byte, 4)}
	done := make(chan error, 1)
	go func() { done <- server.Serve(inputReader, output) }()

	if _, err := io.WriteString(inputWriter, requestLine(1, "service.logs")+"\n"); err != nil {
		t.Fatalf("写入请求: %v", err)
	}

	var responseSeen, eventSeen bool
	for deadline := time.After(2 * time.Second); !responseSeen || !eventSeen; {
		select {
		case raw := <-output.lines:
			line := strings.TrimSuffix(string(raw), "\n")
			var envelope struct {
				ID     json.RawMessage `json:"id"`
				Method string          `json:"method"`
			}
			if err := json.Unmarshal([]byte(line), &envelope); err != nil {
				t.Fatalf("stdout 不是 JSON: %q (%v)", line, err)
			}
			if envelope.Method == "event.service.log" {
				eventSeen = true
			} else if string(envelope.ID) == "1" {
				responseSeen = true
			}
		case <-deadline:
			t.Fatalf("超时：response=%v event=%v", responseSeen, eventSeen)
		}
	}
	if err := inputWriter.Close(); err != nil {
		t.Fatalf("关闭 stdin: %v", err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Serve: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Serve 未在 EOF 后退出")
	}
}
