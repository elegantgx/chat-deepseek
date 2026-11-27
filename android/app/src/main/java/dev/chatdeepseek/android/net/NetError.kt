package dev.chatdeepseek.android.net

/**
 * 数据面/网络失败，`code` 是桥契约里的字符串：
 * `network`（连接、超时、DNS）、`tls`（证书链不受信任）、`http`（带 status）、
 * `protocol`（解析失败、超限、非法地址）、`no_server`（还没选服务器）。
 *
 * `message` 只用于诊断：`network`/`tls` 放异常简单类名，渲染层按 `code` 走 i18n，
 * 不解析这段文本（`docs/ipc.md` §3 对 message 的约定同理）。
 */
class NetError(
    val code: String,
    message: String,
    val status: Int? = null,
    /** HTTP 响应的 reason phrase，例如 `Unauthorized`；只有 http 错误有。 */
    val statusText: String? = null,
    /** 失败响应的头（已剥掉 Set-Cookie），供渲染层做跳转/诊断；不保证重复头。 */
    val headers: org.json.JSONObject? = null,
    /** 失败响应的完整 body（base64），让渲染层像浏览器一样解析错误 JSON。 */
    val bodyBase64: String? = null,
    cause: Throwable? = null,
) : Exception(message, cause)

/**
 * 被 `abort(id)` 取消。
 *
 * 单独一个类型是为了让桥能区分「用户主动停」和「真的失败」：前者不再发 `done`，
 * 否则界面上刚点完停止就会弹一个网络错误。
 */
class NetAborted : Exception("aborted")

/** 桥契约里的硬上限；[dev.chatdeepseek.android.web.ShellBridge] 与 `ready()` 的 capabilities 共用这份常量。 */
object NetLimits {
    /** 同时在途的 SSE 流。 */
    const val STREAM_CONCURRENCY = 4

    /** 同时在途的 multipart 上传；上传占临时文件与磁盘 IO，串行最稳。 */
    const val UPLOAD_CONCURRENCY = 1

    /** 与服务端 `filestore.MaxFileSize` 对齐：单文件 64 MiB。 */
    const val MAX_UPLOAD_BYTES = 64L * 1024 * 1024

    /** 下载（附件/TTS）总量上限，同样按 `MaxFileSize`；超过走 protocol 错误而不是把内存吃满。 */
    const val MAX_DOWNLOAD_BYTES = MAX_UPLOAD_BYTES

    /** 一条 `chunk` 的原文上限（base64 之后约 43.7 KiB）。 */
    const val MAX_STREAM_CHUNK_BYTES = 32 * 1024

    /** SSE 聚合阈值：够小才知道「停止生成」及时，够大才不会把桥线程打满。 */
    const val STREAM_AGGREGATE_BYTES = 16 * 1024

    /** `fileChunk` 的单片原文上限；渲染层按 ≤256 KiB 切。 */
    const val MAX_FILE_CHUNK_BYTES = 256 * 1024

    /**
     * 非流式响应体上限。桥只能传 base64 字符串，再大的附件本来就该走流/分片；
     * 这里挡住的是「错误地把几百 MiB 当 JSON 读」导致的 OOM。
     */
    const val MAX_RESPONSE_BYTES = 96L * 1024 * 1024
}
