package ipc

import (
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"path/filepath"
	"strings"

	"github.com/elegantgx/chat-deepseek/internal/config"
)

type configSetParams struct {
	Listen    *string `json:"listen"`
	BackupDir *string `json:"backupDir"`
	APIOrigin *string `json:"apiOrigin"`
}

// configSet 读现有配置、合并三个允许的字段、一次原子写回。
// 只接受 listen/backupDir/apiOrigin，public_url 与未知字段保持原样。
func (s *Server) configSet(params json.RawMessage) (any, *rpcError) {
	payload := configSetParams{}
	if rpcErr := decodeParams(params, &payload); rpcErr != nil {
		return nil, rpcErr
	}
	if payload.Listen == nil && payload.BackupDir == nil && payload.APIOrigin == nil {
		return nil, badRequestError("至少提供一个配置项：listen、backupDir、apiOrigin")
	}

	// 先全部校验再动文件：任一字段非法都不应该留下半写状态。
	listen := ""
	if payload.Listen != nil {
		normalized, err := normalizeListen(*payload.Listen)
		if err != nil {
			return nil, badRequestError(err.Error())
		}
		listen = normalized
	}
	apiOrigin := ""
	if payload.APIOrigin != nil {
		normalized, err := normalizeAPIOrigin(*payload.APIOrigin)
		if err != nil {
			return nil, badRequestError(err.Error())
		}
		apiOrigin = normalized
	}
	backupDir := ""
	if payload.BackupDir != nil {
		normalized, err := normalizeBackupDir(*payload.BackupDir)
		if err != nil {
			return nil, badRequestError(err.Error())
		}
		backupDir = normalized
	}

	s.configOp.Lock()
	defer s.configOp.Unlock()

	cfg, err := config.Load(s.dataDir)
	if err != nil {
		return nil, internalError("读取配置失败", err)
	}
	if payload.Listen != nil {
		cfg.Listen = listen
	}
	if payload.APIOrigin != nil {
		cfg.APIOrigin = apiOrigin
	}
	if payload.BackupDir != nil {
		cfg.BackupDir = backupDir
	}
	if err := config.Save(s.dataDir, cfg); err != nil {
		return nil, internalError("写入配置失败", err)
	}
	resolvedBackup, err := config.ResolveBackupDir(s.dataDir, cfg.BackupDir)
	if err != nil {
		return nil, internalError("解析备份地址失败", err)
	}
	return configResult{
		DataDir:   s.dataDir,
		Listen:    cfg.Listen,
		APIOrigin: cfg.APIOrigin,
		BackupDir: resolvedBackup,
		Version:   s.version,
	}, nil
}

// normalizeListen 与 internal/config 的校验规则保持一致；IPC 不能修改
// internal/config，因此在这里复刻一份，避免依赖 config.Set 的分步写入。
func normalizeListen(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", fmt.Errorf("listen 不能为空")
	}
	if _, _, err := net.SplitHostPort(value); err != nil {
		return "", fmt.Errorf("listen 需要 host:port 格式: %v", err)
	}
	return value, nil
}

func normalizeAPIOrigin(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", fmt.Errorf("apiOrigin 不能为空")
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return "", fmt.Errorf("apiOrigin 不是合法 URL: %v", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("apiOrigin 必须以 http:// 或 https:// 开头")
	}
	if parsed.Host == "" {
		return "", fmt.Errorf("apiOrigin 缺少主机名")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("apiOrigin 不能带查询参数或片段")
	}
	return strings.TrimRight(value, "/"), nil
}

// normalizeBackupDir 为空表示清除配置（回落到 <dataDir>/backups），非空必须是绝对路径。
func normalizeBackupDir(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	if !filepath.IsAbs(value) {
		return "", fmt.Errorf("backupDir 必须是绝对路径")
	}
	return filepath.Clean(value), nil
}
