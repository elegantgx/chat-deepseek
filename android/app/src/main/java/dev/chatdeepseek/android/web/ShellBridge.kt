package dev.chatdeepseek.android.web

import android.content.Context
import android.content.res.Configuration
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import dev.chatdeepseek.android.ipc.IpcClient
import dev.chatdeepseek.android.ipc.IpcError
import dev.chatdeepseek.android.net.CookieStore
import dev.chatdeepseek.android.net.NetAborted
import dev.chatdeepseek.android.net.NetClient
import dev.chatdeepseek.android.net.NetError
import dev.chatdeepseek.android.net.NetLimits
import dev.chatdeepseek.android.net.NetResponse
import dev.chatdeepseek.android.net.NetSpec
import dev.chatdeepseek.android.net.UploadStore
import dev.chatdeepseek.android.platform.AppInfo
import dev.chatdeepseek.android.platform.PlatformError
import dev.chatdeepseek.android.platform.PlatformHost
import dev.chatdeepseek.android.platform.ServerRegistry
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.File
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

private const val TAG = "ShellBridge"

/** `ready()` 在桥线程上最多等这么久；超时就用上一次缓存，绝不占 UI 线程。 */
private const val READY_WAIT_MILLIS = 1200L

/**
 * `addJavascriptInterface` 的名称，固定不可改（渲染层按这个名字找 `ChatShell`）。
 * 只在 assets 源的页面注入，其它来源不注入，见 [ShellWebView]。
 */
const val BRIDGE_INTERFACE_NAME = "ChatShell"

/**
 * 桥的 Kotlin 侧实现，线格式见 `docs/android-architecture.md` §4.1。
 *
 * 线程：`@JavascriptInterface` 方法在 WebView 的桥线程被调，允许阻塞；这里除了
 * [fileChunk]/[fileEnd] 这种明确同步的小操作，都丢到 IO 协程。回调只经 [BridgeCallbacks]
 * 从 UI 线程发出，桥线程从不碰 View。
 *
 * `id` 由渲染层生成、壳视为不透明字符串；`done` 的“只一次且最后一条”由 [BridgeCallbacks] 保证。
 */
