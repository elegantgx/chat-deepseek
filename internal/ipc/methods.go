package ipc

import (
	"context"
	"encoding/json"
	"runtime"
	"time"

	"github.com/elegantgx/chat-deepseek/internal/backup"
	"github.com/elegantgx/chat-deepseek/internal/config"
)

// methodSpec 把一个方法名绑定到处理函数；methodTable 的顺序就是 capabilities 的顺序。
type methodSpec struct {
	name   string
	handle func(*Server, json.RawMessage) (any, *rpcError)
}

// noParams 适配不需要参数的只读方法，保留它们原来的无参签名，便于直接调用与测试。
func noParams(handle func(*Server) (any, *rpcError)) func(*Server, json.RawMessage) (any, *rpcError) {
	return func(server *Server, _ json.RawMessage) (any, *rpcError) {
		return handle(server)
	}
}

func methodTable() []methodSpec {
	return []methodSpec{
		{name: "system.status", handle: noParams((*Server).systemStatus)},
		{name: "system.capabilities", handle: noParams((*Server).systemCapabilities)},
		{name: "config.get", handle: noParams((*Server).configGet)},
		{name: "backup.list", handle: noParams((*Server).backupList)},
		{name: "backup.create", handle: (*Server).backupCreate},
		{name: "backup.restore", handle: (*Server).backupRestore},
		{name: "backup.delete", handle: (*Server).backupDelete},
		{name: "service.start", handle: (*Server).serviceStart},
		{name: "service.stop", handle: (*Server).serviceStop},
		{name: "service.restart", handle: (*Server).serviceRestart},
		{name: "service.logs", handle: (*Server).serviceLogs},
		{name: "auth.whoami", handle: noParams((*Server).authWhoami)},
		{name: "auth.login", handle: (*Server).authLogin},
		{name: "auth.logout", handle: (*Server).authLogout},
		{name: "account.list", handle: (*Server).accountList},
		{name: "account.add", handle: (*Server).accountAdd},
		{name: "account.password", handle: (*Server).accountPassword},
		{name: "account.delete", handle: (*Server).accountDelete},
		{name: "config.set", handle: (*Server).configSet},
		{name: "service.install", handle: (*Server).serviceInstall},
		{name: "service.uninstall", handle: (*Server).serviceUninstall},
	}
}

type serviceInfo struct {
	State  string `json:"state"`
	Listen string `json:"listen"`
	Source string `json:"source"`
	// Installed/Supported 来自 systemd 管理器的 Status，而不是 TCP 探测：
	// 探测只能说明端口通不通，分不出「没装」和「装了但停了」。
	Installed bool `json:"installed"`
	Supported bool `json:"supported"`
	// Mode 回答「谁在管」：ipc 托管的本地子进程（process）、已安装的 systemd 用户单元
	// （systemd），或两者都没有（none）。它与 State 正交，State 只回答端口通不通。
	Mode string `json:"mode"`
}

type statusResult struct {
	Version string      `json:"version"`
	DataDir string      `json:"dataDir"`
	Service serviceInfo `json:"service"`
}

type capabilitiesFeatures struct {
	Systemd   bool `json:"systemd"`
	SSH       bool `json:"ssh"`
	Autostart bool `json:"autostart"`
	// Backup/Service 表示本版控制面已注册对应写方法；systemd 是否可用仍由独立开关表达。
	Backup  bool `json:"backup"`
	Service bool `json:"service"`
}

type capabilitiesResult struct {
	Platform   string               `json:"platform"`
	Methods    []string             `json:"methods"`
	Features   capabilitiesFeatures `json:"features"`
	IPCVersion int                  `json:"ipcVersion"`
}

type configResult struct {
	DataDir   string `json:"dataDir"`
	Listen    string `json:"listen"`
	APIOrigin string `json:"apiOrigin"`
	BackupDir string `json:"backupDir"`
	Version   string `json:"version"`
}

type backupEntry struct {
	File  string `json:"file"`
	Path  string `json:"path"`
	Size  int64  `json:"size"`
	MTime string `json:"mtime"`
}

