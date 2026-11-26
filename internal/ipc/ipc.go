// Package ipc 实现桌面端使用的本地控制面：stdio + NDJSON 的 JSON-RPC 2.0 形状。
//
// 它供 GUI/Android 外壳读取服务状态与配置，管理登录态/账户，执行备份、配置写入和服务启停/安装，
// 避免解析 CLI 中文输出。
// stdout 只写协议行（响应和事件），日志一律写 stderr。
package ipc

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/elegantgx/chat-deepseek/internal/buildinfo"
)

// IPCVersion 是控制面信封的版本号，由 system.capabilities 返回。
const IPCVersion = 1

// MaxLineBytes 是单行请求的上限；超长行返回 bad_request 后继续服务。
const MaxLineBytes = 1 << 20

// 错误码是字符串，调用方按字符串匹配；括号里是对齐的 CLI 退出码。
const (
	codeBadRequest       = "bad_request"       // 2
	codeInternal         = "internal"          // 1
	codeUnauthenticated  = "unauthenticated"   // 3
	codePermissionDenied = "permission_denied" // 4
	codeNotFound         = "not_found"
	codeConflict         = "conflict"
	codeUnavailable      = "unavailable"
)

// defaultProbeTimeout 是 TCP 探测超时；GUI 打开时不应被长时间阻塞。
const defaultProbeTimeout = 300 * time.Millisecond

// ipcSessionTTL 是 ipc 登录态的滑动有效期：每次授权成功的请求都会续到
// 当前时间 + 12h。CLI 的 15 分钟一次性登录不适用于常驻的桌面窗口。
const ipcSessionTTL = 12 * time.Hour

var errLineTooLong = errors.New("ipc: 请求行过长")

// Server 处理一个数据目录上的控制面请求。
type Server struct {
	dataDir      string
	version      string
	probeTimeout time.Duration
	logger       *log.Logger

	methods     map[string]methodSpec
	methodOrder []string

	// serviceOp 是容量 1 的信号量：启停/重启必须串行，第二个并发请求立即失败，
	// 避免 GUI 双击按钮同时拉起两个进程。这里不用阻塞锁，否则两个 start 会先后都成功。
	serviceOp chan struct{}
	// backupOp 串行化备份创建/恢复/删除，避免同名归档互相覆盖。
	backupOp sync.Mutex
	// authOp 串行化登录/登出/账户变更：会话文件只有一份，账户操作还要
	// 保证「授权 → 修改」之间不被另一个请求插队。
	authOp sync.Mutex
	// configOp 串行化 config.set 的读-改-写，避免并发写丢字段。
	configOp sync.Mutex

	// sessionRoot 为空时使用与 CLI 相同的运行时目录；测试可替换成临时目录。
	sessionRoot string
	host        hostKey
	now         func() time.Time
	sessionTTL  time.Duration

	// 测试可替换；生产分别落到 internal/service、journalctl 与默认续期实现。
	newService   func() serviceController
	newLogTailer func() (logTailer, error)
	renewHook    sessionRenewer

	writerMu sync.Mutex
	writer   *protocolWriter

	tailMu     sync.Mutex
	tailCancel context.CancelFunc
	tailDone   chan struct{}
	tailID     int
}

// New 创建控制面服务。stderr 为 nil 时丢弃日志；dataDir 会被解析成绝对路径。
func New(dataDir string, stderr io.Writer) (*Server, error) {
	if strings.TrimSpace(dataDir) == "" {
		return nil, errors.New("数据目录不能为空")
	}
	dir, err := filepath.Abs(dataDir)
	if err != nil {
		return nil, fmt.Errorf("解析数据目录: %w", err)
	}
	if stderr == nil {
		stderr = io.Discard
	}
	s := &Server{
		dataDir:      dir,
		version:      buildinfo.Version,
		probeTimeout: defaultProbeTimeout,
		logger:       log.New(stderr, "ipc: ", 0),
		methods:      make(map[string]methodSpec),
		serviceOp:    make(chan struct{}, 1),
		newService:   func() serviceController { return newSystemdController() },
		newLogTailer: newJournalTailer,
		host:         currentHostKey(),
		now:          time.Now,
		sessionTTL:   ipcSessionTTL,
	}
	for _, spec := range methodTable() {
		s.methods[spec.name] = spec
		s.methodOrder = append(s.methodOrder, spec.name)
	}
	return s, nil
}

