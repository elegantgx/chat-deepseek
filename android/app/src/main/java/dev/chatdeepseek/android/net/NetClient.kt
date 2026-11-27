package dev.chatdeepseek.android.net

import android.content.Context
import android.util.Base64
import android.util.Log
import dev.chatdeepseek.android.platform.ServerRegistry
import okhttp3.Call
import okhttp3.Headers
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONException
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.security.cert.CertPathValidatorException
import java.security.cert.CertificateException
import java.util.Collections
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException

private const val TAG = "NetClient"

/** 同源重定向最多跟这么多跳；跨源一律拒绝，不让服务器把带 Cookie 的请求带去外站。 */
private const val MAX_REDIRECTS = 5

/** 壳接管的请求头：Cookie 由 CookieJar 发，Host/长度由 OkHttp 算。 */
private val FORBIDDEN_REQUEST_HEADERS = setOf(
    "cookie",
    "host",
    "content-length",
    "transfer-encoding",
    "connection",
    // 让 OkHttp 自己加 Accept-Encoding 并透明解压；渲染层拿到的一定是解压后的字节。
    "accept-encoding",
)

/** OkHttp 要求这些方法必须有 body，缺省时补一个空 body。 */
private val METHODS_REQUIRING_BODY = setOf("POST", "PUT", "PATCH")

/**
 * 数据面：OkHttp + 每服务器 CookieJar。
 *
 * - 连接池共享：一个 base client，按 serverId 派生只换 CookieJar 的 client（`newBuilder` 复用
 *   ConnectionPool/Dispatcher），既隔离登录态又不重复建池。
 * - 超时：连接 10s、读 0（SSE 不能超时）、写 60s。
 * - 重定向：全局关闭自动跟随，自己只跟同源；跨站直接报 `protocol`。
 * - 渲染层拿不到 Cookie：`Set-Cookie` 会从返回头里剥掉，请求头的 Cookie 也会被忽略。
 */
