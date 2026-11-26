package ipc

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/elegantgx/chat-deepseek/internal/backup"
	"github.com/elegantgx/chat-deepseek/internal/config"
)

type backupCreateResult struct {
	File string `json:"file"`
	Path string `json:"path"`
	Size int64  `json:"size"`
}

type backupRestoreResult struct {
	OK       bool     `json:"ok"`
	Restored []string `json:"restored"`
}

type backupDeleteResult struct {
	OK bool `json:"ok"`
}

type backupFileParams struct {
	File string `json:"file"`
}

func (s *Server) backupCreate(_ json.RawMessage) (any, *rpcError) {
	s.backupOp.Lock()
	defer s.backupOp.Unlock()

	cfg, rpcErr := s.backupContext()
	if rpcErr != nil {
		return nil, rpcErr
	}
	if _, err := os.Stat(config.DatabasePath(s.dataDir)); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, notFoundError("数据目录中没有 chat.db：" + s.dataDir)
		}
		return nil, internalError("检查数据库文件失败", err)
	}
	if s.serviceRunning(cfg.listen) {
		return nil, unavailableError(backupRunningMessage)
	}
	// 复用 internal/backup.Create：它自己会再检查 chat.db-wal/-shm，IPC 不绕过。
	archivePath, err := backup.Create(s.dataDir, cfg.backupDir, "")
	if err != nil {
		if errors.Is(err, backup.ErrDatabaseInUse) {
			return nil, unavailableError(backupRunningMessage)
		}
		return nil, internalError("创建备份失败", err)
	}
	info, err := os.Stat(archivePath)
	if err != nil {
		return nil, internalError("读取备份文件失败", err)
	}
	return backupCreateResult{
		File: filepath.Base(archivePath),
		Path: archivePath,
		Size: info.Size(),
	}, nil
}

func (s *Server) backupRestore(params json.RawMessage) (any, *rpcError) {
	s.backupOp.Lock()
	defer s.backupOp.Unlock()

	payload, rpcErr := parseBackupFileParams(params)
	if rpcErr != nil {
		return nil, rpcErr
	}
	cfg, rpcErr := s.backupContext()
	if rpcErr != nil {
		return nil, rpcErr
	}
	archivePath, rpcErr := resolveBackupArchive(cfg.backupDir, payload.File)
	if rpcErr != nil {
		return nil, rpcErr
	}
	if s.serviceRunning(cfg.listen) {
		return nil, unavailableError(restoreRunningMessage)
	}
	restored, rpcErr := archiveDataEntries(archivePath)
	if rpcErr != nil {
		return nil, rpcErr
	}
	// 复用 internal/backup.Restore；它会再次检查 WAL/SHM 并原子替换数据项。
	if _, err := backup.Restore(s.dataDir, cfg.backupDir, filepath.Base(archivePath)); err != nil {
		if errors.Is(err, backup.ErrDatabaseInUse) {
			return nil, unavailableError(restoreRunningMessage)
		}
		return nil, internalError("恢复备份失败", err)
	}
	return backupRestoreResult{OK: true, Restored: restored}, nil
}

func (s *Server) backupDelete(params json.RawMessage) (any, *rpcError) {
	s.backupOp.Lock()
	defer s.backupOp.Unlock()

	payload, rpcErr := parseBackupFileParams(params)
	if rpcErr != nil {
		return nil, rpcErr
	}
	cfg, rpcErr := s.backupContext()
	if rpcErr != nil {
		return nil, rpcErr
	}
	archivePath, rpcErr := resolveBackupArchive(cfg.backupDir, payload.File)
	if rpcErr != nil {
		return nil, rpcErr
	}
	if err := os.Remove(archivePath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, notFoundError("备份不存在：" + payload.File)
		}
		return nil, internalError("删除备份失败", err)
	}
	return backupDeleteResult{OK: true}, nil
}

// backupContext 一次性解析数据目录、备份目录和当前配置，避免三个写方法各写一遍。
type backupRuntime struct {
	backupDir string
	listen    string
}