// request 只解析信封字段；params 交给具体方法按需解析，未知字段一律忽略。
type request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type rpcError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type successResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result"`
}

type errorResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Error   rpcError        `json:"error"`
}

// eventNotification 是服务端主动推送的事件：JSON-RPC 2.0 notification，没有 id。
type eventNotification struct {
	JSONRPC string `json:"jsonrpc"`
	Method  string `json:"method"`
	Params  any    `json:"params"`
}

// protocolWriter 串行化 stdout 写入：一行一个 JSON，写完立即 flush。
type protocolWriter struct {
	mu  sync.Mutex
	out *bufio.Writer
	err error
}

func (w *protocolWriter) writeSuccess(id json.RawMessage, result any) {
	w.write(successResponse{JSONRPC: "2.0", ID: id, Result: result})
}

func (w *protocolWriter) writeError(id json.RawMessage, code, message string) {
	w.write(errorResponse{
		JSONRPC: "2.0",
		ID:      id,
		Error:   rpcError{Code: code, Message: message},
	})
}

func (w *protocolWriter) writeEvent(method string, params any) {
	w.write(eventNotification{JSONRPC: "2.0", Method: method, Params: params})
}

func (w *protocolWriter) write(value any) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.err != nil {
		return
	}
	data, err := json.Marshal(value)
	if err != nil {
		w.err = err
		return
	}
	if _, err := w.out.Write(data); err != nil {
		w.err = err
		return
	}
	if err := w.out.WriteByte('\n'); err != nil {
		w.err = err
		return
	}
	w.err = w.out.Flush()
}

func (w *protocolWriter) Err() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.err
}

// Serve 从 in 逐行读取请求，直到 EOF；每个请求并发处理，响应按 id 匹配。
// EOF 是正常结束；只有读/写失败才返回错误。
func (s *Server) Serve(in io.Reader, out io.Writer) error {
	reader := bufio.NewReaderSize(in, 64*1024)
	writer := &protocolWriter{out: bufio.NewWriter(out)}
	s.setWriter(writer)
	defer func() {
		// 先停事件流再摘掉 writer，避免 Serve 返回后 tail goroutine 还往旧 writer 写。
		s.stopLogTail()
		// 登录态绑定当前进程：正常退出时主动吊销，失败只记 stderr。
		s.cleanupOwnSessionOnExit()
		s.setWriter(nil)
	}()
	var wg sync.WaitGroup
	for {
		line, err := readLine(reader)
		switch {
		case errors.Is(err, errLineTooLong):
			s.logf("bad_request: 请求行超过 %d 字节", MaxLineBytes)
			writer.writeError(nil, codeBadRequest, fmt.Sprintf("请求行超过 %d 字节上限", MaxLineBytes))
			continue
		case errors.Is(err, io.EOF):
			wg.Wait()
			if writeErr := writer.Err(); writeErr != nil {
				return fmt.Errorf("写响应: %w", writeErr)
			}
			return nil
		case err != nil:
			wg.Wait()
			return fmt.Errorf("读取请求: %w", err)
		}
		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			// 空行不算请求，也不产生响应，避免客户端格式化输出时打断流。
			continue
		}
		wg.Add(1)
		go func(payload []byte) {
			defer wg.Done()
			s.handle(writer, payload)
		}(line)
	}
}

