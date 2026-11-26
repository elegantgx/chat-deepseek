//go:build !windows

package ipc

import (
	"os/exec"
	"syscall"
)

// terminateLocalProcess 发送 SIGTERM，让 serve 走正常关闭流程（HTTP 优雅退出）。
// 调用方在 localStopTimeout 之后会退回 Process.Kill 强制结束。
func terminateLocalProcess(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	return cmd.Process.Signal(syscall.SIGTERM)
}
