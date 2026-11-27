package dev.chatdeepseek.android.ipc

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.nio.charset.StandardCharsets
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** `docs/ipc.md` §2：单行上限 1 MiB（含换行）。超过就整行丢弃，不能让内存跟着坏行涨。 */
internal const val IPC_MAX_LINE_BYTES = 1024 * 1024

private const val TAG = "IpcProcess"

/** stderr 的 logcat tag。用 `adb logcat -s chatd` 就能看到 Go 侧日志，和协议流分开。 */
private const val STDERR_TAG = "chatd"

/** logcat 单条消息约 4 KB，留出 tag 余量后按 3500 字符切段，避免尾部被截断。 */
private const val LOGCAT_CHUNK_CHARS = 3500

/**
 * 一个 `chat-deepseek ipc` 子进程的 stdio 封装。
 *
 * 只做 transport：起进程、逐行读 stdout、把 stderr 写 logcat、加锁写一行、关闭。
 * 请求匹配、重试与事件分发在 [IpcClient]，这样重启时换一个 [IpcProcess] 实例即可，
 * 不会出现「同一个对象里新旧两代进程抢管道」的状态。
 *
 * 参数与桌面/Go 侧一致：`ipc --data-dir <filesDir>/data`，数据目录显式传，
 * 不依赖二进制同级的 `data/`（APK 里 nativeLibraryDir 不可写）。
 * Go 侧 `configureLocalProcess` 的 Pdeathsig 管的是它拉起的 serve；
 * 这里的 ipc 由应用进程持有，应用被杀时 Android 会回收整个进程组，不需要额外信号。
 */
