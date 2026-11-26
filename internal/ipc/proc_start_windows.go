//go:build windows

package ipc

import "syscall"

// processStartTime 返回当前进程的创建时间；与 PID 组成 hostKey。
// 读不到时返回 0，由 currentHostKey 用随机标识兜底。
func processStartTime() uint64 {
	handle, err := syscall.GetCurrentProcess()
	if err != nil {
		return 0
	}
	var creation, exit, kernel, user syscall.Filetime
	if err := syscall.GetProcessTimes(handle, &creation, &exit, &kernel, &user); err != nil {
		return 0
	}
	return uint64(creation.HighDateTime)<<32 | uint64(creation.LowDateTime)
}