class ShellBridge(
    private val context: Context,
    private val ipc: IpcClient,
    private val net: NetClient,
    private val uploads: UploadStore,
    private val registry: ServerRegistry,
    private val platformHost: PlatformHost,
    private val callbacks: BridgeCallbacks,
) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val jobs = ConcurrentHashMap<String, Job>()

    /** 在途的 net 请求 id：切换服务器/重载页面时要连带取消并删临时文件。 */
    private val netIds: MutableSet<String> = ConcurrentHashMap.newKeySet()

    /** 在途的 platform 请求 id：ActivityResult 不能取消，但结果回来时要能丢弃并清理临时文件。 */
    private val platformIds: MutableSet<String> = ConcurrentHashMap.newKeySet()

    /** netUpload 的 id → 本请求所有 tempId：abort(netUpload id) 时即使文件已被 take 走也要删。 */
    private val uploadTemps = ConcurrentHashMap<String, List<String>>()

    private val streamSlots = Slots(NetLimits.STREAM_CONCURRENCY)
    private val uploadSlots = Slots(NetLimits.UPLOAD_CONCURRENCY)

    private val readyLatch = CountDownLatch(1)
    private val refreshMutex = Mutex()
    private val refreshing = AtomicBoolean(false)

    private val cookieStore = CookieStore.getInstance(context)

    /** `system.capabilities` 的原始投影；ipc 没起来时为 null。 */
    @Volatile
    private var ipcCapabilities: JSONObject? = null

    @Volatile
    private var destroyed = false

    init {
        // 先拉一次投影，页面 ready() 才有服务器列表；事件订阅单独一条协程，避免投影耗时期间漏事件。
        scope.launch { refresh() }
        scope.launch {
            ipc.events.collect { (method, params) -> callbacks.event(method, params) }
        }
    }

    // ---- 启动上下文 ----

    /**
     * 同步返回启动 JSON。为了首帧就有正确的本机状态，最多等首次 ipc 投影 1.2s；
     * 超时返回上一次缓存。`selectedId` 每次都从 [ServerRegistry] 现读，
     * 所以切换服务器后重载页面立刻能反映新选择，不会读到旧快照。
     */
    @JavascriptInterface
    fun ready(): String {
        try {
            readyLatch.await(READY_WAIT_MILLIS, TimeUnit.MILLISECONDS)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        }
        val payload = serversPayload()
        val result = JSONObject()
            .put("version", AppInfo.versionName(context))
            .put("dataDir", File(context.filesDir, "data").absolutePath)
            .put("theme", currentTheme())
            // 渲染层 ShellLocale 只认 zh-CN/en-US；其它语言按英文回落，避免 parseReady 丢成默认值。
            .put("locale", if (Locale.getDefault().language == "zh") "zh-CN" else "en-US")
            .put("capabilities", capabilitiesJson())
            .put("servers", payload.getJSONArray("servers"))
            .put("selectedId", payload.get("selectedId"))
        return result.toString()
    }

    // ---- host：ipc 控制面 + shell 本地扩展 ----

    /**
     * `host(id, method, paramsJson)`。
     *
     * 普通方法原样转给 ipc，错误码也原样透传（未登录、冲突、权限不足等，桌面 `HostClient`
     * 的消费方认这一套）。`shell.` 前缀是壳自己的方法，见 [handleShell]。
     * 远程服务器没有管理面：选中远程时，管理类方法直接 `unsupported`，不落到本机 ipc。
     */
    @JavascriptInterface
    fun host(id: String, method: String, paramsJson: String) {
        if (destroyed) {
            callbacks.doneError(id, "network", "桥已关闭")
            return
        }
        if (method.isBlank()) {
            callbacks.doneError(id, "protocol", "method 不能为空")
            return
        }
        val params = parseObject(id, paramsJson) ?: return
        if (method.startsWith("shell.")) {
            handleShell(id, method, params)
            return
        }
        if (isRemoteSelected() && isLocalManagementMethod(method)) {
            callbacks.doneError(id, "unsupported", "远程服务器不提供管理能力")
            return
        }
        launchTracked(id) {
            try {
                val result = ipc.call(method, params)
                callbacks.doneResult(id, result)
                // 服务/登录状态可能变了，顺手刷新本机投影，下一次 ready()/servers.list 就是新状态。
                if (method.startsWith("service.") ||
                    method.startsWith("auth.") ||
                    method == "config.set"
                ) {
                    refreshAsync()
                }
            } catch (error: IpcError) {
                callbacks.doneError(id, error.code, error.message ?: "")
            } catch (_: CancellationException) {
                callbacks.abandon(id)
            }
        }
    }

    /**
     * 壳本地方法（§4.1 的兼容增量）：渲染层把 `host` 当同一个控制面，不关心某个方法是
     * 被代理到 ipc 还是壳自己答。
     */
    private fun handleShell(id: String, method: String, params: JSONObject) {
        when (method) {
            "shell.servers.list" -> callbacks.doneResult(id, serversPayload())

            "shell.servers.add" -> {
                try {
                    val server = registry.addRemote(
                        rawName = params.optString("name", "").ifEmpty { null },
                        rawBaseUrl = params.optString("baseUrl", ""),
                    )
                    callbacks.doneResult(id, JSONObject().put("server", remoteServerJson(server)))
                } catch (error: IllegalArgumentException) {
                    callbacks.doneError(id, "protocol", error.message ?: "地址不合法")
                }
            }

            "shell.servers.remove" -> {
                val target = params.optString("id", "").trim()
                try {
                    if (target == ServerRegistry.LOCAL_ID) {
                        throw IllegalArgumentException("本机服务器不能删除")
                    }
                    registry.removeRemote(target)
                    // 删服务器同时清 Cookie，避免登录态留在磁盘上。
                    cookieStore.clear(target)
                    if (registry.selectedId() == null) {
                        abortNetworkOperations()
                    }
                    callbacks.doneResult(id, JSONObject().put("ok", true))
                } catch (error: IllegalArgumentException) {
                    callbacks.doneError(id, "protocol", error.message ?: "服务器不存在")
                }
            }

            "shell.servers.select" -> {
                val target = params.optString("id", "").trim()
                try {
                    registry.select(target)
                    // 只持久化选择 + 取消在途流/上传；页面重载由渲染层做（内存态会串服务器）。
                    abortNetworkOperations()
                    callbacks.doneResult(id, JSONObject().put("ok", true).put("selectedId", target))
                } catch (error: IllegalArgumentException) {
                    callbacks.doneError(id, "protocol", error.message ?: "服务器不存在")
                }
            }

            "shell.servers.probe" -> {
                val baseUrl = params.optString("baseUrl", "").trim()
                launchTracked(id) {
                    try {
                        callbacks.doneResult(id, net.probe(baseUrl))
                    } catch (error: NetError) {
                        callbacks.doneError(id, error.code, error.message ?: "", error.status)
                    } catch (_: CancellationException) {
                        callbacks.abandon(id)
                    }
                }
            }

            else -> callbacks.doneError(id, "unsupported", "未知的壳方法: $method")
        }
    }

    // ---- net：数据面 ----

    @JavascriptInterface
    fun netRequest(id: String, specJson: String) {
        val spec = parseSpec(id, specJson, defaultMethod = "GET") ?: return
        launchTracked(id, isNetwork = true) {
            try {
                val response = net.request(id, spec)
                callbacks.doneResult(
                    id = id,
                    result = resultJson(response, withBody = true),
                    status = response.status,
                    statusText = response.statusText,
                    headers = response.headers,
                )
            } catch (_: NetAborted) {
                callbacks.abandon(id)
            } catch (error: NetError) {
                doneNetError(id, error)
            } catch (_: CancellationException) {
                callbacks.abandon(id)
            } catch (error: Exception) {
                callbacks.doneError(id, "protocol", error.javaClass.simpleName)
            }
        }
    }

    @JavascriptInterface
    fun netStream(id: String, specJson: String) {
        val spec = parseSpec(id, specJson, defaultMethod = "GET") ?: return
        // 槽位在协程内部申请：这样 abort 发生在协程启动前时没有资源需要回收。
        launchTracked(id, isNetwork = true) {
            if (!streamSlots.tryAcquire()) {
                callbacks.doneError(id, "busy", "同时在途的流已达上限")
                return@launchTracked
            }
            try {
                val response = net.stream(id, spec) { base64 -> callbacks.chunk(id, base64) }
                callbacks.doneResult(
                    id = id,
                    result = resultJson(response, withBody = false),
                    status = response.status,
                    statusText = response.statusText,
                    headers = response.headers,
                )
            } catch (_: NetAborted) {
                callbacks.abandon(id)
            } catch (error: NetError) {
                doneNetError(id, error)
            } catch (_: CancellationException) {
                callbacks.abandon(id)
            } catch (error: Exception) {
                callbacks.doneError(id, "protocol", error.javaClass.simpleName)
            } finally {
                streamSlots.release()
            }
        }
    }

    @JavascriptInterface
    fun netDownload(id: String, specJson: String) {
        val spec = parseSpec(id, specJson, defaultMethod = "GET") ?: return
        launchTracked(id, isNetwork = true) {
            try {
                val response = net.download(id, spec) { base64 -> callbacks.chunk(id, base64) }
                callbacks.doneResult(
                    id = id,
                    result = resultJson(response, withBody = false),
                    status = response.status,
                    statusText = response.statusText,
                    headers = response.headers,
                )
            } catch (_: NetAborted) {
                callbacks.abandon(id)
            } catch (error: NetError) {
                doneNetError(id, error)
            } catch (_: CancellationException) {
                callbacks.abandon(id)
            } catch (error: Exception) {
                callbacks.doneError(id, "protocol", error.javaClass.simpleName)
            }
        }
    }

    @JavascriptInterface
    fun netUpload(id: String, specJson: String) {
        val spec = parseSpec(id, specJson, defaultMethod = "POST") ?: return
        val tempIds = spec.files.map { it.tempId }
        // 记录请求 id → tempId：abort(id) 时即使文件已被 take 走也要能删掉。
        uploadTemps[id] = tempIds
        val job = launchTracked(id, isNetwork = true) {
            if (!uploadSlots.tryAcquire()) {
                // 槽位没拿到，文件还在暂存区：保留给渲染层重试，只清登记。
                uploadTemps.remove(id)
                callbacks.doneError(id, "busy", "已有上传在途")
                return@launchTracked
            }
            val temps = LinkedHashMap<String, UploadStore.TempFile>()
            try {
                for (tempId in tempIds) {
                    // 同一个 tempId 被多处引用时只 take 一次（take 会从 store 移除）。
                    if (!temps.containsKey(tempId)) {
                        temps[tempId] = uploads.take(tempId)
                    }
                }
            } catch (error: NetError) {
                temps.values.forEach { temp -> temp.file.delete() }
                uploadSlots.release()
                uploadTemps.remove(id)
                doneNetError(id, error)
                return@launchTracked
            }
            try {
                val response = net.upload(id, spec, temps)
                callbacks.doneResult(
                    id = id,
                    result = resultJson(response, withBody = true),
                    status = response.status,
                    statusText = response.statusText,
                    headers = response.headers,
                )
            } catch (_: NetAborted) {
                callbacks.abandon(id)
            } catch (error: NetError) {
                doneNetError(id, error)
            } catch (_: CancellationException) {
                callbacks.abandon(id)
            } catch (error: Exception) {
                callbacks.doneError(id, "protocol", error.javaClass.simpleName)
            } finally {
                // 结束/失败/取消都删：临时文件不能跨请求存活。
                temps.values.forEach { temp -> temp.file.delete() }
                uploadTemps.remove(id)
                uploadSlots.release()
            }
        }
        if (job == null) {
            // 协程没启动（id 已被 abort）：take 还没发生，把暂存文件和登记一起清掉。
            uploadTemps.remove(id)
            tempIds.forEach { tempId -> uploads.discard(tempId) }
        }
    }

    private fun resultJson(response: NetResponse, withBody: Boolean): JSONObject {
        val result = JSONObject()
            .put("status", response.status)
            .put("statusText", response.statusText)
            .put("headers", response.headers)
        if (withBody) {
            val body = response.body ?: ByteArray(0)
            // 渲染层的 NetResponse 字段名是 body（base64），不是 bodyBase64。
            result.put("body", Base64.encodeToString(body, Base64.NO_WRAP))
        }
        return result
    }

    /** http 错误必须带 status/statusText/headers；network/tls 没有状态，就不往信封里塞。 */
    private fun doneNetError(id: String, error: NetError) {
        callbacks.doneError(
            id = id,
            code = error.code,
            message = error.message ?: "",
            status = error.status,
            statusText = error.statusText,
            headers = error.headers,
            body = error.bodyBase64,
            cause = if (error.code == "network" || error.code == "tls") error.message else null,
        )
    }

    // ---- 附件分块 ----

    /**
     * `fileBegin(id, metaJson)`：**同步**建临时文件，`id` 原样作为 tempId。
     * 渲染层不等待 done，紧接着就 fileChunk；放到协程里会丢首批分片。
     */
    @JavascriptInterface
    fun fileBegin(id: String, metaJson: String) {
        val meta = parseObject(id, metaJson) ?: return
        try {
            val temp = uploads.begin(id, meta)
            callbacks.doneResult(
                id,
                JSONObject()
                    .put("tempId", temp.id)
                    .put("name", temp.name)
                    .put("size", meta.optLong("size", -1L))
                    .put("mime", temp.mime),
            )
        } catch (error: NetError) {
            callbacks.doneError(id, error.code, error.message ?: "")
        }
    }

    /** 同步写盘：契约要求这里不攒缓冲，一次 ≤256 KiB。 */
    @JavascriptInterface
    fun fileChunk(tempId: String, base64: String) {
        // base64 长度先粗判，避免为了一个超限分片先解出几十 MiB 的字节数组。
        val maxEncoded = ((NetLimits.MAX_FILE_CHUNK_BYTES + 2) / 3) * 4
        if (base64.length > maxEncoded) {
            Log.w(TAG, "fileChunk 超过 256 KiB，丢弃临时文件")
            uploads.discard(tempId)
            return
        }
        val bytes = try {
            Base64.decode(base64, Base64.DEFAULT)
        } catch (_: IllegalArgumentException) {
            Log.w(TAG, "fileChunk 不是合法 base64，丢弃临时文件")
            uploads.discard(tempId)
            return
        }
        if (bytes.size > NetLimits.MAX_FILE_CHUNK_BYTES) {
            Log.w(TAG, "fileChunk 解码后超过 256 KiB，丢弃临时文件")
            uploads.discard(tempId)
            return
        }
        uploads.append(tempId, bytes)
    }

    /** 同步收尾。fileEnd 没有回调 id，失败原因留给 netUpload 以 `protocol` 报出。 */
    @JavascriptInterface
    fun fileEnd(tempId: String) {
        uploads.finish(tempId)
    }

    // ---- platform ----

    @JavascriptInterface
    fun platform(id: String, method: String, paramsJson: String) {
        val params = parseObject(id, paramsJson) ?: return
        if (!platformIds.add(id)) {
            callbacks.doneError(id, "protocol", "重复的 platform id")
            return
        }
        val settled = AtomicBoolean(false)
        platformHost.handle(method, params) { result ->
            if (!settled.compareAndSet(false, true)) {
                return@handle
            }
            platformIds.remove(id)
            if (callbacks.isFinished(id)) {
                // 页面已经重载/abort：pickFiles 可能刚刚落完临时文件，这里替旧页面清掉。
                result.getOrNull()?.let { discardPickedTemps(it) }
                return@handle
            }
            result.fold(
                onSuccess = { callbacks.doneResult(id, it) },
                onFailure = { error ->
                    when (error) {
                        is PlatformError -> callbacks.doneError(id, error.code, error.message ?: "")
                        else -> callbacks.doneError(id, "protocol", error.javaClass.simpleName)
                    }
                },
            )
        }
    }

    // ---- abort / 生命周期 ----

    @JavascriptInterface
    fun abort(id: String) {
        callbacks.abandon(id)
        val isNetwork = netIds.remove(id)
        jobs.remove(id)?.cancel()
        if (isNetwork) {
            // 只有数据面请求才进 NetClient 的取消表；host 的 id 不能污染它。
            net.abort(id)
        }
        uploadTemps.remove(id)?.forEach { tempId -> uploads.discard(tempId) }
        // 渲染层也会直接把 tempId 当 abort 的 id 传进来（分块失败/取消后的清理）。
        uploads.discard(id)
    }

    /** 页面开始加载：旧页面的 id 全部作废，在途网络与临时文件都清掉。 */
    fun onPageStarted() {
        if (destroyed) {
            return
        }
        abortAllOperations()
    }

    /** 供 Activity onResume / 事件回调触发一次重投影；内部串行，重复调用不会打爆 ipc。 */
    fun refreshAsync() {
        if (destroyed) {
            return
        }
        if (!refreshing.compareAndSet(false, true)) {
            return
        }
        scope.launch {
            try {
                refresh()
            } finally {
                refreshing.set(false)
            }
        }
    }

    fun destroy() {
        if (destroyed) {
            return
        }
        destroyed = true
        abortAllOperations()
        callbacks.close()
        platformHost.close()
        scope.cancel()
    }

    private suspend fun refresh() {
        refreshMutex.withLock {
            try {
                val status = ipc.call("system.status")
                val whoami = ipc.call("auth.whoami")
                val service = status.optJSONObject("service")
                val listen = service?.optString("listen", "")?.trim()?.ifEmpty { null }
                // 先落本机状态再拉 capabilities：后一步失败不该让端口/mode 停在旧值。
                registry.updateLocalState(
                    listen = listen,
                    initialized = whoami.optBoolean("initialized", false),
                    running = service?.optString("state") == "running",
                )
                ipcCapabilities = ipc.call("system.capabilities")
            } catch (error: IpcError) {
                // §7：进程被杀后 UI 画最后一次已知 + 加载态，不把旧状态当权威，也不清空列表。
                Log.w(TAG, "拉取 ipc 投影失败: ${error.code}: ${error.message}")
            } finally {
                readyLatch.countDown()
            }
        }
    }

    private fun abortAllOperations() {
        for (id in jobs.keys.toList()) {
            abort(id)
        }
        for (id in platformIds.toList()) {
            platformIds.remove(id)
            callbacks.abandon(id)
        }
        net.abortAll()
        uploadTemps.values.forEach { tempIds -> tempIds.forEach { uploads.discard(it) } }
        uploadTemps.clear()
        // uploads.take 已经取走的文件由对应 netUpload 的 finally 删除；这里清的是还没取走的。
        uploads.discardAll()
    }

    /** 切服务器只取消数据面请求；host 的 ipc 调用与平台选择器不跟着断。 */
    private fun abortNetworkOperations() {
        net.abortAll()
        for (id in netIds.toList()) {
            callbacks.abandon(id)
            jobs.remove(id)?.cancel()
        }
    }

    // ---- 内部工具 ----

    private fun launchTracked(id: String, isNetwork: Boolean = false, block: suspend () -> Unit): Job? {
        if (callbacks.isFinished(id)) {
            return null
        }
        // LAZY + 先登记再 start：避免请求太快，finally 在 jobs.put 之前就把登记删了，留下脏条目。
        val job = scope.launch(start = CoroutineStart.LAZY) {
            try {
                if (callbacks.isFinished(id)) {
                    // 在 jobs 登记之前就被 abort：不再发请求，finally 仍会清槽位。
                    return@launch
                }
                block()
            } catch (_: CancellationException) {
                callbacks.abandon(id)
            } catch (error: Exception) {
                // 兜底：具体操作自己会映射错误码，走到这里说明是没预料到的编程错误，
                // 也不能让异常逃出协程把 done 吞掉。
                Log.w(TAG, "桥任务异常（id=$id）: ${error.javaClass.simpleName}")
                callbacks.doneError(id, "protocol", error.javaClass.simpleName)
            } finally {
                jobs.remove(id)
                if (isNetwork) {
                    netIds.remove(id)
                    // 清掉 NetClient 的 abort 标记/在途 Call：否则「abort 发生在请求启动前」时
                    // id 会永久留在取消表里。
                    net.forget(id)
                }
            }
        }
        jobs[id] = job
        if (isNetwork) {
            netIds.add(id)
        }
        job.start()
        return job
    }

    private fun parseObject(id: String, raw: String): JSONObject? {
        if (raw.isBlank()) {
            return JSONObject()
        }
        return try {
            JSONObject(raw)
        } catch (_: JSONException) {
            callbacks.doneError(id, "protocol", "参数不是合法 JSON")
            null
        }
    }

    private fun parseSpec(id: String, raw: String, defaultMethod: String): NetSpec? {
        val objectValue = parseObject(id, raw) ?: return null
        return try {
            NetSpec.parse(objectValue, defaultMethod)
        } catch (error: NetError) {
            callbacks.doneError(id, error.code, error.message ?: "")
            null
        }
    }

    private fun serversPayload(): JSONObject {
        val servers = JSONArray()
        servers.put(localServerJson())
        for (remote in registry.remotes()) {
            servers.put(remoteServerJson(remote))
        }
        return JSONObject()
            .put("servers", servers)
            .put("selectedId", registry.selectedId() ?: JSONObject.NULL)
    }

    private fun localServerJson(): JSONObject {
        return JSONObject()
            .put("id", ServerRegistry.LOCAL_ID)
            .put("kind", "local")
            .put("name", localName())
            .put("mode", registry.localMode())
            // 端口来自 ipc 的 service.status.listen；还没投影回来时给空串，客户端会用 mode 判断不可用。
            .put("baseUrl", registry.localBaseUrl() ?: "")
    }

    private fun remoteServerJson(server: ServerRegistry.RemoteServer): JSONObject {
        return JSONObject()
            .put("id", server.id)
            .put("kind", "remote")
            .put("name", server.name)
            // 远程没有本机服务状态；mode 固定 installed 表示「已配置」，连通性由数据面请求表达。
            .put("mode", "installed")
            .put("baseUrl", server.baseUrl)
    }

    private fun capabilitiesJson(): JSONObject {
        // ipc 不可用时也返回同形状对象，渲染层不用先判 null；available=false 表示控制面暂不可用。
        val raw = ipcCapabilities
        val ipcJson = JSONObject()
            .put("available", raw != null)
            .put("version", raw?.optInt("ipcVersion", 1) ?: 0)
            .put("methods", raw?.optJSONArray("methods") ?: JSONArray())
        val platformMethods = JSONArray()
        for (method in platformHost.supportedMethods) {
            platformMethods.put(method)
        }
        val limits = JSONObject()
            .put("streamConcurrency", NetLimits.STREAM_CONCURRENCY)
            .put("uploadConcurrency", NetLimits.UPLOAD_CONCURRENCY)
            .put("maxUploadBytes", NetLimits.MAX_UPLOAD_BYTES)
            .put("maxDownloadBytes", NetLimits.MAX_DOWNLOAD_BYTES)
            .put("maxStreamChunkBytes", NetLimits.MAX_STREAM_CHUNK_BYTES)
            .put("maxFileChunkBytes", NetLimits.MAX_FILE_CHUNK_BYTES)
        return JSONObject()
            .put("ipc", ipcJson)
            .put("platform", platformMethods)
            .put("limits", limits)
            // 兼容渲染层现有 ShellCapabilities 读取（顶层 methods/ipcVersion/features）；
            // 文档把形状定在 ipc/platform/limits 上，这两份字段是等价的镜像。
            .put("methods", ipcJson.optJSONArray("methods") ?: JSONArray())
            .put("ipcVersion", raw?.optInt("ipcVersion", 1) ?: 0)
            .put("features", raw?.optJSONObject("features") ?: JSONObject())
    }

    private fun currentTheme(): String {
        val nightMode = context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
        return if (nightMode == Configuration.UI_MODE_NIGHT_YES) "dark" else "light"
    }

    private fun localName(): String {
        return if (Locale.getDefault().language == "zh") "本机" else "Local"
    }

    private fun isRemoteSelected(): Boolean {
        val selected = registry.selectedId() ?: return false
        return selected != ServerRegistry.LOCAL_ID
    }

    private fun isLocalManagementMethod(method: String): Boolean {
        return method.startsWith("service.") ||
            method.startsWith("backup.") ||
            method.startsWith("account.") ||
            method.startsWith("auth.") ||
            method.startsWith("config.")
    }

    /** 旧页面 pickFiles 的结果里如果带临时文件，页面已经不要了，直接删。 */
    private fun discardPickedTemps(result: JSONObject) {
        val files = result.optJSONArray("files") ?: return
        for (index in 0 until files.length()) {
            val tempId = files.optJSONObject(index)?.optString("tempId", "") ?: continue
            if (tempId.isNotEmpty()) {
                uploads.discard(tempId)
            }
        }
    }

    /** 简单的并发闸门：`tryAcquire` 不排队，超限立刻返回 busy（排队会让“停止生成”变慢）。 */
    private class Slots(private val max: Int) {
        private val used = java.util.concurrent.atomic.AtomicInteger(0)

        fun tryAcquire(): Boolean {
            while (true) {
                val current = used.get()
                if (current >= max) {
                    return false
                }
                if (used.compareAndSet(current, current + 1)) {
                    return true
                }
            }
        }

        fun release() {
            used.decrementAndGet()
        }
    }
}
