package ipc

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/elegantgx/chat-deepseek/internal/service"
)

// logLineContract 是渲染层 logs.ts 的 RAW_LINE 在 Go 侧的最小镜像：
// 控制面的格式化结果必须长期满足它，否则页面会退回“盖当前时间”。
var logLineContract = regexp.MustCompile(`^\d{2}:\d{2}:\d{2} (INFO|WARN|ERROR) .+$`)

// journalRecord 构造一条 journalctl -o json 记录；字段用 any 保留字符串/数字两种形态，
// 因为不同 systemd 版本对 PRIORITY 的编码并不一致。
func journalRecord(t *testing.T, fields map[string]any) string {
	t.Helper()
	data, err := json.Marshal(fields)
	if err != nil {
		t.Fatalf("编码 journal 记录: %v", err)
	}
	return string(data)
}

func journalTimestamp(moment time.Time) string {
	return strconv.FormatInt(moment.UnixMicro(), 10)
}

func TestJournalTailFormatsTimeLevelAndMessage(t *testing.T) {
	base := time.Date(2026, 11, 27, 9, 8, 7, 0, time.Local)
	output := strings.Join([]string{
		journalRecord(t, map[string]any{
			"MESSAGE":              "service started",
			"PRIORITY":             "6",
			"__REALTIME_TIMESTAMP": journalTimestamp(base),
		}),
		// PRIORITY 是数字时同样要能解析。
		journalRecord(t, map[string]any{
			"MESSAGE":              "disk nearly full",
			"PRIORITY":             4,
			"__REALTIME_TIMESTAMP": journalTimestamp(base.Add(time.Second)),
		}),
		journalRecord(t, map[string]any{
			"MESSAGE":              "panic",
			"PRIORITY":             "3",
			"__REALTIME_TIMESTAMP": journalTimestamp(base.Add(2 * time.Second)),
		}),
		// 缺失 PRIORITY 时按 INFO 投影。
		journalRecord(t, map[string]any{
			"MESSAGE":              "no priority",
			"__REALTIME_TIMESTAMP": journalTimestamp(base.Add(3 * time.Second)),
		}),
	}, "\n")

	lines := formatJournalEntries([]byte(output))
	want := []string{
		base.Format("15:04:05") + " INFO service started",
		base.Add(time.Second).Format("15:04:05") + " WARN disk nearly full",
		base.Add(2*time.Second).Format("15:04:05") + " ERROR panic",
		base.Add(3*time.Second).Format("15:04:05") + " INFO no priority",
	}
	if len(lines) != len(want) {
		t.Fatalf("lines = %v，期望 %v", lines, want)
	}
	for index, line := range lines {
		if line != want[index] {
			t.Fatalf("第 %d 行 = %q，期望 %q", index+1, line, want[index])
		}
		if !logLineContract.MatchString(line) {
			t.Fatalf("第 %d 行不符合渲染层正则: %q", index+1, line)
		}
	}
}

func TestJournalTailPriorityMapping(t *testing.T) {
	base := time.Date(2026, 11, 27, 0, 0, 0, 0, time.Local)
	for priority, want := range map[int]string{
		0: "ERROR",
		1: "ERROR",
		2: "ERROR",
		3: "ERROR",
		4: "WARN",
		5: "INFO",
		6: "INFO",
		7: "INFO",
	} {
		record := journalRecord(t, map[string]any{
			"MESSAGE":              "m",
			"PRIORITY":             strconv.Itoa(priority),
			"__REALTIME_TIMESTAMP": journalTimestamp(base),
		})
		lines := formatJournalEntries([]byte(record))
		if len(lines) != 1 {
			t.Fatalf("priority %d: lines = %v", priority, lines)
		}
		if !strings.Contains(lines[0], " "+want+" ") {
			t.Fatalf("priority %d = %q，期望级别 %s", priority, lines[0], want)
		}
	}
}

