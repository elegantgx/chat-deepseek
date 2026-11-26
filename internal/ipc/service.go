package ipc

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/elegantgx/chat-deepseek/internal/config"
	"github.com/elegantgx/chat-deepseek/internal/database"
	"github.com/elegantgx/chat-deepseek/internal/service"
)

const (
	// serviceOperationTimeout 防止 systemctl 卡住时 GUI 永久 pending。
	// 与 CLI 一样直接同步等待，不另起进程管理。
	serviceOperationTimeout = 30 * time.Second
	// logsReadTimeout 只用于一次性的“读最近 N 行”，不用于跟随。
	logsReadTimeout = 5 * time.Second
	// serviceStatusTimeout 限制一次安装状态读取。Status 只做 os.Stat 加少量 systemctl
	// 查询，但它出现在 GUI 启动路径（system.status）上，不能因为 systemd 卡住就拖慢探测。
	serviceStatusTimeout = 2 * time.Second

	defaultLogTail = 200
	maxLogTail     = 5000

	// 与 CLI/备份包保持同一句中文；GUI 只看 code，不解析这句话。
	backupRunningMessage  = "服务运行中，备份已暂停"
	restoreRunningMessage = "服务运行中，恢复已暂停"
)

// serviceController 是 internal/service 的最小投影。生产实现固定使用用户级 scope，
// 与 GUI 安装的服务保持一致；测试可以替换它，避免真的调用 systemctl。
type serviceController interface {
	Start(ctx context.Context) error
	Stop(ctx context.Context) error
	Restart(ctx context.Context) error
	MainPID(ctx context.Context) (int, error)
	Status(ctx context.Context) (service.Status, error)
	SupportError() error
	Install(ctx context.Context, opts service.InstallOptions) (service.InstallResult, error)
	Uninstall(ctx context.Context) (bool, error)
}

type systemdController struct {
	manager *service.Manager
}

func newSystemdController() serviceController {
	return &systemdController{manager: service.New()}
}

func (c *systemdController) Start(ctx context.Context) error {
	return c.manager.Start(ctx, service.ScopeUser)
}

func (c *systemdController) Stop(ctx context.Context) error {
	return c.manager.Stop(ctx, service.ScopeUser)
}

func (c *systemdController) Restart(ctx context.Context) error {
	return c.manager.Restart(ctx, service.ScopeUser)
}

// MainPID 查询 systemd 记录的 MainPID。拿不到时返回 0，让 result 里的 pid 保持数字类型。
func (c *systemdController) MainPID(ctx context.Context) (int, error) {
	if c.manager == nil || !c.manager.Supported || c.manager.Run == nil {
		return 0, nil
	}
	out, err := c.manager.Run(
		ctx,
		"systemctl",
		"--user",
		"show",
		service.UnitName,
		"--property=MainPID",
		"--value",
	)
	if err != nil {
		return 0, err
	}
	value := strings.TrimSpace(string(out))
	if value == "" {
		return 0, nil
	}
	pid, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("解析 MainPID: %w", err)
	}
	return pid, nil
}

// Status 只投影「平台支持 / 单元是否安装」；systemd 不可用时返回 Supported:false，不报错。
func (c *systemdController) Status(ctx context.Context) (service.Status, error) {
	if c.manager == nil {
		return service.Status{Supported: false}, nil
	}
	return c.manager.Status(ctx, service.ScopeUser)
}

func (c *systemdController) SupportError() error {
	if c.manager == nil {
		return service.ErrUnsupported
	}
	return c.manager.SupportError()
}

func (c *systemdController) Install(
	ctx context.Context,
	opts service.InstallOptions,
) (service.InstallResult, error) {
	if c.manager == nil {
		return service.InstallResult{}, service.ErrUnsupported
	}
	return c.manager.Install(ctx, opts)
}

func (c *systemdController) Uninstall(ctx context.Context) (bool, error) {
	if c.manager == nil {
		return false, service.ErrUnsupported
	}
	return c.manager.Uninstall(ctx, service.ScopeUser)
}

type serviceStateResult struct {
	State  string `json:"state"`
	PID    int    `json:"pid"`
	Listen string `json:"listen"`
}

type serviceStopResult struct {
	State string `json:"state"`
}

type serviceInstallResult struct {
	OK       bool   `json:"ok"`
	UnitPath string `json:"unitPath"`
}

type serviceLogsResult struct {
	Lines     []string `json:"lines"`
	Truncated bool     `json:"truncated"`
}

type serviceLogEvent struct {
	Line   string `json:"line"`
	Stream string `json:"stream"`
}

