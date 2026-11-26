package main

import (
	"fmt"
	"os"

	"github.com/elegantgx/chat-deepseek/internal/cli"
	"github.com/elegantgx/chat-deepseek/internal/ipc"
)

func main() {
	// ipc 自己有退出码约定，并且 stdout 只允许协议行，因此不经过 cli.Run 的错误打印。
	if len(os.Args) > 1 && os.Args[1] == "ipc" {
		os.Exit(ipc.Main(os.Args[2:]))
	}
	if err := cli.Run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "错误：", err)
		os.Exit(cli.ExitStatus(err))
	}
}