func (s *Server) handle(writer *protocolWriter, payload []byte) {
	var req request
	if err := json.Unmarshal(payload, &req); err != nil {
		s.logf("bad_request: %v", err)
		writer.writeError(nil, codeBadRequest, fmt.Sprintf("请求不是合法 JSON: %v", err))
		return
	}
	// 规范里没有 id 的是 notification：执行但不写响应。
	notification := len(req.ID) == 0
	if req.JSONRPC != "2.0" {
		s.fail(writer, req.ID, notification, codeBadRequest, `jsonrpc 必须为 "2.0"`)
		return
	}
	if strings.TrimSpace(req.Method) == "" {
		s.fail(writer, req.ID, notification, codeBadRequest, "缺少 method")
		return
	}
	spec, ok := s.methods[req.Method]
	if !ok {
		s.fail(writer, req.ID, notification, codeNotFound, fmt.Sprintf("未知方法 %q", clip(req.Method, 80)))
		return
	}
	result, rpcErr := spec.handle(s, req.Params)
	if rpcErr != nil {
		s.fail(writer, req.ID, notification, rpcErr.Code, rpcErr.Message)
		return
	}
	if !notification {
		writer.writeSuccess(req.ID, result)
	}
}

func (s *Server) fail(writer *protocolWriter, id json.RawMessage, notification bool, code, message string) {
	s.logf("%s: %s", code, message)
	if !notification {
		writer.writeError(id, code, message)
	}
}

func (s *Server) logf(format string, args ...any) {
	if s.logger != nil {
		s.logger.Printf(format, args...)
	}
}

// setWriter 绑定本次 Serve 的 stdout 写入器；Serve 结束时会恢复为 nil。
func (s *Server) setWriter(writer *protocolWriter) {
	s.writerMu.Lock()
	s.writer = writer
	s.writerMu.Unlock()
}

// emitEvent 往当前 stdout 写一行事件。和响应共用 protocolWriter 的锁，
// 因此不会出现半行事件插进响应的情况。
func (s *Server) emitEvent(method string, params any) {
	s.writerMu.Lock()
	writer := s.writer
	s.writerMu.Unlock()
	if writer == nil {
		return
	}
	writer.writeEvent(method, params)
}

func badRequestError(message string) *rpcError {
	return &rpcError{Code: codeBadRequest, Message: message}
}

func notFoundError(message string) *rpcError {
	return &rpcError{Code: codeNotFound, Message: message}
}

func unavailableError(message string) *rpcError {
	return &rpcError{Code: codeUnavailable, Message: message}
}

func unauthenticatedError(message string) *rpcError {
	return &rpcError{Code: codeUnauthenticated, Message: message}
}

func permissionDeniedError(message string) *rpcError {
	return &rpcError{Code: codePermissionDenied, Message: message}
}

func conflictError(message string) *rpcError {
	return &rpcError{Code: codeConflict, Message: message}
}

// readLine 读取一行，最多 MaxLineBytes；超长时丢弃本行剩余内容并返回 errLineTooLong。
// 最后一行没有换行符也照常返回。
func readLine(reader *bufio.Reader) ([]byte, error) {
	var line []byte
	tooLong := false
	for {
		chunk, err := reader.ReadSlice('\n')
		if !tooLong {
			if len(line)+len(chunk) > MaxLineBytes {
				tooLong = true
				line = nil
			} else {
				line = append(line, chunk...)
			}
		}
		switch {
		case err == nil:
			if tooLong {
				return nil, errLineTooLong
			}
			return trimLineEnding(line), nil
		case errors.Is(err, bufio.ErrBufferFull):
			continue
		case errors.Is(err, io.EOF):
			if tooLong {
				return nil, errLineTooLong
			}
			if len(line) == 0 {
				return nil, io.EOF
			}
			return trimLineEnding(line), nil
		default:
			return nil, err
		}
	}
}

func trimLineEnding(line []byte) []byte {
	line = bytes.TrimSuffix(line, []byte("\n"))
	return bytes.TrimSuffix(line, []byte("\r"))
}

func clip(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit] + "…"
}

func internalError(prefix string, err error) *rpcError {
	return &rpcError{Code: codeInternal, Message: prefix + ": " + err.Error()}
}