class NetClient private constructor(
    private val registry: ServerRegistry,
    private val cookies: CookieStore,
) {

    companion object {
        @Volatile
        private var instance: NetClient? = null

        fun getInstance(context: Context, registry: ServerRegistry): NetClient {
            return instance ?: synchronized(this) {
                instance ?: NetClient(registry, CookieStore.getInstance(context)).also { instance = it }
            }
        }
    }

    private val baseClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        // SSE 连接会长时间没有数据；读超时必须为 0，真正的停止由 abort(cancel) 负责。
        .readTimeout(0, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .retryOnConnectionFailure(true)
        .build()

    private val clients = ConcurrentHashMap<String, OkHttpClient>()

    /** 在途 Call，按桥的 id 索引；abort 就是 cancel 它。 */
    private val calls = ConcurrentHashMap<String, Call>()

    /** 被 abort 的 id：Call 执行前的空窗期也要能识别，避免 abort 之后又跑出一个完整请求。 */
    private val aborted = Collections.newSetFromMap(ConcurrentHashMap<String, Boolean>())

    /** `netRequest`：返回状态/头/整包字节；非 2xx 抛 `http` 错误。 */
    fun request(id: String, spec: NetSpec): NetResponse {
        val target = targetFor(spec)
        val url = resolveUrl(target.baseUrl, spec.url)
        val request = buildRequest(spec, url)
        try {
            return execute(id, target.serverId, request).use { current ->
                if (!current.isSuccessful) {
                    throw httpError(current)
                }
                NetResponse(
                    status = current.code,
                    statusText = current.message,
                    headers = headersJson(current.headers),
                    body = readBody(current),
                )
            }
        } catch (error: IOException) {
            throw rethrowIo(id, error)
        } finally {
            clearCall(id)
        }
    }

    /**
     * `netStream`：把 SSE 字节按帧/16 KiB 聚合后 base64 分片。单条原文 ≤32 KiB，
     * 由 [NetLimits.STREAM_AGGREGATE_BYTES] 与控制读块大小共同保证。
     */
    fun stream(id: String, spec: NetSpec, onChunk: (String) -> Unit): NetResponse {
        val target = targetFor(spec)
        val url = resolveUrl(target.baseUrl, spec.url)
        val request = buildRequest(spec, url)
        try {
            return execute(id, target.serverId, request).use { current ->
                if (!current.isSuccessful) {
                    throw httpError(current)
                }
                val contentType = current.header("Content-Type").orEmpty()
                if (!contentType.contains("text/event-stream", ignoreCase = true)) {
                    // 200 但不是 SSE，说明对面不是 chat-deepseek 或版本不兼容；按协议错误处理，
                    // 渲染层能把它和网络失败区分开（非 2xx 已在上面拦截，这里不会发过 chunk）。
                    throw NetError("protocol", "响应不是 SSE")
                }
                val body = current.body ?: throw NetError("protocol", "响应没有 body")
                val pending = ByteArrayOutputStream(NetLimits.STREAM_AGGREGATE_BYTES + 8192)
                val buffer = ByteArray(8192)
                body.byteStream().use { input ->
                    while (true) {
                        ensureNotAborted(id)
                        val read = input.read(buffer)
                        if (read < 0) {
                            break
                        }
                        pending.write(buffer, 0, read)
                        if (pending.size() >= NetLimits.STREAM_AGGREGATE_BYTES ||
                            buffer[read - 1] == '\n'.code.toByte()
                        ) {
                            emitChunks(id, pending, onChunk)
                        }
                    }
                }
                emitChunks(id, pending, onChunk)
                NetResponse(
                    status = current.code,
                    statusText = current.message,
                    headers = headersJson(current.headers),
                    body = null,
                )
            }
        } catch (error: IOException) {
            throw rethrowIo(id, error)
        } finally {
            clearCall(id)
        }
    }

    /**
     * `netDownload`：附件、TTS 等任意二进制响应。与 SSE 共用 `chunk`，但按总量 64 MiB 封顶。
     * 非 2xx 不发任何 chunk，直接抛 `http`（带 status/statusText/headers）。
     */
    fun download(id: String, spec: NetSpec, onChunk: (String) -> Unit): NetResponse {
        val target = targetFor(spec)
        val url = resolveUrl(target.baseUrl, spec.url)
        val request = buildRequest(spec, url)
        try {
            return execute(id, target.serverId, request).use { current ->
                if (!current.isSuccessful) {
                    throw httpError(current)
                }
                val body = current.body ?: throw NetError("protocol", "响应没有 body")
                // 先看 Content-Length：明显超限时一个 chunk 都不发，别让渲染层先收 64 MiB 再报错。
                if (body.contentLength() > NetLimits.MAX_DOWNLOAD_BYTES) {
                    throw NetError("protocol", "下载超过 64 MiB")
                }
                val pending = ByteArrayOutputStream(NetLimits.STREAM_AGGREGATE_BYTES + 8192)
                val buffer = ByteArray(8192)
                var total = 0L
                body.byteStream().use { input ->
                    while (true) {
                        ensureNotAborted(id)
                        val read = input.read(buffer)
                        if (read < 0) {
                            break
                        }
                        total += read
                        if (total > NetLimits.MAX_DOWNLOAD_BYTES) {
                            throw NetError("protocol", "下载超过 64 MiB")
                        }
                        pending.write(buffer, 0, read)
                        if (pending.size() >= NetLimits.STREAM_AGGREGATE_BYTES) {
                            emitChunks(id, pending, onChunk)
                        }
                    }
                }
                emitChunks(id, pending, onChunk)
                NetResponse(
                    status = current.code,
                    statusText = current.message,
                    headers = headersJson(current.headers),
                    body = null,
                )
            }
        } catch (error: IOException) {
            throw rethrowIo(id, error)
        } finally {
            clearCall(id)
        }
    }

    /**
     * `netUpload`：multipart 从临时文件流式发（OkHttp 边读文件边写 socket，不整份进内存）。
     * 临时文件由调用方在 finally 删除，成功/失败/取消都不会留下。
     */
    fun upload(
        id: String,
        spec: NetSpec,
        temps: Map<String, UploadStore.TempFile>,
    ): NetResponse {
        val target = targetFor(spec)
        val url = resolveUrl(target.baseUrl, spec.url)
        val multipart = MultipartBody.Builder().setType(MultipartBody.FORM)
        // FormData 的顺序与同名多值都靠数组保证；按渲染层给的顺序逐个 append。
        for (field in spec.fields) {
            multipart.addFormDataPart(field.name, field.value)
        }
        for (ref in spec.files) {
            val temp = temps[ref.tempId]
                ?: throw NetError("protocol", "临时文件不存在或已过期")
            if (!temp.file.isFile) {
                throw NetError("protocol", "临时文件已被清理")
            }
            if (temp.file.length() > NetLimits.MAX_UPLOAD_BYTES) {
                throw NetError("protocol", "文件超过 64 MiB")
            }
            multipart.addFormDataPart(
                ref.field,
                ref.name,
                temp.file.asRequestBody(ref.mime.toMediaTypeOrNull()),
            )
        }
        val request = buildRequest(spec, url, multipart.build())
        try {
            return execute(id, target.serverId, request).use { current ->
                if (!current.isSuccessful) {
                    throw httpError(current)
                }
                NetResponse(
                    status = current.code,
                    statusText = current.message,
                    headers = headersJson(current.headers),
                    body = readBody(current),
                )
            }
        } catch (error: IOException) {
            throw rethrowIo(id, error)
        } finally {
            clearCall(id)
        }
    }

    /**
     * `shell.servers.probe`：对还没加入列表的 baseUrl 做一次匿名可达性探测。
     *
     * 打公开的 `/healthz`，它固定返回 `{status:"ok", name:"chat-deepseek", version}`：
     * 既能确认端口通，也能确认对面确实是本项目的服务端（避免把任意 https 站点加进来）。
     * 证书链问题抛 `tls`、DNS/连接/超时抛 `network`、非 2xx 抛 `http`（带 status），
     * 200 但不是 chat-deepseek 抛 `protocol`——界面对这几种给不同的下一步。
     *
     * 探测故意不带 Cookie：不能把已有服务器的登录态发给一个尚未确认的新地址。
     * 读超时单独收紧到 10s，base client 的 0 超时是给 SSE 的，探活不能无限等。
     */
    fun probe(rawBaseUrl: String): JSONObject {
        val base = rawBaseUrl.trim().trimEnd('/')
        val parsed = base.toHttpUrlOrNull() ?: throw NetError("protocol", "地址格式不正确")
        if (parsed.scheme != "https") {
            throw NetError("protocol", "远程服务器必须使用 https")
        }
        if (parsed.username.isNotEmpty() || parsed.password.isNotEmpty()) {
            throw NetError("protocol", "地址里不能带用户名或密码")
        }
        if (parsed.query != null || parsed.fragment != null) {
            throw NetError("protocol", "地址不能带查询参数或片段")
        }
        val url = (base + "/healthz").toHttpUrlOrNull()
            ?: throw NetError("protocol", "地址格式不正确")
        val probeClient = baseClient.newBuilder()
            .readTimeout(10, TimeUnit.SECONDS)
            .followRedirects(false)
            .followSslRedirects(false)
            .build()
        val request = Request.Builder().url(url).get().build()
        try {
            return probeClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw NetError(
                        code = "http",
                        message = "服务器返回 HTTP ${response.code}",
                        status = response.code,
                        statusText = response.message,
                        headers = headersJson(response.headers),
                    )
                }
                val text = response.peekBody(64L * 1024).string()
                val payload = try {
                    JSONObject(text)
                } catch (_: JSONException) {
                    throw NetError("protocol", "服务器没有返回 chat-deepseek 的健康信息")
                }
                if (payload.optString("name", "") != "chat-deepseek") {
                    throw NetError("protocol", "该地址不是 chat-deepseek 服务器")
                }
                JSONObject()
                    .put("status", response.code)
                    .put("baseUrl", base)
                    .put("version", payload.optString("version", ""))
            }
        } catch (error: IOException) {
            Log.w(TAG, "探测服务器失败: ${error.javaClass.simpleName}")
            throw mapIo(error)
        }
    }

    /** 真正的取消：OkHttp 会中断正在阻塞的 socket 读写。 */
    fun abort(id: String) {
        aborted.add(id)
        calls.remove(id)?.cancel()
    }

    /** 桥的任务收尾时调用，清掉取消标记与 Call 登记，避免 id 长期占内存。 */
    fun forget(id: String) {
        calls.remove(id)
        aborted.remove(id)
    }

    /** 页面重载/切换服务器：旧页面的所有请求一起取消。 */
    fun abortAll() {
        for (id in calls.keys.toList()) {
            abort(id)
        }
    }

    private fun targetFor(spec: NetSpec): Target {
        val serverId = spec.serverId ?: registry.selectedId()
            ?: throw NetError("no_server", "还没选择服务器")
        val baseUrl = registry.baseUrlOf(serverId)
            ?: throw NetError("no_server", "服务器不存在或地址未知")
        return Target(serverId, baseUrl)
    }

    private fun resolveUrl(baseUrl: String, path: String): HttpUrl {
        if (path.contains("://")) {
            throw NetError("protocol", "path 不能是完整 URL")
        }
        val base = baseUrl.trimEnd('/').toHttpUrlOrNull()
            ?: throw NetError("protocol", "服务器地址无效")
        // 明文只允许回环：远程服务器必须 https，本机 serve 没有 TLS。
        if (base.scheme == "http" && base.host != "127.0.0.1") {
            throw NetError("protocol", "明文 HTTP 只允许 127.0.0.1")
        }
        if (base.scheme != "https" && base.scheme != "http") {
            throw NetError("protocol", "不支持的协议: ${base.scheme}")
        }
        // 相对路径按 /api/v1/ 理解；绝对路径必须落在 /api/v1 下，避免壳被当成任意代理。
        val suffix = if (path.startsWith("/")) path else "/api/v1/$path"
        val url = (base.toString().trimEnd('/') + suffix).toHttpUrlOrNull()
            ?: throw NetError("protocol", "路径格式不正确")
        if (url.scheme != base.scheme || url.host != base.host || url.port != base.port) {
            throw NetError("protocol", "路径越出了服务器地址")
        }
        if (url.encodedPath != "/api/v1" && !url.encodedPath.startsWith("/api/v1/")) {
            throw NetError("protocol", "数据面路径必须以 /api/v1 开头")
        }
        return url
    }

    private fun buildRequest(spec: NetSpec, url: HttpUrl, overrideBody: RequestBody? = null): Request {
        val builder = Request.Builder().url(url)
        for ((name, value) in spec.headers) {
            if (name.lowercase(Locale.ROOT) in FORBIDDEN_REQUEST_HEADERS) {
                continue
            }
            try {
                builder.header(name, value)
            } catch (_: IllegalArgumentException) {
                throw NetError("protocol", "非法请求头: $name")
            }
        }
        val body = overrideBody ?: spec.body?.toRequestBody(null)
        val requestBody = if (body != null) {
            body
        } else if (spec.method in METHODS_REQUIRING_BODY) {
            ByteArray(0).toRequestBody(null)
        } else {
            null
        }
        return builder.method(spec.method, requestBody).build()
    }

    /**
     * 执行一次请求，只跟同源重定向。返回的 Response 可能不是 2xx，由调用方决定是否读 body。
     * 重新进入循环时会换一个新的 Call，并更新 [calls]，保证 abort 总能 cancel 到当前那一跳。
     */
    private fun execute(id: String, serverId: String, request: Request): Response {
        var currentRequest = request
        var call = clientFor(serverId).newCall(currentRequest)
        calls[id] = call
        var hops = 0
        while (true) {
            ensureNotAborted(id)
            val response = try {
                call.execute()
            } catch (error: IOException) {
                if (isAborted(id) || call.isCanceled()) {
                    throw NetAborted()
                }
                throw mapIo(error)
            }
            if (!response.isRedirect) {
                return response
            }
            val location = response.header("Location")
            if (location.isNullOrEmpty()) {
                return response
            }
            if (hops >= MAX_REDIRECTS) {
                response.close()
                throw NetError("protocol", "重定向次数过多")
            }
            hops++
            val target = currentRequest.url.resolve(location)
                ?: run {
                    response.close()
                    throw NetError("protocol", "重定向地址无效")
                }
            if (!sameOrigin(target, currentRequest.url)) {
                // 典型场景：远程服务器把 /api/v1 302 到别的主机。不能把 Cookie 带过去。
                response.close()
                throw NetError("protocol", "拒绝跨站重定向")
            }
            val nextMethod: String
            val nextBody: RequestBody?
            when (response.code) {
                301, 302, 303 -> {
                    nextMethod = if (currentRequest.method == "GET" || currentRequest.method == "HEAD") {
                        currentRequest.method
                    } else {
                        "GET"
                    }
                    nextBody = null
                }
                else -> {
                    nextMethod = currentRequest.method
                    nextBody = currentRequest.body
                }
            }
            val builder = Request.Builder().url(target)
            for (name in currentRequest.headers.names()) {
                if (nextBody == null &&
                    (name.equals("Content-Type", true) || name.equals("Content-Length", true))
                ) {
                    continue
                }
                builder.header(name, currentRequest.header(name) ?: continue)
            }
            builder.method(nextMethod, nextBody)
            response.close()
            currentRequest = builder.build()
            call = clientFor(serverId).newCall(currentRequest)
            calls[id] = call
        }
    }

    private fun clearCall(id: String) {
        forget(id)
    }

    private fun isAborted(id: String): Boolean = aborted.contains(id)

    private fun ensureNotAborted(id: String) {
        if (isAborted(id)) {
            throw NetAborted()
        }
    }

    private fun clientFor(serverId: String): OkHttpClient {
        return clients.getOrPut(serverId) {
            baseClient.newBuilder().cookieJar(cookies.jar(serverId)).build()
        }
    }

    private fun emitChunks(id: String, pending: ByteArrayOutputStream, onChunk: (String) -> Unit) {
        if (pending.size() == 0) {
            return
        }
        val bytes = pending.toByteArray()
        pending.reset()
        // 聚合上限已经保证 ≤24 KiB；这里再按 32 KiB 切一次，是对将来调大阈值的兜底。
        var offset = 0
        while (offset < bytes.size) {
            ensureNotAborted(id)
            val end = minOf(offset + NetLimits.MAX_STREAM_CHUNK_BYTES, bytes.size)
            val slice = bytes.copyOfRange(offset, end)
            onChunk(Base64.encodeToString(slice, Base64.NO_WRAP))
            offset = end
        }
    }

    private fun readBody(response: Response): ByteArray {
        val body = response.body ?: return ByteArray(0)
        val declared = body.contentLength()
        if (declared > NetLimits.MAX_RESPONSE_BYTES) {
            throw NetError("protocol", "响应超过 96 MiB")
        }
        val output = ByteArrayOutputStream(64 * 1024)
        val buffer = ByteArray(64 * 1024)
        var total = 0L
        body.byteStream().use { input ->
            while (true) {
                val read = input.read(buffer)
                if (read < 0) {
                    break
                }
                total += read
                if (total > NetLimits.MAX_RESPONSE_BYTES) {
                    throw NetError("protocol", "响应超过 96 MiB")
                }
                output.write(buffer, 0, read)
            }
        }
        return output.toByteArray()
    }

    private fun headersJson(headers: Headers): JSONObject {
        val json = JSONObject()
        for (name in headers.names()) {
            // Cookie 只在壳里：Set-Cookie 不往渲染层送，否则页面就能读到登录态。
            if (name.equals("Set-Cookie", true) || name.equals("Set-Cookie2", true)) {
                continue
            }
            json.put(name.lowercase(Locale.ROOT), headers.values(name).joinToString(", "))
        }
        return json
    }

    private fun httpError(response: Response): NetError {
        val status = response.code
        val bytes = try {
            response.peekBody(64L * 1024).bytes()
        } catch (_: IOException) {
            ByteArray(0)
        }
        val text = String(bytes, Charsets.UTF_8)
        return NetError(
            code = "http",
            message = extractErrorMessage(text).ifEmpty { "HTTP $status" },
            status = status,
            statusText = response.message,
            // 失败响应头/正文也返回：页面要据此判断 401 跳登录、403 提示权限，并解析错误 JSON。
            headers = headersJson(response.headers),
            bodyBase64 = Base64.encodeToString(bytes, Base64.NO_WRAP),
        )
    }

    /** 服务端错误体形如 `{"error":{"message":"..."}}`；不是 JSON 就截一段原文。 */
    private fun extractErrorMessage(text: String): String {
        if (text.isBlank()) {
            return ""
        }
        try {
            val message = JSONObject(text).optJSONObject("error")?.optString("message", "").orEmpty()
            if (message.isNotEmpty()) {
                return message.take(300)
            }
        } catch (_: JSONException) {
            // 非 JSON 响应直接截断展示，不解析。
        }
        return text.trim().take(300)
    }

    private fun mapIo(error: IOException): NetError {
        if (isTlsFailure(error)) {
            return NetError("tls", error.javaClass.simpleName, cause = error)
        }
        return NetError("network", error.javaClass.simpleName, cause = error)
    }

    /**
     * 证书链不受信任、域名不匹配、握手失败都归 `tls`。OkHttp 常把根因包在 cause 链里，
     * 例如 SSLHandshakeException -> CertPathValidatorException，所以顺着 cause 看几层。
     */
    private fun isTlsFailure(error: Throwable): Boolean {
        var current: Throwable? = error
        var depth = 0
        while (current != null && depth < 6) {
            if (current is SSLException ||
                current is SSLHandshakeException ||
                current is SSLPeerUnverifiedException ||
                current is CertificateException ||
                current is CertPathValidatorException
            ) {
                return true
            }
            current = current.cause
            depth++
        }
        return false
    }

    private fun rethrowIo(id: String, error: IOException): Exception {
        return if (isAborted(id)) NetAborted() else mapIo(error)
    }

    private fun sameOrigin(left: HttpUrl, right: HttpUrl): Boolean {
        return left.scheme == right.scheme && left.host == right.host && left.port == right.port
    }

    private data class Target(val serverId: String, val baseUrl: String)
}
