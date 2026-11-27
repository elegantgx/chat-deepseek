package dev.chatdeepseek.android.ipc

import android.content.Context
import android.util.Log
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONException
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

private const val TAG = "IpcClient"

/** 一次故障连锁里最多自动重启 3 次；连续失败就停手，避免崩溃循环把电量和日志打满。 */
private const val MAX_RESTARTS = 3

/** 指数退避基数：300ms、600ms、1200ms。 */
private const val RESTART_BASE_DELAY_MS = 300L

/**
 * NDJSON 控制面客户端，形状对齐桌面 `HostClient`：
 * `call(method, params)` 挂起拿结果，`events` 收 `event.*` 通知。
 *
 * 线程模型：
 * - 写：唯一 writer，[IpcProcess.writeLine] 用 Mutex 保证整行一次写出；
 * - 读：每个子进程一个 reader 线程，按 `id` 唤醒挂起的 [CompletableDeferred]；
 * - 调用：`call` 是 suspend，绝不阻塞 UI 线程；桥层在自己的 IO scope 里调它。
 *
 * 重启策略：进程意外退出 → 所有在途请求以 `network` 失败 → 后台按指数退避最多重启 3 次。
 * **不自动重放**在途请求：ipc 的登录态归属进程，重放会把「进程重启」伪装成「请求成功」，
 * 让上层拿着一个实际没执行的结果继续写。重启后的新请求自然会重新拉状态。
 */
class IpcClient private constructor(context: Context) {

    companion object {
        @Volatile
        private var instance: IpcClient? = null

        /**
         * Application 级单例：ipc 登录态、事件订阅、重启计数都属于整个应用进程，
         * 不能跟着 Activity/WebView 重建，否则每次旋转屏幕都会换一个控制面会话。
         */
        fun getInstance(context: Context): IpcClient {
            val existing = instance
            if (existing != null && !existing.destroyed) {
                return existing
            }
            return synchronized(this) {
                val current = instance
                if (current != null && !current.destroyed) {
                    current
                } else {
                    IpcClient(context.applicationContext).also { instance = it }
                }
            }
        }
    }

    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** 第一轮启动完成（无论成功失败）后放行调用，避免页面刚起来时必然报一次「进程不可用」。 */
    private val firstStart = CompletableDeferred<Unit>()
    private val startGuard = Mutex()

    @Volatile
    private var process: IpcProcess? = null

    @Volatile
    private var generation = 0

    @Volatile
    private var destroyed = false

    /** 连续重启次数；任意一次成功响应后清零，这样偶发崩溃不会累计到上限。 */
    @Volatile
    private var restartAttempts = 0

    private val pending = ConcurrentHashMap<Int, CompletableDeferred<JSONObject>>()
    private val nextId = AtomicInteger(0)

    /**
     * 写方法串行锁：`docs/ipc.md` §2 要求客户端「等一个写请求的响应再发下一个」。
     * 分组与 Go 侧的串行化一致：service 共用信号量、backup 共用互斥锁、auth/account 共用互斥锁、
     * config.set 单独串行。分组而不是全局一把锁，是为了不让一次慢备份把登录也堵住。
     */
    private val serviceLock = Mutex()
    private val backupLock = Mutex()
    private val accountLock = Mutex()
    private val configLock = Mutex()

    private val eventsFlow = MutableSharedFlow<Pair<String, JSONObject>>(
        replay = 0,
        // 服务日志是高频事件；WebView 重建或暂时没人订阅时宁可丢旧行，也不能让 reader 线程阻塞。
        extraBufferCapacity = 256,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )

    /** `(method, params)`：目前只有 `event.service.log`，但按 `method` 分发，新增事件不用改客户端。 */
    val events: SharedFlow<Pair<String, JSONObject>> = eventsFlow.asSharedFlow()