type backupListResult struct {
	Backups []backupEntry `json:"backups"`
	Dir     string        `json:"dir"`
}

func (s *Server) systemStatus() (any, *rpcError) {
	cfg, err := config.Load(s.dataDir)
	if err != nil {
		return nil, internalError("读取配置失败", err)
	}
	// 安装状态每次都按需构造 controller 读取，不把它挂到 Server 上：
	// system.status 只是投影，不应该为一次读状态引入长生命周期依赖。
	// Status 内部只有 os.Stat 和少量 systemctl 查询，超时兜底避免 GUI 启动被拖慢。
	controller := s.newService()
	statusCtx, statusCancel := context.WithTimeout(context.Background(), serviceStatusTimeout)
	defer statusCancel()
	status, statusErr := controller.Status(statusCtx)
	supported := status.Supported
	installed := status.Installed
	if statusErr != nil {
		// 状态读取失败不能影响 TCP 探测本身，也不能让 system.status 报错；
		// 平台能力退回 SupportError 判断，安装状态按「未安装」保守处理，细节写 stderr。
		s.logf("读取服务安装状态失败: %v", statusErr)
		supported = controller.SupportError() == nil
		installed = false
	}
	return statusResult{
		Version: s.version,
		DataDir: s.dataDir,
		Service: serviceInfo{
			State:     probeServiceState(cfg.Listen, s.probeTimeout),
			Listen:    cfg.Listen,
			Source:    "probe",
			Installed: installed,
			Supported: supported,
			Mode:      s.serviceMode(installed),
		},
	}, nil
}

func (s *Server) systemCapabilities() (any, *rpcError) {
	methods := make([]string, len(s.methodOrder))
	copy(methods, s.methodOrder)
	return capabilitiesResult{
		Platform: runtime.GOOS,
		Methods:  methods,
		Features: capabilitiesFeatures{
			// 本阶段不实现 systemd/ssh/autostart；即使宿主是 Linux 也返回 false。
			Systemd:   false,
			SSH:       false,
			Autostart: false,
			// backup/service 方法已经可用，但 service 的底层仍依赖当前平台的 systemd；
			// 不可用时方法会返回结构化 unavailable，而不是假装成功。
			Backup:  true,
			Service: true,
		},
		IPCVersion: IPCVersion,
	}, nil
}

func (s *Server) configGet() (any, *rpcError) {
	cfg, err := config.Load(s.dataDir)
	if err != nil {
		return nil, internalError("读取配置失败", err)
	}
	backupDir, err := config.ResolveBackupDir(s.dataDir, cfg.BackupDir)
	if err != nil {
		return nil, internalError("解析备份地址失败", err)
	}
	// 只投影非敏感字段；config.json 里的 public_url 等不在此接口暴露。
	return configResult{
		DataDir:   s.dataDir,
		Listen:    cfg.Listen,
		APIOrigin: cfg.APIOrigin,
		BackupDir: backupDir,
		Version:   s.version,
	}, nil
}

func (s *Server) backupList() (any, *rpcError) {
	cfg, err := config.Load(s.dataDir)
	if err != nil {
		return nil, internalError("读取配置失败", err)
	}
	dir, err := config.ResolveBackupDir(s.dataDir, cfg.BackupDir)
	if err != nil {
		return nil, internalError("解析备份地址失败", err)
	}
	archives, err := backup.List(dir)
	if err != nil {
		return nil, internalError("读取备份目录失败", err)
	}
	// 目录不存在时 backup.List 返回 nil；这里显式给空切片，保证 JSON 是 [] 而不是 null。
	entries := make([]backupEntry, 0, len(archives))
	for _, archive := range archives {
		entries = append(entries, backupEntry{
			File:  archive.Name,
			Path:  archive.Path,
			Size:  archive.Size,
			MTime: archive.Time.Format(time.RFC3339),
		})
	}
	return backupListResult{Backups: entries, Dir: dir}, nil
}
