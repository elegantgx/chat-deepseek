package dev.chatdeepseek.android.ipc

/**
 * ipc 调用失败。`code` 直接来自 `docs/ipc.md` §3 的错误码（字符串）。
 *
 * 为什么继承 Exception 而不是 IOException：ipc 错误是协议层的正常结果
 * （未登录、资源冲突、服务未初始化），调用方要按 code 分支处理，不能当成 I/O 异常吞掉。
 * 进程不可用时也走这里，code 固定为 `network`，让桥把「拿不到控制面」和「网络失败」
 * 归到同一类给渲染层处理。
 */
class IpcError(
    val code: String,
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause)