    init {
        scope.launch {
            // spawn 里虽然已经兜了 IOException/SecurityException，但这里的任何意外都不能让
            // firstStart 永远不完成——所有 call() 都在等它。
            val started = try {
                spawn()
            } catch (error: Exception) {
                Log.e(TAG, "启动 ipc 时发生意外错误: ${error.javaClass.simpleName}", error)
                false
            }
            // 先放行等待者再决定要不要重启：首启失败时调用方应立刻拿到 network 错误，
            // 而不是一起等退避结束。
            firstStart.complete(Unit)
            if (!started) {
                scheduleRestart()
            }
        }
    }

    /**
     * 调用一个 ipc 方法。成功返回 `result` 对象；失败抛 [IpcError]，`code` 为
     * `docs/ipc.md` §3 的字符串，进程不可用时为 `network`。
     *
     * 取消协程只会让本次调用不再等待结果（abort 语义），不会撤销已经写进管道的请求——
     * 对 ipc 来说「不发结果」就是契约允许的全部。
     */
    suspend fun call(method: String, params: JSONObject? = null): JSONObject {
        firstStart.await()
        if (destroyed) {
            throw IpcError("network", "ipc 客户端已关闭")
        }
        val active = currentProcess()
        val id = nextId.incrementAndGet()
        val slot = CompletableDeferred<JSONObject>()
        pending[id] = slot

        val envelope = JSONObject()
            .put("jsonrpc", "2.0")
            .put("id", id)
            .put("method", method)
        if (params != null) {
            envelope.put("params", params)
        }
        val payload = envelope.toString()

        try {
            val lock = writeLockFor(method)
            return if (lock == null) {
                roundTrip(active, id, payload, slot)
            } else {
                lock.withLock { roundTrip(active, id, payload, slot) }
            }
        } finally {
            pending.remove(id)
        }
    }

    /**
     * 进程退出时调用：关 stdin → 等 2s → destroy。设计成非 suspend 且快速返回，
     * 因为 Android 的 `Application.onTerminate`/`onDestroy` 都不适合等 I/O；
     * 真正的等待放在独立线程里，不占调用方（尤其是主线程）。
     */
    fun destroy() {
        if (destroyed) {
            return
        }
        destroyed = true
        val closing = process
        process = null
        // 若 init 的首次启动还没结束，让等待者醒来走 destroyed 分支，避免永久挂起。
        if (!firstStart.isCompleted) {
            firstStart.complete(Unit)
        }
        failPending("ipc 客户端已关闭")
        scope.cancel()
        // destroy 之后允许 getInstance 重建：Activity 结束但进程还在时，下次进入不能拿到一个
        // 已经关闭的旧单例（那会让本机控制面永久不可用）。
        synchronized(Companion) {
            if (instance === this) {
                instance = null
            }
        }
        if (closing != null) {
            thread(name = "chatd-destroy", isDaemon = true) { closing.destroyBlocking() }
        }
    }

    private suspend fun currentProcess(): IpcProcess {
        val active = process
        if (active == null || !active.isRunning) {
            // 这里不等待后台重启：桥层的 ready()/host() 宁可立刻返回可重试的 network，
            // 也不要把 WebView 的桥线程挂在退避上。
            throw IpcError("network", "ipc 进程不可用")
        }
        return active
    }

    private suspend fun roundTrip(
        active: IpcProcess,
        id: Int,
        payload: String,
        slot: CompletableDeferred<JSONObject>,
    ): JSONObject {
        if (!active.writeLine(payload)) {
            // 写失败通常意味着子进程已经退出；reader 的 EOF 也会清 pending，这里主动摘掉，
            // 免得在 exit 回调之前留下一个永远不会完成的槽位。
            pending.remove(id)
            throw IpcError("network", "ipc 进程不可用")
        }
        return slot.await()
    }

