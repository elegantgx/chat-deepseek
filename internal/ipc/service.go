package ipc

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
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

	// 本地进程模式：unit 未安装时由 ipc 自己拉起 `serve`，systemd 只作为可选的
	// 开机自启增强。启动等待端口探测通过的上限是 8s，避免 serve 卡住时桌面端一直转圈。
	defaultLocalStartTimeout = 8 * time.Second
	// 停止时先 SIGTERM，最多等 5s 让它优雅关闭，再 SIGKILL。
	defaultLocalStopTimeout = 5 * time.Second
	// SIGKILL 之后确认 Wait 返回的时间；正常内核会立刻回收，这里只是兜底。
	localKillTimeout = 2 * time.Second
	// 启动等待的轮询间隔；比 TCP 探测超时略小，避免每次都等满探测窗口。
	localStartPollInterval = 100 * time.Millisecond
	// 进程输出缓冲上限：约 2000 行，停止后仍可读，但不会无限增长。
	localLogCapacity = 2000
	// 失败信息只带最后几行输出，避免把整个缓冲塞进错误 message。
	localFailureTailLines = 5

	// mode 回答「谁在管」，与 state（端口通不通）正交。
	serviceModeProcess = "process"
	serviceModeSystemd = "systemd"
	serviceModeNone    = "none"

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
	// Enabled 表示安装时是否执行了 enable（开机自启）；输入与结果分开投影，
	// 界面不用自己猜 enable 是否真的成功。
	Enabled bool `json:"enabled"`
	// Warnings 是给用户看的提示（例如 linger 未开启），必须随结果返回，
	// 不能只写 stderr——桌面端看不到 ipc 的 stderr。
	Warnings []string `json:"warnings"`
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
	// 已经有 ipc 托管的进程时直接投影它：重复点「启动」不应该再 spawn 一个。
	if process := s.localProcess(); process != nil && !process.exited() {
		return s.localProcessState(process, cfg), nil
	}

	controller := s.newService()
	statusCtx, statusCancel := context.WithTimeout(context.Background(), serviceStatusTimeout)
	status, statusErr := controller.Status(statusCtx)
	statusCancel()
	if statusErr != nil {
		// 读不到安装状态时退回本地进程模式：它不依赖 systemd，比直接报错更可用。
		// 如果其实有别的进程在监听，startLocalService 会在 spawn 之前返回「已被占用」。
		s.logf("读取服务安装状态失败，改用本地进程模式: %v", statusErr)
	}
	if statusErr == nil && status.Installed {
		ctx, cancel := context.WithTimeout(context.Background(), serviceOperationTimeout)
		defer cancel()
		if err := controller.Start(ctx); err != nil {
			return nil, serviceOperationError(err)
		}
		s.restartLogTail()
		return s.runningState(controller, cfg, ctx), nil
	}
	result, rpcErr := s.startLocalService(cfg)
	if rpcErr != nil {
		return nil, rpcErr
	}
	return result, nil
}

