package ipc

import (
	"runtime"
	"time"

	"github.com/elegantgx/chat-deepseek/internal/backup"
	"github.com/elegantgx/chat-deepseek/internal/config"
)

// methodSpec 把一个方法名绑定到处理函数；methodTable 的顺序就是 capabilities 的顺序。
type methodSpec struct {
	name   string
	handle func(*Server) (any, *rpcError)
}

func methodTable() []methodSpec {
	return []methodSpec{
		{name: "system.status", handle: (*Server).systemStatus},
		{name: "system.capabilities", handle: (*Server).systemCapabilities},
		{name: "config.get", handle: (*Server).configGet},
		{name: "backup.list", handle: (*Server).backupList},
	}
}

type serviceInfo struct {
	State  string `json:"state"`
	Listen string `json:"listen"`
	Source string `json:"source"`
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
	return statusResult{
		Version: s.version,
		DataDir: s.dataDir,
		Service: serviceInfo{
			State:  probeServiceState(cfg.Listen, s.probeTimeout),
			Listen: cfg.Listen,
			Source: "probe",
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
