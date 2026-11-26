//go:build !linux

package ipc

import (
	"os/exec"
	"syscall"
)

// configureLocalProcess 在非 Linux 平台使用普通的 SysProcAttr，没有 Pdeathsig。
// Windows/macOS 没有 systemd 时本地进程模式同样要能工作，靠 stopLocalProcess
// 与 Serve 退出路径显式回收子进程。
func configureLocalProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{}
}