func TestJournalTailEmptyAndSentinelOutput(t *testing.T) {
	for name, output := range map[string]string{
		"空输出":        "",
		"只有换行":       "\n\n",
		"no entries": "-- No entries --\n",
		"坏行跳过":       "not json\n" + journalRecord(t, map[string]any{"MESSAGE": "kept", "PRIORITY": "6"}),
	} {
		t.Run(name, func(t *testing.T) {
			lines := formatJournalEntries([]byte(output))
			if name == "坏行跳过" {
				if len(lines) != 1 || !strings.HasSuffix(lines[0], " INFO kept") {
					t.Fatalf("坏行不应影响后续记录: %v", lines)
				}
				return
			}
			if len(lines) != 0 {
				t.Fatalf("lines = %v，期望空", lines)
			}
		})
	}
}

func TestJournalTailFoldsMultilineMessage(t *testing.T) {
	record := journalRecord(t, map[string]any{
		"MESSAGE":              "first\n\nsecond\r\nthird",
		"PRIORITY":             "6",
		"__REALTIME_TIMESTAMP": journalTimestamp(time.Now()),
	})
	lines := formatJournalEntries([]byte(record))
	if len(lines) != 1 {
		t.Fatalf("多行 message 必须压成一行: %v", lines)
	}
	if !strings.HasSuffix(lines[0], " INFO first / second / third") {
		t.Fatalf("折叠结果 = %q", lines[0])
	}
	if strings.Contains(lines[0], "\n") || strings.Contains(lines[0], "\r") {
		t.Fatalf("输出不能包含换行: %q", lines[0])
	}
}

func TestJournalTailDecodesByteArrayMessage(t *testing.T) {
	// journald 对非 UTF-8 消息输出字节数组；“测试”的 UTF-8 字节。
	record := `{"MESSAGE":[230,181,139,232,175,149],"PRIORITY":"6","__REALTIME_TIMESTAMP":"` +
		journalTimestamp(time.Now()) + `"}`
	lines := formatJournalEntries([]byte(record))
	if len(lines) != 1 || !strings.HasSuffix(lines[0], " INFO 测试") {
		t.Fatalf("字节数组 MESSAGE = %v", lines)
	}
}

func TestJournalTailUsesJSONOutput(t *testing.T) {
	var args []string
	tailer := journalTailer{run: func(_ context.Context, got ...string) ([]byte, error) {
		args = append([]string(nil), got...)
		return []byte(journalRecord(t, map[string]any{
			"MESSAGE":              "hello",
			"PRIORITY":             "6",
			"__REALTIME_TIMESTAMP": journalTimestamp(time.Now()),
		})), nil
	}}
	lines, err := tailer.Tail(20)
	if err != nil {
		t.Fatalf("Tail: %v", err)
	}
	if len(lines) != 1 || !strings.HasSuffix(lines[0], " INFO hello") {
		t.Fatalf("lines = %v", lines)
	}
	joined := strings.Join(args, " ")
	for _, want := range []string{"--user", "-u " + service.UnitName, "-n 20", "-o json"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("journalctl 参数 %q 缺少 %q", joined, want)
		}
	}
	if strings.Contains(joined, "-o cat") {
		t.Fatalf("不能再丢时间戳: %q", joined)
	}
}

func TestJournalTailWrapsReadErrorAsUnavailable(t *testing.T) {
	tailer := journalTailer{run: func(context.Context, ...string) ([]byte, error) {
		return nil, errors.New("journalctl: failed to connect to bus")
	}}
	_, err := tailer.Tail(5)
	if !errors.Is(err, errLogsUnavailable) {
		t.Fatalf("error = %v，期望包装成 errLogsUnavailable", err)
	}
}

func TestServiceLogsUninstalledReturnsEmptyWithoutReadingJournal(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")
	server.newService = func() serviceController {
		return &fakeServiceController{status: service.Status{Supported: true}}
	}
	called := false
	server.newLogTailer = func() (logTailer, error) {
		called = true
		return &fakeLogTailer{lines: []string{"stale journal line"}}, nil
	}

	value, rpcErr := server.serviceLogs(jsonParams(t, map[string]int{"tail": 50}))
	if rpcErr != nil {
		t.Fatalf("service.logs: %+v", rpcErr)
	}
	result := value.(serviceLogsResult)
	if len(result.Lines) != 0 || result.Lines == nil {
		t.Fatalf("未安装时应返回 []，得到 %#v", result.Lines)
	}
	if result.Truncated {
		t.Fatal("未安装时 truncated 应为 false")
	}
	if called {
		t.Fatal("未安装时不应读取 journal")
	}
}