func (s *Server) serviceStart(_ json.RawMessage) (any, *rpcError) {
	if !s.beginServiceOp() {
		return nil, unavailableError("服务操作正在进行，请稍候")
	}
	defer s.endServiceOp()

	cfg, err := config.Load(s.dataDir)
	if err != nil {
		return nil, internalError("读取配置失败", err)
	}
	controller := s.newService()
	ctx, cancel := context.WithTimeout(context.Background(), serviceOperationTimeout)
	defer cancel()
	if err := controller.Start(ctx); err != nil {
		return nil, serviceOperationError(err)
	}
	s.restartLogTail()
	return s.runningState(controller, cfg, ctx), nil
}

func (s *Server) serviceStop(_ json.RawMessage) (any, *rpcError) {
	if !s.beginServiceOp() {
		return nil, unavailableError("服务操作正在进行，请稍候")
	}
	defer s.endServiceOp()

	controller := s.newService()
	ctx, cancel := context.WithTimeout(context.Background(), serviceOperationTimeout)
	defer cancel()
	if err := controller.Stop(ctx); err != nil {
		return nil, serviceOperationError(err)
	}
	s.stopLogTail()
	return serviceStopResult{State: stateStopped}, nil
}

func (s *Server) serviceRestart(_ json.RawMessage) (any, *rpcError) {
	if !s.beginServiceOp() {
		return nil, unavailableError("服务操作正在进行，请稍候")
	}
	defer s.endServiceOp()

	cfg, err := config.Load(s.dataDir)
	if err != nil {
		return nil, internalError("读取配置失败", err)
	}
	controller := s.newService()
	ctx, cancel := context.WithTimeout(context.Background(), serviceOperationTimeout)
	defer cancel()
	if err := controller.Restart(ctx); err != nil {
		return nil, serviceOperationError(err)
	}
	s.restartLogTail()
	return s.runningState(controller, cfg, ctx), nil
}

// runningState 在启动/重启成功后做一次 TCP 探测：还没监听时返回 starting，
// 不凭 PID 或 systemctl 的退出码猜测“已经可用”。
func (s *Server) runningState(
	controller serviceController,
	cfg config.Config,
	ctx context.Context,
) serviceStateResult {
	state := "starting"
	if probeServiceState(cfg.Listen, s.probeTimeout) == stateRunning {
		state = stateRunning
	}
	pid, err := controller.MainPID(ctx)
	if err != nil {
		// pid 只用于展示；查询失败不影响启动结果，日志留在 stderr。
		s.logf("查询服务 PID 失败: %v", err)
		pid = 0
	}
	return serviceStateResult{State: state, PID: pid, Listen: cfg.Listen}
}

// serviceOperationError 保持与 CLI 相同的中文错误，同时把超时翻译成可读提示。
func serviceOperationError(err error) *rpcError {
	if errors.Is(err, context.DeadlineExceeded) {
		return unavailableError("服务操作超时，请稍后重试")
	}
	return unavailableError(err.Error())
}

func (s *Server) beginServiceOp() bool {
	select {
	case s.serviceOp <- struct{}{}:
		return true
	default:
		return false
	}
}

func (s *Server) endServiceOp() {
	<-s.serviceOp
}

// serviceLogs 读取最近 tail 行；服务正在运行时顺带开启事件跟随（若尚未开启）。
func (s *Server) serviceLogs(params json.RawMessage) (any, *rpcError) {
	tail, truncated, rpcErr := parseLogTail(params)
	if rpcErr != nil {
		return nil, rpcErr
	}
	// unit 没安装时 journal 里仍可能留着上次安装的旧记录，读出来会被当成「最近日志」；
	// 而且未安装的 unit 没有跟随的意义，所以直接给空数组，不读 journal、也不开事件流。
	// Status 失败（权限、systemctl 异常）时按「无法确认」继续走原读取路径：
	// 一次状态查询失败不应该把还能读到的日志整个吞掉，错误只写 stderr。
	controller := s.newService()
	statusCtx, statusCancel := context.WithTimeout(context.Background(), serviceStatusTimeout)
	defer statusCancel()
	status, statusErr := controller.Status(statusCtx)
	if statusErr != nil {
		s.logf("读取服务安装状态失败: %v", statusErr)
	}
	if statusErr == nil && !status.Installed {
		return serviceLogsResult{Lines: []string{}, Truncated: truncated}, nil
	}
	tailer, err := s.newLogTailer()
	if err != nil {
		return nil, unavailableError(err.Error())
	}
	lines, err := tailer.Tail(tail)
	if err != nil {
		if errors.Is(err, errLogsUnavailable) {
			return nil, unavailableError(err.Error())
		}
		return nil, internalError("读取服务日志失败", err)
	}
	if lines == nil {
		lines = []string{}
	}
	// 服务已经在运行但 IPC 是后启动的：logs 调用本身也把跟随补上。
	cfg, err := config.Load(s.dataDir)
	if err == nil && probeServiceState(cfg.Listen, s.probeTimeout) == stateRunning {
		s.startLogTail()
	}
	return serviceLogsResult{Lines: lines, Truncated: truncated}, nil
}

