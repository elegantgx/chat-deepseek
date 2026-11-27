package dev.chatdeepseek.android.net

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.util.UUID

private const val TAG = "UploadStore"

/**
 * 附件上传的临时文件区（`cacheDir/upload/`）。
 *
 * 生命周期（谁创建/谁删）：
 * - `fileBegin` 创建 → `fileChunk` 追加 → `fileEnd` 收尾；`netUpload` 用 `take` 取走后
 *   由调用方在 finally 删除（成功/失败/取消都删）。
 * - `pickFiles` 也用它：ContentResolver 的流直接按 64 KiB 复制进来，返回 `tempId`，
 *   不回传 base64，避免大文件过桥。
 * - 页面重载/ShellWebView.destroy 调 [discardAll]：取消所有在途请求后把未取走的临时文件一并删掉。
 * - 进程重启时构造函数会清空整个目录（上一个进程不可能还有在途请求），不留孤儿文件。
 *
 * 上限：单文件 64 MiB（与服务端 filestore 对齐），单片 256 KiB（桥契约）。
 */
class UploadStore private constructor(context: Context) {

    class TempFile internal constructor(
        val id: String,
        val file: File,
        val name: String,
        val mime: String,
    ) {
        /** 实际写入字节数；finish 之后才准确。 */
        var size: Long = 0
            internal set
    }

    companion object {
        @Volatile
        private var instance: UploadStore? = null

        fun getInstance(context: Context): UploadStore {
            return instance ?: synchronized(this) {
                instance ?: UploadStore(context.applicationContext).also { instance = it }
            }
        }
    }

    private val dir = File(context.cacheDir, "upload")
    private val entries = HashMap<String, Entry>()

    init {
        // 新进程不存在上一个进程的在途上传，目录里的 .part 全是孤儿，直接清掉。
        dir.mkdirs()
        dir.listFiles()?.forEach { file ->
            if (file.isFile) {
                file.delete()
            }
        }
    }

    /**
     * `fileBegin(id, meta)`：**id 由渲染层生成，就是后续 fileChunk/fileEnd 的 tempId**，
     * 必须原样拿来做临时文件名；不能用壳自己生成的 id，否则两边的 id 对不上。
     *
     * 这个方法在桥线程上同步执行：渲染层不 await done，fileBegin 返回后立刻发 fileChunk，
     * 迟一步创建就会丢分片。meta 的 `mime` 是渲染层字段（旧字段 contentType 兼容）。
     */
    fun begin(tempId: String?, meta: JSONObject): TempFile = synchronized(this) {
        val name = sanitizeName(meta.optString("name", "upload.bin"))
        val mime = meta.optString("mime", "").trim().ifEmpty {
            meta.optString("contentType", "").trim()
        }.ifEmpty { "application/octet-stream" }
        val declaredSize = meta.optLong("size", -1L)
        beginInternal(tempId, name, mime, declaredSize)
    }

    /** `fileChunk` 的同步入口：一次写 ≤256 KiB，不攒大缓冲。 */
    fun append(tempId: String, data: ByteArray) {
        synchronized(this) {
            appendInternal(tempId, data, data.size)
        }
    }

    /** `fileEnd`：关闭写句柄；失败原因留给 netUpload 报 `protocol`（fileEnd 没有回调 id）。 */
    fun finish(tempId: String) {
        synchronized(this) {
            val entry = entries[tempId] ?: return
            if (entry.finished) {
                return
            }
            closeQuietly(entry)
            entry.finished = true
            entry.ref.size = entry.written
            if (entry.failure != null) {
                entry.ref.file.delete()
            }
        }
    }

    /** 取走临时文件：netUpload 成功后由调用方删除；文件不存在/未完成/已失败都抛 protocol。 */
    fun take(tempId: String): TempFile {
        synchronized(this) {
            val entry = entries.remove(tempId) ?: throw NetError("protocol", "临时文件不存在或已过期")
            closeQuietly(entry)
            entry.failure?.let { reason ->
                entry.ref.file.delete()
                throw NetError("protocol", reason)
            }
            if (!entry.finished) {
                entry.ref.file.delete()
                throw NetError("protocol", "文件尚未传完")
            }
            if (!entry.ref.file.isFile) {
                throw NetError("protocol", "临时文件已被清理")
            }
            return entry.ref
        }
    }

    fun discard(tempId: String) {
        synchronized(this) {
            val entry = entries.remove(tempId)
            if (entry != null) {
                closeQuietly(entry)
                entry.ref.file.delete()
            }
            // 文件可能已经被 take 走（上传中/刚失败）；abort 的契约是「收到 tempId 必须删」。
            // Linux 下 unlink 正在读的文件不影响已打开的 fd，上传会自然结束或被 cancel。
            // id 来自渲染层，拼路径前先校验，避免 ../ 跑出缓存目录。
            if (isSafeTempId(tempId)) {
                File(dir, "$tempId.part").delete()
            }
        }
    }