func (s *Server) serviceStop(_ json.RawMessage) (any, *rpcError) {
	if !s.beginServiceOp() {
		return nil, unavailableError("服务操作正在进行，请稍候")
	}
	defer s.endServiceOp()

	// 只要登记过本地子进程就算本地模式：即使它已经退出，用户点「停止」的预期也是
	// stopped，而不是落到 systemd 分支报「服务未安装」。注意判断依据是 ipc 自己的
	// 登记，不是端口探测——别的进程占着端口不应被当成「我们的进程已停」。
	if process := s.localProcess(); process != nil {
		if err := s.stopLocalProcess(); err != nil {
			return nil, unavailableError(err.Error())
		}
		// 本地进程的增量日志直接来自子进程输出，不依赖 journal，跟随在这里没有意义。
		s.stopLogTail()
		return serviceStopResult{State: stateStopped}, nil
	}

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
	if s.localProcessRunning() {
		if err := s.stopLocalProcess(); err != nil {
			return nil, unavailableError(err.Error())
		}
		s.stopLogTail()
		result, rpcErr := s.startLocalService(cfg)
		if rpcErr != nil {
			return nil, rpcErr
		}
		return result, nil
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

// startLocalService 在 unit 未安装（或 systemd 不可用）的机器上启动 ipc 托管的 serve：
// 先确认端口没有被别的进程占用，再 spawn，最后等 TCP 探测通过。
func (s *Server) startLocalService(cfg config.Config) (serviceStateResult, *rpcError) {
	if process := s.localProcess(); process != nil && !process.exited() {
		return s.localProcessState(process, cfg), nil
	}
	// 端口已经通了但不是我们的子进程：可能是用户自己跑的 serve、另一个 ipc，或别的程序。
	// 这时盲目 spawn 只会得到「listen 失败」，直接给出可操作的错误。
	if probeServiceState(cfg.Listen, s.probeTimeout) == stateRunning {
		return serviceStateResult{}, unavailableError(fmt.Sprintf(
			"监听地址 %s 已被占用，无法启动本地进程；请先停止占用该端口的程序",
			cfg.Listen,
		))
	}
	process, err := s.startLocalProcess(cfg)
	if err != nil {
		return serviceStateResult{}, unavailableError(err.Error())
	}

	deadline := time.Now().Add(s.localStartWait())
	for {
		if probeServiceState(cfg.Listen, s.probeTimeout) == stateRunning {
			s.stopLogTail()
			return serviceStateResult{State: stateRunning, PID: process.pid, Listen: cfg.Listen}, nil
		}
		select {
		case <-process.done:
			return serviceStateResult{}, s.localProcessFailure(process)
		default:
		}
		if !time.Now().Before(deadline) {
			// 进程还活着但 8s 内没监听：和 systemd 分支一样返回 starting，
			// 让 UI 显示「启动中」，而不是把还在跑的进程判死。
			s.stopLogTail()
			return serviceStateResult{State: "starting", PID: process.pid, Listen: cfg.Listen}, nil
		}
		select {
		case <-process.done:
			return serviceStateResult{}, s.localProcessFailure(process)
		case <-time.After(localStartPollInterval):
		}
	}
}

// localProcessState 用现有子进程投影状态：端口通了是 running，否则仍是 starting。
func (s *Server) localProcessState(process *localServiceProcess, cfg config.Config) serviceStateResult {
	state := "starting"
	if probeServiceState(cfg.Listen, s.probeTimeout) == stateRunning {
		state = stateRunning
	}
	return serviceStateResult{State: state, PID: process.pid, Listen: cfg.Listen}
}

// localProcessFailure 把提前退出的子进程翻译成 unavailable，并带上最后几行输出，
// 便于定位端口冲突、数据目录不可写这类真实原因。
func (s *Server) localProcessFailure(process *localServiceProcess) *rpcError {
	message := "本地服务进程启动失败"
	if process.exitErr != nil {
		message += "：" + process.exitErr.Error()
	}
	if tail := s.procLog.tail(localFailureTailLines); len(tail) > 0 {
		message += "；输出：" + strings.Join(tail, " / ")
	}
	return unavailableError(message)
}

func (s *Server) localStartWait() time.Duration {
	if s.localStartTimeout > 0 {
		return s.localStartTimeout
	}
	return defaultLocalStartTimeout
}

func (s *Server) localStopWait() time.Duration {
	if s.localStopTimeout > 0 {
		return s.localStopTimeout
	}
	return defaultLocalStopTimeout
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
	// 有活着的本地子进程时来源是确定的：日志只可能在 ipc 的内存缓冲里，不能去读
	// journal（unit 未安装时那里只有旧残留）。进程刚启动还没输出时返回 []。
	if s.localProcessRunning() {
		return serviceLogsResult{Lines: s.procLog.tail(tail), Truncated: truncated}, nil
	}
	// 没有活进程时看 unit 是否接管：装了 unit 就走 journal，不能被以前的本地缓冲截胡，
	// 否则用户装好 systemd 后日志页会永远停在旧的本地产出上。
	// Status 失败（权限、systemctl 异常）时无法判断归属：保守地优先已有本地缓冲，
	// 缓冲为空再走 journal——一次状态查询失败不应该把还能读到的历史整个吞掉。
	controller := s.newService()
	statusCtx, statusCancel := context.WithTimeout(context.Background(), serviceStatusTimeout)
	defer statusCancel()
	status, statusErr := controller.Status(statusCtx)
	if statusErr != nil {
		s.logf("读取服务安装状态失败: %v", statusErr)
		if lines := s.procLog.tail(tail); len(lines) > 0 {
			return serviceLogsResult{Lines: lines, Truncated: truncated}, nil
		}
	} else if !status.Installed {
		// 没装 unit 也没有活进程：本地模式停止后仍能看历史；缓冲为空就是 []，
		// 不读 journal 残留（unit 没装时的 journal 旧记录不属于当前服务）。
		return serviceLogsResult{Lines: s.procLog.tail(tail), Truncated: truncated}, nil
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
	// 本地进程模式不跟 journal，上面已经提前返回。
	cfg, err := config.Load(s.dataDir)
	if err == nil && probeServiceState(cfg.Listen, s.probeTimeout) == stateRunning {
		s.startLogTail()
	}
	return serviceLogsResult{Lines: lines, Truncated: truncated}, nil
}

// serviceInstall 复用 internal/service 的用户级 unit 安装逻辑；IPC 不提供
// --system 参数。force=true 对应 CLI 的 --force，用于桌面端「重新安装」；
// enable=true 对应 CLI 的 --enable，安装时顺手设置开机自启。
func (s *Server) serviceInstall(params json.RawMessage) (any, *rpcError) {
	fields := map[string]json.RawMessage{}
	trimmed := strings.TrimSpace(string(params))
	if trimmed != "" && trimmed != "null" {
		if err := json.Unmarshal(params, &fields); err != nil {
			return nil, badRequestError("参数必须是 JSON 对象")
		}
	}
	force, rpcErr := optionalBoolParam(fields, "force")
	if rpcErr != nil {
		return nil, rpcErr
	}
	enable, rpcErr := optionalBoolParam(fields, "enable")
	if rpcErr != nil {
		return nil, rpcErr
	}

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
			"数据目录尚未初始化：%s；请先在桌面端「账户」页创建第一个用户，或运行 chat-deepseek setup",
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
		Enable:  enable,
		Force:   force,
	})
	if err != nil {
		return nil, serviceOperationError(err)
	}
	warnings := result.Warnings
	if warnings == nil {
		warnings = []string{}
	}
	// warnings 是用户可见信息（例如 linger 提示），随结果返回给界面；
	// 不再写 stderr，否则桌面端只会把它当成前缀日志。
	return serviceInstallResult{
		OK:       true,
		UnitPath: result.UnitPath,
		Enabled:  result.Enabled,
		Warnings: warnings,
	}, nil
}

// optionalBoolParam 解析可选布尔参数：缺省、null 都按 false；类型不合法时
// message 以字段名开头，桌面端可以直接对应到表单字段。
func optionalBoolParam(fields map[string]json.RawMessage, name string) (bool, *rpcError) {
	raw, ok := fields[name]
	if !ok || strings.TrimSpace(string(raw)) == "null" {
		return false, nil
	}
	var value bool
	if err := json.Unmarshal(raw, &value); err != nil {
		return false, badRequestError(name + " 必须是布尔值")
	}
	return value, nil
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

// localServiceProcess 是 ipc 托管的 serve 子进程。
type localServiceProcess struct {
	cmd  *exec.Cmd
	pid  int
	done chan struct{}
	// exitErr 在 close(done) 之前写入；读取方必须先确认 done 已关闭（<-done 建立 happens-before）。
	exitErr error
}

// exited 只反映「Wait 已经返回」；进程刚退出但回收 goroutine 还没跑完时仍算活着，
// 这样 mode 不会在启动/停止过程中来回跳。
func (p *localServiceProcess) exited() bool {
	select {
	case <-p.done:
		return true
	default:
		return false
	}
}

// processLogBuffer 是固定容量的行环形缓冲：内存里只留最近约 2000 行，
// 进程停止后仍能通过 service.logs 看到历史，但不会无限增长。
type processLogBuffer struct {
	mu    sync.Mutex
	lines [localLogCapacity]string
	start int
	count int
}

func (b *processLogBuffer) add(line string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.count < localLogCapacity {
		b.lines[(b.start+b.count)%localLogCapacity] = line
		b.count++
		return
	}
	b.lines[b.start] = line
	b.start = (b.start + 1) % localLogCapacity
}

// tail 返回最近 n 行，从旧到新；没有日志时返回空切片而不是 nil。
func (b *processLogBuffer) tail(n int) []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	if n <= 0 || b.count == 0 {
		return []string{}
	}
	if n > b.count {
		n = b.count
	}
	out := make([]string, 0, n)
	for index := b.count - n; index < b.count; index++ {
		out = append(out, b.lines[(b.start+index)%localLogCapacity])
	}
	return out
}

func (s *Server) localProcess() *localServiceProcess {
	s.procMu.Lock()
	defer s.procMu.Unlock()
	return s.proc
}

func (s *Server) localProcessRunning() bool {
	process := s.localProcess()
	return process != nil && !process.exited()
}

// serviceMode 只回答「谁在管」：ipc 托管的子进程优先，其次是已安装的 systemd 用户单元。
// 与 TCP 探测出的 state 正交，不根据端口通不通反推。
func (s *Server) serviceMode(installed bool) string {
	if s.localProcessRunning() {
		return serviceModeProcess
	}
	if installed {
		return serviceModeSystemd
	}
	return serviceModeNone
}

// startLocalProcess 用当前二进制拉起 `serve --data-dir ... --listen ... --no-browser`。
// 只负责启动和登记，不等待端口；等待逻辑在 startLocalService，便于 restart 复用。
func (s *Server) startLocalProcess(cfg config.Config) (*localServiceProcess, error) {
	binary, err := currentBinaryPath()
	if err != nil {
		return nil, err
	}
	// listen 必须取 config.Load 的值，不能依赖 serve 的默认参数，否则会和 system.status
	// 报告的地址不一致。
	args := []string{
		"serve",
		"--data-dir", s.dataDir,
		"--listen", cfg.Listen,
		"--no-browser",
	}

	s.procMu.Lock()
	defer s.procMu.Unlock()
	if s.proc != nil {
		if !s.proc.exited() {
			return nil, errors.New("本地服务进程已在运行")
		}
		// 已经退出的旧进程登记由 start/stop 清理；这里先让位给新进程。
		s.proc = nil
	}
	if s.newProcessCmd == nil {
		return nil, errors.New("未配置本地进程构造器")
	}
	cmd := s.newProcessCmd(binary, args)
	if cmd == nil {
		return nil, errors.New("无法创建本地服务进程")
	}
	configureLocalProcess(cmd)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("打开本地服务进程输出: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		_ = stdout.Close()
		return nil, fmt.Errorf("打开本地服务进程错误输出: %w", err)
	}
	if err := cmd.Start(); err != nil {
		_ = stdout.Close()
		_ = stderr.Close()
		return nil, fmt.Errorf("启动本地服务进程失败: %w", err)
	}
	process := &localServiceProcess{
		cmd:  cmd,
		pid:  cmd.Process.Pid,
		done: make(chan struct{}),
	}
	s.proc = process
	var readers sync.WaitGroup
	readers.Add(2)
	go s.consumeProcessOutput(stdout, "stdout", &readers)
	go s.consumeProcessOutput(stderr, "stderr", &readers)
	go s.reapLocalProcess(process, &readers)
	return process, nil
}

// reapLocalProcess 先等两条输出流读完再 Wait（否则可能丢掉尾部日志），
// 然后把进程从 Server 上摘掉并唤醒正在等待的 start/stop。
func (s *Server) reapLocalProcess(process *localServiceProcess, readers *sync.WaitGroup) {
	readers.Wait()
	err := process.cmd.Wait()
	process.exitErr = err
	// 这里故意不清 s.proc：保留一个「已退出的本地进程」登记，下一次 service.stop 才能
	// 认出「本地模式已经停了」并返回 stopped，而不是落到 systemd 分支报未安装。
	// 登记本身很小，startLocalProcess/stopLocalProcess 会负责清掉；mode 仍按活进程判断。
	close(process.done)
}

// consumeProcessOutput 逐行读取子进程输出：格式化后进缓冲并发事件，保证快照与增量一致。
func (s *Server) consumeProcessOutput(r io.Reader, stream string, readers *sync.WaitGroup) {
	defer readers.Done()
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), MaxLineBytes)
	for scanner.Scan() {
		line := formatLocalLogLine(stream, scanner.Text())
		if line == "" {
			continue
		}
		s.procLog.add(line)
		s.emitEvent("event.service.log", serviceLogEvent{Line: line, Stream: stream})
	}
	if err := scanner.Err(); err != nil {
		s.logf("读取本地服务输出失败: %v", err)
	}
}

