package ipc

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// ipcSessionVersion 与 CLI 会话文件保持一致；ipc 不 import internal/cli，
// 但读写的是同一套目录规则和 JSON 结构，版本号必须相同。
const ipcSessionVersion = 1

// ipcSession 是保存在用户运行时目录里的登录态；数据库只存 token 哈希。
// 字段名与 internal/cli 的 cliSession 完全相同，便于两个入口共用同一目录。
type ipcSession struct {
	Version   int    `json:"version"`
	DataDir   string `json:"data_dir"`
	UserID    string `json:"user_id"`
	Username  string `json:"username"`
	Token     string `json:"token"`
	ExpiresAt int64  `json:"expires_at"`
}

// hostKey 标识持有登录态的进程。PID 会被系统回收，因此同时记录进程启动时间；
// ipc 用当前进程自己的 hostKey，进程退出后换一个进程就找不到旧会话文件。
type hostKey struct {
	PID   int
	Start uint64
}

func (h hostKey) filename() string {
	return fmt.Sprintf("%d-%d.json", h.PID, h.Start)
}

func currentHostKey() hostKey {
	start := processStartTime()
	if start == 0 {
		// 启动时间读不到时不能退化成 PID-0.json：进程被 SIGKILL 后会话文件
		// 还会保留 12h，PID 一旦被复用就会把旧登录态带给新进程。随机标识
		// 在每个进程内固定，足以避免这种继承。
		start = randomHostMarker()
	}
	return hostKey{PID: os.Getpid(), Start: start}
}

// randomHostMarker 返回非零随机标识；crypto/rand 失败时用纳秒时间兜底，
// 仍然保证不为 0，避免重新落到 PID-0.json。
func randomHostMarker() uint64 {
	var buffer [8]byte
	if _, err := rand.Read(buffer[:]); err == nil {
		marker := binary.LittleEndian.Uint64(buffer[:])
		if marker != 0 {
			return marker
		}
	}
	return uint64(time.Now().UnixNano()) | 1
}

// sessionRoot 返回会话文件根目录；测试通过 Server.sessionRoot 隔离到临时目录。
func (s *Server) sessionRootPath() string {
	if s.sessionRoot != "" {
		return s.sessionRoot
	}
	return defaultSessionRoot()
}

func (s *Server) sessionDir() string {
	return filepath.Join(s.sessionRootPath(), "sessions")
}

func (s *Server) sessionPath() string {
	return filepath.Join(s.sessionDir(), s.host.filename())
}

// defaultSessionRoot 复刻 CLI 的候选顺序：优先用户运行时目录（tmpfs），
// 容器或只读环境下退到状态/缓存/临时目录。
func defaultSessionRoot() string {
	candidates := sessionRootCandidates()
	for _, root := range candidates {
		if ensureSessionDir(root) {
			return root
		}
	}
	if len(candidates) > 0 {
		return candidates[0]
	}
	return filepath.Join(os.TempDir(), "chat-deepseek")
}

func sessionRootCandidates() []string {
	var roots []string
	add := func(base string) {
		if base != "" {
			roots = append(roots, filepath.Join(base, "chat-deepseek"))
		}
	}
	switch runtime.GOOS {
	case "linux":
		add(os.Getenv("XDG_RUNTIME_DIR"))
		add(os.Getenv("XDG_STATE_HOME"))
		if home, err := os.UserHomeDir(); err == nil {
			add(filepath.Join(home, ".local", "state"))
		}
	case "darwin":
		add(os.TempDir())
	case "windows":
		if dir, err := os.UserCacheDir(); err == nil {
			roots = append(roots, filepath.Join(dir, "chat-deepseek", "run"))
		}
	}
	if dir, err := os.UserCacheDir(); err == nil {
		roots = append(roots, filepath.Join(dir, "chat-deepseek"))
	}
	if home, err := os.UserHomeDir(); err == nil {
		roots = append(roots, filepath.Join(home, ".chat-deepseek"))
	}
	roots = append(roots, filepath.Join(os.TempDir(), tempSessionName()))
	return roots
}

func tempSessionName() string {
	if uid := os.Getuid(); uid >= 0 {
		return fmt.Sprintf("chat-deepseek-%d", uid)
	}
	return "chat-deepseek"
}

// ensureSessionDir 确认目录属于当前用户且权限为 0700。
func ensureSessionDir(root string) bool {
	dir := filepath.Join(root, "sessions")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return false
	}
	info, err := os.Lstat(dir)
	if err != nil || !info.IsDir() {
		return false
	}
	return os.Chmod(dir, 0o700) == nil
}

// readOwnSession 只读取当前 ipc 进程自己的会话文件。
func (s *Server) readOwnSession() (*ipcSession, error) {
	data, err := os.ReadFile(s.sessionPath())
	if err != nil {
		return nil, err
	}
	var session ipcSession
	if err := json.Unmarshal(data, &session); err != nil {
		return nil, fmt.Errorf("解析会话文件失败: %w", err)
	}
	if session.Version != ipcSessionVersion || session.Token == "" || session.DataDir == "" {
		return nil, errors.New("会话文件格式不合法")
	}
	return &session, nil
}

// writeOwnSession 原子写入会话文件，权限 0600；明文 token 只出现在这个文件里。
func (s *Server) writeOwnSession(session *ipcSession) error {
	dir := s.sessionDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("创建会话目录失败: %w", err)
	}
	_ = os.Chmod(dir, 0o700)
	session.Version = ipcSessionVersion
	data, err := json.MarshalIndent(session, "", "  ")
	if err != nil {
		return fmt.Errorf("编码会话失败: %w", err)
	}
	data = append(data, '\n')
	tmp := s.sessionPath() + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return fmt.Errorf("写入会话失败: %w", err)
	}
	_ = os.Chmod(tmp, 0o600)
	if err := os.Rename(tmp, s.sessionPath()); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("替换会话失败: %w", err)
	}
	return nil
}

func (s *Server) removeOwnSession() {
	_ = os.Remove(s.sessionPath())
}

// cleanupExpiredSessionFiles 删除已过期或损坏的会话文件；与 CLI 的
// cleanupSessions 行为一致，避免运行时目录只增不减。
//
// 已知竞态：从读到过期到 os.Remove 之间，另一个 ipc 进程可能刚好把同一文件
// 滑动续期（12h 边界），于是这里删掉的是刚续期的文件。窗口极窄，CLI 的同源
// 逻辑也这样接受这个竞态，本版不额外加跨进程锁。
func (s *Server) cleanupExpiredSessionFiles(now time.Time) {
	entries, err := os.ReadDir(s.sessionDir())
	if err != nil {
		return
	}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		path := filepath.Join(s.sessionDir(), entry.Name())
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var session ipcSession
		if err := json.Unmarshal(data, &session); err != nil || session.ExpiresAt <= now.UnixMilli() {
			_ = os.Remove(path)
		}
	}
}

// sameFilePath 在 Windows 上按大小写不敏感比较，避免同一目录被当成两个实例。
func sameFilePath(left, right string) bool {
	if runtime.GOOS == "windows" {
		return strings.EqualFold(left, right)
	}
	return left == right
}
