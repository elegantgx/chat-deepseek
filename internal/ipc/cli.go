package ipc

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/elegantgx/chat-deepseek/internal/config"
)

// CLI 退出码与仓库其它子命令保持一致：0 成功、1 运行错误、2 用法错误。
const (
	exitOK    = 0
	exitError = 1
	exitUsage = 2
)

// Main 是 chat-deepseek ipc 的进程入口，返回退出码。
func Main(args []string) int {
	return Run(args, os.Stdin, os.Stdout, os.Stderr)
}

// Run 便于测试：从 stdin 读协议、往 stdout 写协议、日志写 stderr。
func Run(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("ipc", flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.Usage = func() {
		fmt.Fprintln(stderr, "用法：chat-deepseek ipc [--data-dir <dir>]")
		fmt.Fprintln(stderr, "")
		fmt.Fprintln(stderr, "从标准输入读取一行一个 JSON 请求，标准输出只写协议行，日志写标准错误。")
		fmt.Fprintln(stderr, "stdin 关闭时正常退出。")
	}
	dataDir := fs.String("data-dir", "", "数据目录，默认是二进制同级的 data/")
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return exitOK
		}
		return exitUsage
	}
	if fs.NArg() != 0 {
		fmt.Fprintln(stderr, "错误：ipc 不接受位置参数")
		return exitUsage
	}
	dir, err := config.ResolveDataDir(*dataDir)
	if err != nil {
		fmt.Fprintln(stderr, "错误：", err)
		return exitError
	}
	server, err := New(dir, stderr)
	if err != nil {
		fmt.Fprintln(stderr, "错误：", err)
		return exitError
	}
	if err := server.Serve(stdin, stdout); err != nil {
		fmt.Fprintln(stderr, "错误：", err)
		return exitError
	}
	return exitOK
}