// serviceInstall 复用 internal/service 的用户级 unit 安装逻辑；IPC 不提供
// --system/--enable 参数。force=true 对应 CLI 的 --force，用于桌面端「重新安装」。
func (s *Server) serviceInstall(params json.RawMessage) (any, *rpcError) {
	payload := struct {
		Force *bool `json:"force"`
	}{}
	trimmed := strings.TrimSpace(string(params))
	if trimmed != "" && trimmed != "null" {
		if err := json.Unmarshal(params, &payload); err != nil {
			return nil, badRequestError("参数必须是 JSON 对象且 force 为布尔值")
		}
	}
	force := payload.Force != nil && *payload.Force

	if !s.beginServiceOp() {
		return nil, unavailableError("服务操作正在进行，请稍候")
	}
	defer s.endServiceOp()

	controller := s.newService()
	// 先判断平台能力，避免 Windows/macOS 上先报「数据目录未初始化」。
	if err := controller.SupportError(); err != nil {
		return nil, unavailableError(err.Error())
	}
	initialized, err := database.Initialized(s.dataDir)
	if err != nil {
		return nil, internalError("检查数据目录失败", err)
	}
	if !initialized {
		return nil, unavailableError(fmt.Sprintf(
			"数据目录尚未初始化：%s；先运行 chat-deepseek setup",
			s.dataDir,
		))
	}
	binary, err := currentBinaryPath()
	if err != nil {
		return nil, unavailableError(err.Error())
	}
	ctx, cancel := context.WithTimeout(context.Background(), serviceOperationTimeout)
	defer cancel()
	result, err := controller.Install(ctx, service.InstallOptions{
		Scope:   service.ScopeUser,
		DataDir: s.dataDir,
		Binary:  binary,
		Force:   force,
	})
	if err != nil {
		return nil, serviceOperationError(err)
	}
	// warnings 只写 stderr，不塞进契约字段；GUI 需要诊断时看日志。
	for _, warning := range result.Warnings {
		s.logf("%s", warning)
	}
	return serviceInstallResult{OK: true, UnitPath: result.UnitPath}, nil
}

// serviceUninstall 停止并删除用户级 unit；unit 本来就不存在时仍返回 ok，
// 保持和 CLI「服务未安装」+ 退出码 0 的幂等行为一致。
func (s *Server) serviceUninstall(_ json.RawMessage) (any, *rpcError) {
	if !s.beginServiceOp() {
		return nil, unavailableError("服务操作正在进行，请稍候")
	}
	defer s.endServiceOp()

	controller := s.newService()
	if err := controller.SupportError(); err != nil {
		return nil, unavailableError(err.Error())
	}
	ctx, cancel := context.WithTimeout(context.Background(), serviceOperationTimeout)
	defer cancel()
	removed, err := controller.Uninstall(ctx)
	if err != nil {
		return nil, serviceOperationError(err)
	}
	if removed {
		// unit 已删除，跟随事件流没有意义，及时停掉。
		s.stopLogTail()
	}
	return okResult{OK: true}, nil
}

// currentBinaryPath 与 CLI 的 executablePath 保持一致：解析符号链接并转成绝对路径，
// 否则写进 unit 的 ExecStart 可能指向临时包装脚本。
func currentBinaryPath() (string, error) {
	path, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("定位当前二进制失败: %w", err)
	}
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		path = resolved
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("解析二进制路径失败: %w", err)
	}
	return abs, nil
}