// formatLocalLogLine 把子进程输出压成与 journal 快照一致的 `HH:MM:SS LEVEL message`。
// 多行/空行折叠成一行，空行直接丢弃（不出空日志）。
//
// serve 的全部日志都走 slog TextHandler 写 stderr，如果只按流映射，正常启动日志也会被
// 涂成红色 ERROR。因此先认 slog 的 `level=...` token，命中就按它分级并从消息里删掉该
// token；没有 token 时才回退到「stdout → INFO、stderr → ERROR」。`time=...` 保留在正文里，
// 因为它是 serve 自己带的可诊断信息，删掉反而丢上下文。
func formatLocalLogLine(stream, raw string) string {
	message := foldJournalMessage(raw)
	if message == "" {
		return ""
	}
	level, message, found := splitSlogLevel(message)
	if !found {
		level = "INFO"
		if stream == "stderr" {
			level = "ERROR"
		}
	}
	// 整行只有 level token 时删完就没有正文了；不产出 `HH:MM:SS LEVEL ` 这种空消息。
	if message == "" {
		return ""
	}
	return fmt.Sprintf("%s %s %s", time.Now().Format("15:04:05"), level, message)
}

// splitSlogLevel 从 slog TextHandler 风格的 `level=INFO` token 提取级别，并返回去掉
// 该 token 的正文。值可能被引号包住（level="INFO"）；DEBUG 归到 INFO，避免界面把调试
// 信息当成故障。没命中时 found=false，由调用方按输出流回退。
func splitSlogLevel(message string) (level, cleaned string, found bool) {
	tokens := strings.Split(message, " ")
	kept := make([]string, 0, len(tokens))
	for _, token := range tokens {
		if !found && strings.HasPrefix(token, "level=") {
			value := strings.ToUpper(strings.Trim(strings.TrimPrefix(token, "level="), `"'`))
			switch value {
			case "DEBUG", "INFO":
				level = "INFO"
			case "WARN":
				level = "WARN"
			case "ERROR":
				level = "ERROR"
			}
			if level != "" {
				found = true
				continue
			}
		}
		kept = append(kept, token)
	}
	return level, strings.Join(kept, " "), found
}

