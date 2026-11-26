//go:build darwin

package ipc

import (
	"os"

	"golang.org/x/sys/unix"
)

// processStartTime 返回当前进程的启动时间（微秒）；与 PID 组成 hostKey。
// 读不到时返回 0，由 currentHostKey 用随机标识兜底。
func processStartTime() uint64 {
	info, err := unix.SysctlKinfoProc("kern.proc.pid", os.Getpid())
	if err != nil {
		return 0
	}
	return uint64(info.Proc.P_starttime.Sec)*1_000_000 + uint64(info.Proc.P_starttime.Usec)
}