    private suspend fun spawn(): Boolean = startGuard.withLock {
        if (destroyed) {
            return@withLock false
        }
        val existing = process
        if (existing != null && existing.isRunning) {
            return@withLock true
        }
        val nextGeneration = generation + 1
        generation = nextGeneration
        val candidate = IpcProcess(appContext, nextGeneration, ::handleLine, ::handleExit)
        // 先登记再 start：start 之后进程可能立刻退出并触发 handleExit，回调里要能认出新的一代。
        process = candidate
        val started = candidate.start()
        if (!started) {
            process = null
            Log.w(TAG, "ipc 进程启动失败（generation=$nextGeneration）")
        } else {
            Log.i(TAG, "ipc 进程已启动（generation=$nextGeneration）")
        }
        started
    }

    /** reader 线程 / wait 线程回调；只做 map 操作与 flow 投递，不阻塞。 */
    private fun handleLine(line: String) {
        val message = try {
            JSONObject(line)
        } catch (_: JSONException) {
            // 协议行坏了只可能是版本漂移或内存损坏；丢弃并留一行诊断，不影响后续行。
            Log.w(TAG, "忽略无法解析的协议行: ${line.take(160)}")
            return
        }

        val method = message.optString("method", "")
        if (message.has("id") && !message.isNull("id")) {
            val id = message.optInt("id", Int.MIN_VALUE)
            val slot = pending.remove(id)
            if (id == Int.MIN_VALUE || slot == null) {
                // 被 abort 的请求仍会回来；没有等待者就是正常情况，不当作错误。
                return
            }
            val error = message.optJSONObject("error")
            if (error != null) {
                slot.completeExceptionally(
                    IpcError(
                        code = error.optString("code", "internal"),
                        message = error.optString("message", ""),
                    )
                )
            } else {
                restartAttempts = 0
                slot.complete(message.optJSONObject("result") ?: JSONObject())
            }
            return
        }

        if (method.startsWith("event.")) {
            val params = message.optJSONObject("params") ?: JSONObject()
            if (!eventsFlow.tryEmit(method to params)) {
                Log.w(TAG, "事件缓冲已满，丢弃 $method")
            }
            return
        }

        Log.w(TAG, "忽略未知协议行: ${line.take(160)}")
    }

    private fun handleExit(exitedGeneration: Int) {
        if (exitedGeneration != generation) {
            // 旧一代的退出通知晚到了：新一代已经接管，不能清掉它的 process。
            return
        }
        process = null
        failPending("ipc 进程已退出")
        if (destroyed) {
            return
        }
        Log.w(TAG, "ipc 进程意外退出")
        scheduleRestart()
    }

    @Synchronized
    private fun scheduleRestart() {
        if (destroyed) {
            return
        }
        val attempt = restartAttempts
        if (attempt >= MAX_RESTARTS) {
            Log.w(TAG, "ipc 进程连续退出 $MAX_RESTARTS 次，不再自动重启")
            return
        }
        restartAttempts = attempt + 1
        val delayMs = RESTART_BASE_DELAY_MS shl attempt
        Log.i(TAG, "将在 ${delayMs}ms 后自动重启 ipc（第 ${attempt + 1}/$MAX_RESTARTS 次）")
        scope.launch {
            delay(delayMs)
            if (destroyed) {
                return@launch
            }
            val restarted = try {
                spawn()
            } catch (error: Exception) {
                Log.e(TAG, "重启 ipc 时发生意外错误: ${error.javaClass.simpleName}", error)
                false
            }
            if (!restarted) {
                scheduleRestart()
            }
        }
    }

    private fun failPending(reason: String) {
        if (pending.isEmpty()) {
            return
        }
        // 先快照再逐个 remove(key, value)，避免和正在注册的新请求互相覆盖。
        for ((id, slot) in pending.entries.toList()) {
            if (pending.remove(id, slot)) {
                slot.completeExceptionally(IpcError("network", reason))
            }
        }
    }

    private fun writeLockFor(method: String): Mutex? = when {
        method.startsWith("service.") -> serviceLock
        method.startsWith("backup.") -> backupLock
        method.startsWith("auth.") || method.startsWith("account.") -> accountLock
        method == "config.set" -> configLock
        else -> null
    }
}