func parseLogTail(params json.RawMessage) (int, bool, *rpcError) {
	payload := struct {
		Tail *int `json:"tail"`
	}{}
	trimmed := bytes.TrimSpace(params)
	if len(trimmed) > 0 && !bytes.Equal(trimmed, []byte("null")) {
		if err := json.Unmarshal(trimmed, &payload); err != nil {
			return 0, false, badRequestError("tail 必须是整数")
		}
	}
	tail := defaultLogTail
	truncated := false
	if payload.Tail != nil {
		tail = *payload.Tail
		if tail <= 0 {
			return 0, false, badRequestError("tail 必须是正整数")
		}
		if tail > maxLogTail {
			// 不拒绝过大的 tail，避免 GUI 传历史配置值时整个方法失败；
			// 上限内截断并用 truncated 告知调用方。
			tail = maxLogTail
			truncated = true
		}
	}
	return tail, truncated, nil
}

// logTailer 抽象日志源：生产是 journalctl，测试可以替换成内存实现。
type logTailer interface {
	Tail(n int) ([]string, error)
	Follow(ctx context.Context, emit func(line, stream string)) error
}

var errLogsUnavailable = errors.New("当前环境没有可用的服务日志")

// journalTailer 读取 systemd 用户单元的 journal。unit 的 stdout/stderr 都由 systemd
// 收进 journal，CLI 的 serve 本身不写日志文件。
type journalTailer struct {
	// run 执行 journalctl 并返回 stdout。默认走 exec，测试可替换成固定输出，
	// 这样格式化逻辑不需要真的依赖本机 journal。
	run func(ctx context.Context, args ...string) ([]byte, error)
}

func newJournalTailer() (logTailer, error) {
	if runtime.GOOS != "linux" {
		return nil, fmt.Errorf("%w：当前平台不支持 systemd", errLogsUnavailable)
	}
	if _, err := exec.LookPath("journalctl"); err != nil {
		return nil, fmt.Errorf("%w：找不到 journalctl", errLogsUnavailable)
	}
	return journalTailer{run: runJournalctl}, nil
}

func runJournalctl(ctx context.Context, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, "journalctl", args...).Output()
}

// Tail 读取最近 n 条 journal 记录，压成渲染层能直接吃的 `HH:MM:SS LEVEL message`。
// 以前用 `-o cat` 会丢掉时间戳，渲染层只好把每条历史日志都标成“现在”；
// 这里改读 json，用 __REALTIME_TIMESTAMP 和 PRIORITY 还原真实时间与级别。
func (t journalTailer) Tail(n int) ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), logsReadTimeout)
	defer cancel()
	run := t.run
	if run == nil {
		run = runJournalctl
	}
	out, err := run(
		ctx,
		"--user",
		"-u", service.UnitName,
		"-n", strconv.Itoa(n),
		"--no-pager",
		"-o", "json",
	)
	if err != nil {
		return nil, fmt.Errorf("%w：%v", errLogsUnavailable, err)
	}
	return formatJournalEntries(out), nil
}

// journalEntry 只取格式化需要的字段。PRIORITY 与时间戳在 journal 的 json 输出里
// 可能是字符串也可能是数字（不同 systemd 版本/字段类型），所以保留 RawMessage 再解析。
type journalEntry struct {
	Message           json.RawMessage `json:"MESSAGE"`
	Priority          json.RawMessage `json:"PRIORITY"`
	RealtimeTimestamp json.RawMessage `json:"__REALTIME_TIMESTAMP"`
}

// formatJournalEntries 逐行解析 journalctl -o json 的输出；坏行（非 JSON 的提示、
// 空行）跳过，不让一条异常记录毁掉整份快照。
func formatJournalEntries(out []byte) []string {
	lines := make([]string, 0, 16)
	for _, raw := range bytes.Split(out, []byte{'\n'}) {
		line := bytes.TrimSpace(raw)
		if len(line) == 0 || bytes.Equal(line, []byte("-- No entries --")) {
			continue
		}
		var entry journalEntry
		if err := json.Unmarshal(line, &entry); err != nil {
			continue
		}
		message := foldJournalMessage(decodeJournalMessage(entry.Message))
		if message == "" {
			continue
		}
		lines = append(lines, fmt.Sprintf(
			"%s %s %s",
			journalClock(entry.RealtimeTimestamp),
			journalLevel(entry.Priority),
			message,
		))
	}
	return lines
}

// decodeJournalMessage 还原 MESSAGE。正常是字符串；非 UTF-8 消息会被 journald
// 编码成字节数组，这里一并按字节还原，避免把这类日志整条丢掉。
func decodeJournalMessage(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		return text
	}
	var data []byte
	if err := json.Unmarshal(raw, &data); err == nil {
		return string(data)
	}
	return ""
}

// journalScalar 把 json 里的字符串或数字统一成文本；解析失败返回空串。
func journalScalar(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		return text
	}
	return strings.TrimSpace(string(raw))
}

