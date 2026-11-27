package dev.chatdeepseek.android.web

import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.WebView
import org.json.JSONObject
import java.util.Collections
import java.util.LinkedHashSet

private const val TAG = "BridgeCallbacks"

/** 记住最近多少个已结束的 id，用于压制迟到的 chunk/重复 done；渲染层的 id 是唯一的。 */
private const val MAX_FINISHED_IDS = 4096

/**
 * Kotlin → JS 的唯一出口：所有回调都从主线程 `evaluateJavascript` 发出，
 * 参数一律用 [JSONObject.quote] 变成字符串字面量，绝不把裸 JSON 拼进 JS。
 *
 * `done` 的幂等/终态保证收敛在这里：
 * - 同一个 `id` 只允许一次 `done`，重复调用直接丢弃；
 * - `abandon(id)` 用于 abort：标记为已结束但**不发 done**，避免用户刚点停止又弹错误；
 * - 已结束的 id 之后的 `chunk` 一律丢弃，保证 done 是最后一条。
 */
class BridgeCallbacks(
    private val webView: WebView,
    private val isAlive: () -> Boolean,
) {

    private val mainHandler = Handler(Looper.getMainLooper())
    private val finishedIds: MutableSet<String> = Collections.synchronizedSet(LinkedHashSet<String>())

    @Volatile
    private var closed = false

    fun doneResult(
        id: String,
        result: JSONObject?,
        status: Int? = null,
        statusText: String? = null,
        headers: JSONObject? = null,
    ) {
        val envelope = JSONObject()
            .put("ok", true)
            .put("result", result ?: JSONObject.NULL)
        attachMetadata(envelope, status, statusText, headers)
        finish(id, envelope)
    }

    fun doneError(
        id: String,
        code: String,
        message: String,
        status: Int? = null,
        statusText: String? = null,
        headers: JSONObject? = null,
        body: String? = null,
        cause: String? = null,
    ) {
        val error = JSONObject()
            .put("code", code)
            .put("message", message)
        if (status != null && status in 200..599) {
            error.put("status", status)
            if (statusText != null) {
                error.put("statusText", statusText)
            }
        }
        if (body != null) {
            error.put("body", body)
        }
        if (cause != null) {
            error.put("cause", cause)
        }
        val envelope = JSONObject()
            .put("ok", false)
            .put("error", error)
        // 契约把 status/statusText/headers 放在 done 信封顶层（§4.1），
        // error 里也保留一份 status/statusText，方便只读 error 的调用方。
        attachMetadata(envelope, status, statusText, headers)
        finish(id, envelope)
    }

    /**
     * `status` 只接受 200–599 的整数：0/字符串/越界值一律丢弃，避免渲染层拿到一个
     * 看起来像 HTTP 状态、实际却表示「未知」的东西。
     */
    private fun attachMetadata(
        envelope: JSONObject,
        status: Int?,
        statusText: String?,
        headers: JSONObject?,
    ) {
        if (status != null && status in 200..599) {
            envelope.put("status", status)
            envelope.put("statusText", statusText ?: "")
        }
        if (headers != null) {
            envelope.put("headers", headers)
        }
    }

    fun chunk(id: String, base64: String) {
        if (isFinished(id)) {
            return
        }
        // 契约要求 base64 只含 [A-Za-z0-9+/=]；这里再验一次，防止将来换成别的编码把 JS 字符串弄坏。
        if (!isBase64(base64)) {
            Log.w(TAG, "丢弃非 base64 的 chunk（id=$id）")
            return
        }
        evaluate("chunk", JSONObject.quote(id), JSONObject.quote(base64))
    }

    fun event(method: String, params: JSONObject) {
        val envelope = JSONObject()
            .put("method", method)
            .put("params", params)
        evaluate("event", JSONObject.quote(envelope.toString()))
    }

    /** abort：标记结束但不发 done。 */
    fun abandon(id: String) {
        markFinished(id)
    }

    fun isFinished(id: String): Boolean = finishedIds.contains(id)

    fun close() {
        closed = true
    }

    private fun finish(id: String, envelope: JSONObject) {
        if (!markFinished(id)) {
            return
        }
        evaluate("done", JSONObject.quote(id), JSONObject.quote(envelope.toString()))
    }

    private fun markFinished(id: String): Boolean {
        synchronized(finishedIds) {
            if (!finishedIds.add(id)) {
                return false
            }
            if (finishedIds.size > MAX_FINISHED_IDS) {
                val iterator = finishedIds.iterator()
                if (iterator.hasNext()) {
                    iterator.next()
                    iterator.remove()
                }
            }
            return true
        }
    }

    private fun evaluate(function: String, vararg quotedArgs: String) {
        val expression = buildString {
            append("window.__chatBridge&&window.__chatBridge.")
            append(function)
            append('(')
            append(quotedArgs.joinToString(","))
            append(')')
        }
        mainHandler.post {
            if (closed || !isAlive()) {
                return@post
            }
            try {
                webView.evaluateJavascript(expression, null)
            } catch (error: Throwable) {
                // WebView 正在销毁时 evaluate 可能抛；回调失败不该影响其它请求，记录即可。
                Log.w(TAG, "evaluateJavascript 失败: ${error.javaClass.simpleName}")
            }
        }
    }

    private fun isBase64(value: String): Boolean {
        if (value.isEmpty()) {
            return false
        }
        for (char in value) {
            val valid = char in 'A'..'Z' ||
                char in 'a'..'z' ||
                char in '0'..'9' ||
                char == '+' ||
                char == '/' ||
                char == '='
            if (!valid) {
                return false
            }
        }
        return true
    }
}