    /** 页面重载 / WebView 销毁：所有临时文件都是旧页面的，全部删掉。 */
    fun discardAll() {
        synchronized(this) {
            for (entry in entries.values) {
                closeQuietly(entry)
            }
            entries.clear()
            dir.listFiles()?.forEach { file -> file.delete() }
        }
    }

    /**
     * `pickFiles` 用：把 ContentResolver 的流复制成临时文件。
     * 复制在调用方的 IO 线程上做，不占桥线程；超过 64 MiB 立即失败并删文件。
     */
    fun saveFromStream(
        name: String,
        mime: String,
        declaredSize: Long,
        input: InputStream,
    ): TempFile {
        val ref = synchronized(this) {
            beginInternal(null, sanitizeName(name), mime, declaredSize)
        }
        var total = 0L
        try {
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) {
                    break
                }
                total += read
                if (total > NetLimits.MAX_UPLOAD_BYTES) {
                    throw NetError("protocol", "文件超过 64 MiB")
                }
                synchronized(this) {
                    appendInternal(ref.id, buffer, read)
                }
            }
        } catch (error: Throwable) {
            discard(ref.id)
            throw error
        }
        finish(ref.id)
        return ref
    }

    private fun beginInternal(tempId: String?, name: String, mime: String, declaredSize: Long): TempFile {
        if (declaredSize > NetLimits.MAX_UPLOAD_BYTES) {
            throw NetError("protocol", "文件超过 64 MiB")
        }
        if (!dir.isDirectory && !dir.mkdirs()) {
            throw NetError("protocol", "无法创建上传临时目录")
        }
        val id = tempId?.trim()?.ifEmpty { null } ?: "up-${UUID.randomUUID()}"
        // id 会变成文件名；渲染层的 "tmp1" 这类 id 合法，但不能让 ../ 之类跑出缓存目录。
        if (!isSafeTempId(id)) {
            throw NetError("protocol", "临时文件 id 不合法")
        }
        // 同一个 id 重复 begin（页面重试/旧文件残留）：先清掉旧条目再重建。
        entries.remove(id)?.let { old -> closeQuietly(old); old.ref.file.delete() }
        val file = File(dir, "$id.part")
        val output = try {
            FileOutputStream(file)
        } catch (_: IOException) {
            throw NetError("protocol", "无法创建上传临时文件")
        }
        val ref = TempFile(id, file, name, mime)
        entries[id] = Entry(ref, output)
        return ref
    }

    /** 只允许字母数字和 `._-`，长度受限：tempId 来自渲染层，直接拼文件名前必须校验。 */
    private fun isSafeTempId(id: String): Boolean {
        if (id.length > 128) {
            return false
        }
        for (char in id) {
            val ok = char in 'a'..'z' || char in 'A'..'Z' || char in '0'..'9' ||
                char == '.' || char == '_' || char == '-'
            if (!ok) {
                return false
            }
        }
        return true
    }

    private fun appendInternal(tempId: String, data: ByteArray, length: Int) {
        val entry = entries[tempId]
        if (entry == null) {
            Log.w(TAG, "追加到不存在的临时文件 $tempId")
            return
        }
        if (entry.failure != null || entry.finished) {
            Log.w(TAG, "临时文件 $tempId 已结束，忽略追加")
            return
        }
        if (length > NetLimits.MAX_FILE_CHUNK_BYTES) {
            failInternal(entry, "单个分片超过 256 KiB")
            return
        }
        if (entry.written + length > NetLimits.MAX_UPLOAD_BYTES) {
            failInternal(entry, "文件超过 64 MiB")
            return
        }
        try {
            entry.output.write(data, 0, length)
            entry.written += length
            entry.ref.size = entry.written
        } catch (_: IOException) {
            failInternal(entry, "写入临时文件失败")
        }
    }

    private fun failInternal(entry: Entry, reason: String) {
        Log.w(TAG, "上传临时文件失败（${entry.ref.id}）：$reason")
        entry.failure = reason
        closeQuietly(entry)
        entry.ref.file.delete()
    }

    private fun closeQuietly(entry: Entry) {
        try {
            entry.output.close()
        } catch (_: IOException) {
            // 已经关过或进程正在退出，都不影响结果。
        }
    }

    /** 文件名会进 multipart 的 Content-Disposition，去掉引号/换行/路径分隔符，避免头注入。 */
    private fun sanitizeName(raw: String): String {
        val cleaned = raw.trim()
            .replace('\r', '_')
            .replace('\n', '_')
            .replace('"', '_')
            .replace('/', '_')
            .replace('\\', '_')
        val clipped = if (cleaned.length > 180) cleaned.substring(0, 180) else cleaned
        return clipped.ifEmpty { "upload.bin" }
    }

    private class Entry(
        val ref: TempFile,
        val output: FileOutputStream,
    ) {
        var written: Long = 0
        var finished: Boolean = false
        var failure: String? = null
    }
}
