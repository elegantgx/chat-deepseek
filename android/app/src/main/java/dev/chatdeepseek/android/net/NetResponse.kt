package dev.chatdeepseek.android.net

import org.json.JSONObject

/**
 * 一次数据面响应的元信息。
 *
 * `done` 信封要带 `{status, statusText, headers}`（`docs/android-architecture.md` §4.1），
 * 而 `request` 的 result 还要带 body；把元信息与 body 分开，桥就不必从 result JSON 里反解。
 * `body` 为 null 表示字节已经通过 `chunk` 分片送过（stream/download）。
 */
class NetResponse(
    val status: Int,
    val statusText: String,
    val headers: JSONObject,
    val body: ByteArray?,
)