// stopLocalProcess 终止 ipc 托管的 serve：SIGTERM → 最多等 5s → SIGKILL，并清掉登记。
// 返回错误表示进程没能确认退出，此时保留登记，让 system.status 继续显示 process。
func (s *Server) stopLocalProcess() error {
	s.procMu.Lock()
	process := s.proc
	s.procMu.Unlock()
	if process == nil {
		return nil
	}
	if !process.exited() {
		// 进程可能刚好退出，Signal 返回 os.ErrProcessDone 属正常，不必当错误。
		if err := terminateLocalProcess(process.cmd); err != nil && !process.exited() {
			s.logf("向本地服务进程发送终止信号失败: %v", err)
		}
		if !waitLocalProcess(process, s.localStopWait()) {
			if err := process.cmd.Process.Kill(); err != nil && !process.exited() {
				s.logf("强制结束本地服务进程失败: %v", err)
			}
			if !waitLocalProcess(process, localKillTimeout) {
				return fmt.Errorf(
					"本地服务进程在 %s 内没有响应 SIGTERM，SIGKILL 后仍未退出",
					s.localStopWait(),
				)
			}
		}
	}
	s.procMu.Lock()
	if s.proc == process {
		s.proc = nil
	}
	s.procMu.Unlock()
	return nil
}

func waitLocalProcess(process *localServiceProcess, timeout time.Duration) bool {
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-process.done:
		return true
	case <-timer.C:
		return false
	}
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
