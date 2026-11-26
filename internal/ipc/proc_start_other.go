//go:build !linux && !darwin && !windows

package ipc

// processStartTime 在未知平台上始终返回 0；currentHostKey 会用随机标识兜底，
// 避免文件名退化成 PID-0.json 后被复用的 PID 继承旧登录。
func processStartTime() uint64 {
	return 0
}