internal class IpcProcess(
    context: Context,
    private val generation: Int,
    private val onLine: (String) -> Unit,
    private val onExit: (Int) -> Unit,
) {

    private val appContext = context.applicationContext
    private val binary = File(appContext.applicationInfo.nativeLibraryDir, "libchatd.so")
    private val dataDir = File(appContext.filesDir, "data")

    /** 单 writer：一份 stdio 管道只有一行写完并 flush 之后才能写下一行，否则会出现半行交错。 */
    private val writeMutex = Mutex()

    @Volatile
    private var process: Process? = null

    @Volatile
    private var running = false

    val isRunning: Boolean
        get() = running

    /**
     * 启动子进程。返回 false 表示可执行文件缺失或 `ProcessBuilder.start` 失败，
     * 由 [IpcClient] 决定是否退避重试。这里不抛异常：启动失败也是「控制面不可用」的
     * 一种正常状态，上层要能继续显示服务器列表与停止状态。
     */
    fun start(): Boolean {
        if (running) {
            return true
        }
        // 数据目录必须由壳先建好：Go 侧的默认目录在 APK 里不可写，显式传入后它也不会再猜。
        if (!dataDir.isDirectory && !dataDir.mkdirs()) {
            Log.e(TAG, "无法创建数据目录: ${dataDir.absolutePath}")
            return false
        }
        if (!binary.isFile) {
            Log.e(TAG, "找不到 ipc 可执行文件: ${binary.absolutePath}")
            return false
        }

        val started = try {
            ProcessBuilder(binary.absolutePath, "ipc", "--data-dir", dataDir.absolutePath)
                // 工作目录固定到私有目录，避免子进程相对路径落到 APK 的只读目录上。
                .directory(appContext.filesDir)
                .redirectErrorStream(false)
                .start()
        } catch (error: IOException) {
            Log.e(TAG, "启动 ipc 进程失败: ${error.javaClass.simpleName}: ${error.message}")
            return false
        } catch (error: SecurityException) {
            Log.e(TAG, "没有权限执行 ipc 进程: ${error.message}")
            return false
        }

        process = started
        running = true
        // 三条线程各管一件事：stdout 协议、stderr 日志、进程退出。绝不能只 waitFor 不读管道，
        // 否则子进程的日志一多就会堵死在 write 上，整个控制面看起来像卡死。
        val stdoutReader = thread(name = "chatd-stdout-$generation", isDaemon = true) {
            readStdout(started.inputStream)
        }
        thread(name = "chatd-stderr-$generation", isDaemon = true) { readStderr(started.errorStream) }
        thread(name = "chatd-wait-$generation", isDaemon = true) {
            val exitCode = try {
                started.waitFor()
            } catch (error: InterruptedException) {
                Thread.currentThread().interrupt()
                -1
            }
            // 进程退出时管道里可能还有最后一行响应（尤其是正常收尾）。先等 reader 把 EOF 读完，
            // 否则会把一个已经成功返回的请求误判成 network 失败。
            try {
                stdoutReader.join(2000)
            } catch (error: InterruptedException) {
                Thread.currentThread().interrupt()
            }
            running = false
            process = null
            Log.i(TAG, "ipc 进程已退出，exitCode=$exitCode（generation=$generation）")
            onExit(generation)
        }
        return true
    }

    /**
     * 写一行请求并 flush。返回 false 表示管道已不可写（进程退出或流被关闭），
     * 调用方应立刻按「进程不可用」失败，不要等一个永远不会到的响应。
     */
    suspend fun writeLine(line: String): Boolean = withContext(Dispatchers.IO) {
        writeMutex.withLock {
            val current = process
            if (current == null || !running) {
                return@withLock false
            }
            val bytes = line.toByteArray(StandardCharsets.UTF_8)
            if (bytes.size + 1 > IPC_MAX_LINE_BYTES) {
                Log.e(TAG, "拒绝发送超长请求行: ${bytes.size} 字节")
                return@withLock false
            }
            try {
                val output = current.outputStream
                output.write(bytes)
                output.write('\n'.code)
                // Go 侧按行读，不 flush 就会一直等到缓冲区满，表现为「请求发出去了但没响应」。
                output.flush()
                true
            } catch (error: IOException) {
                Log.w(TAG, "写 ipc 管道失败: ${error.javaClass.simpleName}")
                false
            }
        }
    }

    /**
     * 关 stdin → 等 2 秒 → destroy，仍不退再 destroyForcibly。
     *
     * 先关 stdin 是因为 ipc 把 EOF 当正常关闭：它会处理完在途请求再以 0 退出，
     * 比直接 SIGTERM 更不容易丢掉最后一次写操作。等待线程已经会 reap，这里只负责兜底。
     */
    fun destroyBlocking() {
        val current = process ?: return
        process = null
        running = false
        try {
            current.outputStream.close()
        } catch (_: IOException) {
            // 进程可能已经先退出了，关不上不是错误。
        }
        try {
            if (!current.waitFor(2, TimeUnit.SECONDS)) {
                current.destroy()
                if (!current.waitFor(2, TimeUnit.SECONDS)) {
                    current.destroyForcibly()
                }
            }
        } catch (error: InterruptedException) {
            Thread.currentThread().interrupt()
            current.destroyForcibly()
        } catch (error: Exception) {
            // waitFor 在极端情况下（进程已被回收）会抛 IllegalThreadStateException，同样只需兜底。
            Log.w(TAG, "结束 ipc 进程时出错: ${error.javaClass.simpleName}")
            current.destroyForcibly()
        }
    }

    /**
     * 逐字节扫行：`BufferedReader.readLine()` 没有长度上限，一行坏数据就能把内存吃穿；
     * 这里超过 [IPC_MAX_LINE_BYTES] 就进入丢弃模式，直到下一个换行，行与行之间不会串。
     */
    private fun readStdout(input: InputStream) {
        val line = ByteArrayOutputStream(8 * 1024)
        val buffer = ByteArray(64 * 1024)
        var overflow = false
        try {
            while (true) {
                val read = input.read(buffer)
                if (read < 0) {
                    break
                }
                for (index in 0 until read) {
                    val byte = buffer[index]
                    if (byte == '\n'.code.toByte()) {
                        if (overflow) {
                            Log.w(TAG, "丢弃超过 1 MiB 的协议行")
                        } else if (line.size() > 0) {
                            dispatchLine(line.toByteArray())
                        }
                        line.reset()
                        overflow = false
                    } else if (line.size() >= IPC_MAX_LINE_BYTES) {
                        overflow = true
                    } else {
                        line.write(byte.toInt())
                    }
                }
            }
            // EOF 前最后一行可能没有换行。服务端每行都 flush，正常不会出现；
            // 出现了也不能丢，否则重启前最后一条响应会消失。
            if (!overflow && line.size() > 0) {
                dispatchLine(line.toByteArray())
            }
        } catch (error: IOException) {
            Log.w(TAG, "读取 ipc stdout 失败: ${error.javaClass.simpleName}")
        }
    }

    private fun dispatchLine(bytes: ByteArray) {
        // CRLF 兼容：Go 侧写的是 \n，但手工调试/Windows 转发时可能带 \r。
        val length = if (bytes.isNotEmpty() && bytes[bytes.size - 1] == '\r'.code.toByte()) {
            bytes.size - 1
        } else {
            bytes.size
        }
        if (length == 0) {
            return
        }
        val text = String(bytes, 0, length, StandardCharsets.UTF_8)
        try {
            onLine(text)
        } catch (error: RuntimeException) {
            // 单行解析失败不能把 reader 线程带走，否则后续所有响应都收不到。
            Log.w(TAG, "处理协议行失败: ${error.javaClass.simpleName}: ${error.message}")
        }
    }

    private fun readStderr(input: InputStream) {
        try {
            input.bufferedReader(StandardCharsets.UTF_8).use { reader ->
                while (true) {
                    val line = reader.readLine() ?: break
                    if (line.isEmpty()) {
                        continue
                    }
                    if (line.length <= LOGCAT_CHUNK_CHARS) {
                        Log.i(STDERR_TAG, line)
                    } else {
                        line.chunked(LOGCAT_CHUNK_CHARS).forEach { part -> Log.i(STDERR_TAG, part) }
                    }
                }
            }
        } catch (error: IOException) {
            Log.w(TAG, "读取 ipc stderr 失败: ${error.javaClass.simpleName}")
        }
    }
}
