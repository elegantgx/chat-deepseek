package ipc

import (
	"errors"
	"net"
	"strings"
	"time"
)

const (
	stateRunning = "running"
	stateStopped = "stopped"
	stateUnknown = "unknown"
)

// probeServiceState 用 TCP 连接探测配置里的监听地址，不读取 PID、不编造状态。
// 连得上 running；连接失败（拒绝/超时/不可达）stopped；地址无法解析等探测错误 unknown。
func probeServiceState(listen string, timeout time.Duration) string {
	host, port, err := net.SplitHostPort(strings.TrimSpace(listen))
	if err != nil || port == "" {
		return stateUnknown
	}
	switch host {
	case "", "0.0.0.0":
		host = "127.0.0.1"
	case "::":
		host = "::1"
	}
	addr := net.JoinHostPort(host, port)
	if _, err := net.ResolveTCPAddr("tcp", addr); err != nil {
		return stateUnknown
	}
	if timeout <= 0 {
		timeout = defaultProbeTimeout
	}
	conn, err := net.DialTimeout("tcp", addr, timeout)
	if err == nil {
		_ = conn.Close()
		return stateRunning
	}
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return stateUnknown
	}
	var addrErr *net.AddrError
	if errors.As(err, &addrErr) {
		return stateUnknown
	}
	var opErr *net.OpError
	if errors.As(err, &opErr) && opErr.Op == "dial" {
		// dial 阶段失败说明地址可解析，只是没人监听（或网络不可达）。
		return stateStopped
	}
	return stateUnknown
}