// journalClock 把微秒时间戳转成本地时区的 HH:MM:SS。时间戳缺失时退回读取时刻：
// 宁可把这一行标成现在，也不要显示成 1970 年。
func journalClock(raw json.RawMessage) string {
	micros, err := strconv.ParseInt(journalScalar(raw), 10, 64)
	if err != nil || micros <= 0 {
		return time.Now().Format("15:04:05")
	}
	return time.UnixMicro(micros).Format("15:04:05")
}

// journalLevel 映射 syslog priority：<=3 错误、4 警告、其余信息。缺失或非法时按
// INFO 处理，未知级别不该被涂成错误色。
func journalLevel(raw json.RawMessage) string {
	priority, err := strconv.Atoi(journalScalar(raw))
	if err != nil {
		return "INFO"
	}
	switch {
	case priority <= 3:
		return "ERROR"
	case priority == 4:
		return "WARN"
	default:
		return "INFO"
	}
}

// foldJournalMessage 把多行/空行 message 压成一行：日志区一行一条，
// 空行会破坏行高和「共 N 行」计数，所以空段直接丢掉。
func foldJournalMessage(message string) string {
	parts := strings.FieldsFunc(message, func(r rune) bool {
		return r == '\n' || r == '\r'
	})
	folded := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			folded = append(folded, trimmed)
		}
	}
	return strings.Join(folded, " / ")
}

func (journalTailer) Follow(ctx context.Context, emit func(line, stream string)) error {
	command := exec.CommandContext(
		ctx,
		"journalctl",
		"--user",
		"-u", service.UnitName,
		"-f",
		"-n", "0",
		"-o", "json",
	)
	stdout, err := command.StdoutPipe()
	if err != nil {
		return fmt.Errorf("打开日志管道: %w", err)
	}
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Start(); err != nil {
		return fmt.Errorf("启动 journalctl: %w", err)
	}

	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), MaxLineBytes)
	for scanner.Scan() {
		var entry struct {
			Message  string `json:"MESSAGE"`
			StreamID string `json:"_STREAM_ID"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &entry); err != nil {
			// 单条坏记录不应该中断整个事件流。
			continue
		}
		stream := "stdout"
		if strings.EqualFold(strings.TrimSpace(entry.StreamID), "stderr") {
			stream = "stderr"
		}
		emit(entry.Message, stream)
	}
	scanErr := scanner.Err()
	waitErr := command.Wait()
	if ctx.Err() != nil {
		// stop/退出时被杀掉是正常收尾。
		return nil
	}
	if scanErr != nil {
		return fmt.Errorf("读取日志流: %w", scanErr)
	}
	if waitErr != nil {
		detail := strings.TrimSpace(stderr.String())
		if detail != "" {
			return fmt.Errorf("journalctl 退出: %s", detail)
		}
		return fmt.Errorf("journalctl 退出: %w", waitErr)
	}
	return nil
}

// startLogTail 启动后台跟随；已经在跟随时不重复启动。
func (s *Server) startLogTail() {
	s.tailMu.Lock()
	if s.tailCancel != nil {
		s.tailMu.Unlock()
		return
	}
	tailer, err := s.newLogTailer()
	if err != nil {
		s.tailMu.Unlock()
		s.logf("事件流不可用: %v", err)
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	s.tailID++
	id := s.tailID
	s.tailCancel = cancel
	s.tailDone = done
	s.tailMu.Unlock()

	go func() {
		defer close(done)
		err := tailer.Follow(ctx, func(line, stream string) {
			s.emitEvent("event.service.log", serviceLogEvent{Line: line, Stream: stream})
		})
		if err != nil && ctx.Err() == nil {
			s.logf("事件流中断: %v", err)
		}
		s.tailMu.Lock()
		// 只有仍是自己那一代时才清空，避免清掉后来重启的 tail。
		if s.tailID == id {
			s.tailCancel = nil
			s.tailDone = nil
		}
		s.tailMu.Unlock()
	}()
}

// stopLogTail 取消并等待当前跟随退出；Serve 返回前必须调用，避免事件写进已结束的流。
func (s *Server) stopLogTail() {
	s.tailMu.Lock()
	cancel := s.tailCancel
	done := s.tailDone
	s.tailCancel = nil
	s.tailDone = nil
	s.tailID++
	s.tailMu.Unlock()
	if cancel != nil {
		cancel()
	}
	if done != nil {
		<-done
	}
}

func (s *Server) restartLogTail() {
	s.stopLogTail()
	s.startLogTail()
}
