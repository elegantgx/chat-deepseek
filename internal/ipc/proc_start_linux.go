//go:build linux

package ipc

import (
	"os"
	"strconv"
	"strings"
)

// processStartTime 读取 /proc/self/stat 的 starttime（字段 22，单位 jiffies）。
// 和 hostKey 的 PID 一起使用，避免 PID 被系统回收后误认成同一个宿主进程。
// 读不到时返回 0，由 currentHostKey 用随机标识兜底。
func processStartTime() uint64 {
	data, err := os.ReadFile("/proc/self/stat")
	if err != nil {
		return 0
	}
	text := string(data)
	index := strings.LastIndexByte(text, ')')
	if index < 0 || index+2 >= len(text) {
		return 0
	}
	fields := strings.Fields(text[index+2:])
	// state 是字段 3，starttime 是字段 22；去掉 comm 后索引为 19。
	if len(fields) < 20 {
		return 0
	}
	start, err := strconv.ParseUint(fields[19], 10, 64)
	if err != nil {
		return 0
	}
	return start
}