func (s *Server) backupContext() (backupRuntime, *rpcError) {
	cfg, err := config.Load(s.dataDir)
	if err != nil {
		return backupRuntime{}, internalError("读取配置失败", err)
	}
	backupDir, err := config.ResolveBackupDir(s.dataDir, cfg.BackupDir)
	if err != nil {
		return backupRuntime{}, internalError("解析备份地址失败", err)
	}
	return backupRuntime{backupDir: backupDir, listen: cfg.Listen}, nil
}

func (s *Server) serviceRunning(listen string) bool {
	return probeServiceState(listen, s.probeTimeout) == stateRunning
}

func parseBackupFileParams(params json.RawMessage) (backupFileParams, *rpcError) {
	payload := backupFileParams{}
	trimmed := bytes.TrimSpace(params)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return payload, badRequestError("缺少参数 file")
	}
	if err := json.Unmarshal(params, &payload); err != nil {
		return payload, badRequestError("参数必须是 JSON 对象且包含字符串 file")
	}
	return payload, nil
}

// resolveBackupArchive 只接受备份目录内的普通 .zip 文件名：
// 任何路径分隔符、绝对路径、符号链接或目录穿越都在这里被拒绝。
func resolveBackupArchive(backupDir, name string) (string, *rpcError) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", badRequestError("缺少参数 file")
	}
	if strings.ContainsRune(name, 0) ||
		strings.ContainsAny(name, `/\`) ||
		filepath.IsAbs(name) ||
		filepath.Base(name) != name ||
		name == "." || name == ".." {
		return "", badRequestError("备份文件名不能包含路径分隔符")
	}
	if !strings.HasSuffix(strings.ToLower(name), ".zip") {
		return "", badRequestError("备份文件必须是 .zip")
	}
	base := filepath.Clean(backupDir)
	candidate := filepath.Join(base, name)
	if !pathInside(base, candidate) {
		return "", badRequestError("备份路径不在备份目录内")
	}
	info, err := os.Lstat(candidate)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", notFoundError("备份不存在：" + name)
		}
		return "", internalError("检查备份文件失败", err)
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return "", badRequestError("备份不能是符号链接")
	}
	if !info.Mode().IsRegular() {
		return "", badRequestError("备份不是文件：" + name)
	}
	return candidate, nil
}

func pathInside(base, target string) bool {
	rel, err := filepath.Rel(base, target)
	if err != nil || filepath.IsAbs(rel) {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// archiveDataEntries 是恢复前的只读校验：只接受 internal/backup.Restore 会处理的条目，
// 并确认归档里确实有 chat.db，避免把明显的坏备份变成内部错误。
func archiveDataEntries(archivePath string) ([]string, *rpcError) {
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return nil, badRequestError("备份不是合法的 ZIP 文件")
	}
	defer func() { _ = reader.Close() }()

	restored := make([]string, 0, len(reader.File))
	hasDatabase := false
	for _, file := range reader.File {
		if file.FileInfo().IsDir() {
			continue
		}
		cleaned, ok := cleanArchiveEntry(file.Name)
		if !ok {
			return nil, badRequestError("备份包含非法路径：" + file.Name)
		}
		if !isRestorableEntry(cleaned) {
			continue
		}
		if !file.FileInfo().Mode().IsRegular() {
			return nil, badRequestError("备份包含不支持的文件类型：" + file.Name)
		}
		if cleaned == "chat.db" {
			hasDatabase = true
		}
		restored = append(restored, cleaned)
	}
	if !hasDatabase {
		return nil, badRequestError("备份中没有 chat.db")
	}
	return restored, nil
}

// cleanArchiveEntry 与 internal/backup.cleanArchivePath 保持同样的规则；
// 这里再做一次是为了让非法归档在 IPC 边界就得到 bad_request。
func cleanArchiveEntry(name string) (string, bool) {
	if name == "" || strings.ContainsRune(name, '\\') || path.IsAbs(name) {
		return "", false
	}
	cleaned := path.Clean(name)
	if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", false
	}
	return cleaned, true
}

func isRestorableEntry(name string) bool {
	switch name {
	case "config.json", "chat.db", "master.key":
		return true
	}
	return strings.HasPrefix(name, "files/") && len(name) > len("files/")
}