func TestServiceLogsUninstalledStillReportsTailTruncation(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")
	server.newService = func() serviceController {
		return &fakeServiceController{status: service.Status{Supported: true}}
	}
	server.newLogTailer = func() (logTailer, error) { return &fakeLogTailer{}, nil }

	value, rpcErr := server.serviceLogs(jsonParams(t, map[string]int{"tail": maxLogTail + 1}))
	if rpcErr != nil {
		t.Fatalf("service.logs: %+v", rpcErr)
	}
	if !value.(serviceLogsResult).Truncated {
		t.Fatal("tail 超上限时即使未安装也要保留 truncated=true")
	}
}

func TestServiceLogsKeepsJournalWhenStatusFails(t *testing.T) {
	server, _ := newTestServer(t, "127.0.0.1:1")
	server.newService = func() serviceController {
		return &fakeServiceController{statusErr: errors.New("systemctl status 失败")}
	}
	server.newLogTailer = func() (logTailer, error) {
		return &fakeLogTailer{lines: []string{"kept line"}}, nil
	}

	value, rpcErr := server.serviceLogs(nil)
	if rpcErr != nil {
		t.Fatalf("service.logs: %+v", rpcErr)
	}
	result := value.(serviceLogsResult)
	if len(result.Lines) != 1 || result.Lines[0] != "kept line" {
		t.Fatalf("状态查询失败不应吞掉可读日志: %v", result.Lines)
	}
}

func TestSystemStatusProjectsInstalledAndSupported(t *testing.T) {
	cases := []struct {
		name       string
		status     service.Status
		statusErr  error
		supportErr error
		installed  bool
		supported  bool
	}{
		{
			name:      "已安装且平台支持",
			status:    service.Status{Supported: true, Installed: true},
			installed: true,
			supported: true,
		},
		{
			name:      "未安装但平台支持",
			status:    service.Status{Supported: true},
			installed: false,
			supported: true,
		},
		{
			name:      "平台不支持",
			status:    service.Status{Supported: false},
			installed: false,
			supported: false,
		},
		{
			name:      "状态读取失败但平台支持",
			statusErr: errors.New("stat 失败"),
			installed: false,
			supported: true,
		},
		{
			name:       "状态读取失败且平台不支持",
			statusErr:  errors.New("stat 失败"),
			supportErr: service.ErrUnsupported,
			installed:  false,
			supported:  false,
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			server, _ := newTestServer(t, "127.0.0.1:1")
			fake := &fakeServiceController{
				status:     testCase.status,
				statusErr:  testCase.statusErr,
				supportErr: testCase.supportErr,
			}
			server.newService = func() serviceController { return fake }

			value, rpcErr := server.systemStatus()
			if rpcErr != nil {
				// system.status 本身不能因为状态查询失败而报错。
				t.Fatalf("system.status: %+v", rpcErr)
			}
			info := value.(statusResult).Service
			if info.Installed != testCase.installed || info.Supported != testCase.supported {
				t.Fatalf(
					"installed/supported = %v/%v，期望 %v/%v",
					info.Installed,
					info.Supported,
					testCase.installed,
					testCase.supported,
				)
			}
			if info.State != stateStopped {
				t.Fatalf("state = %q，状态查询不能影响 TCP 探测", info.State)
			}
			fields := jsonFields(t, info)
			for _, key := range []string{"state", "listen", "source", "installed", "supported"} {
				if _, ok := fields[key]; !ok {
					t.Fatalf("service 字段缺少 %q: %v", key, fields)
				}
			}
			if fake.statusCalls != 1 {
				t.Fatalf("Status 调用 %d 次，期望 1 次", fake.statusCalls)
			}
		})
	}
}
