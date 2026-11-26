//go:build linux

package ipc

import (
	"os/exec"
	"syscall"
)

// configureLocalProcess 给 ipc 托管的 serve 设置 Pdeathsig：ipc 被 SIGKILL 等
// 非常规方式终止时，内核也会给子进程发 SIGTERM，避免留下孤儿继续占着端口。
// 正常的退出路径仍由 stopLocalProcess 显式回收，Pdeathsig 只是兜底。
func configureLocalProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Pdeathsig: syscall.SIGTERM}
}
