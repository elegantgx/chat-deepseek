//go:build windows

package ipc

import "os/exec"

// terminateLocalProcess 在 Windows 上没有 SIGTERM，直接结束进程；
// 调用方仍然先尝试优雅结束，失败排队到超时后的 Process.Kill，语义一致。
func terminateLocalProcess(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	return cmd.Process.Kill()
}
