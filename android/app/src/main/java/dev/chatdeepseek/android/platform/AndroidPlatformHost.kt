package dev.chatdeepseek.android.platform

import android.Manifest
import android.app.NotificationChannel
import android.content.ActivityNotFoundException
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import dev.chatdeepseek.android.net.UploadStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.FileInputStream

private const val CHANNEL_ID = "chat-deepseek"
private const val PICK_MIME_ALL = "*/*"
private const val DEFAULT_MIME = "application/octet-stream"

/**
 * 真机平台能力。必须在 `Activity.onCreate`（进入 STARTED 之前）构造，因为
 * `registerForActivityResult` 只能在 Activity 创建阶段注册；构造好之后传给
 * [dev.chatdeepseek.android.web.ShellWebView]。
 *
 * 所有方法都从桥线程进来，先切主线程再操作 Activity/Window；文件复制这种慢活再切回 IO。
 */
class AndroidPlatformHost(
    private val activity: ComponentActivity,
    private val uploads: UploadStore,
) : PlatformHost {

    private val mainHandler = Handler(Looper.getMainLooper())
    private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private var pendingPick: ((Result<JSONObject>) -> Unit)? = null
    private var pendingPermission: ((Result<JSONObject>) -> Unit)? = null
    private var pendingSave: PendingSave? = null

    private val pickLauncher: ActivityResultLauncher<Array<String>> =
        activity.registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
            onPicked(uris)
        }

    /** `multiple=false` 用单文件契约；两个 launcher 都必须在 onCreate 阶段注册。 */
    private val pickSingleLauncher: ActivityResultLauncher<Array<String>> =
        activity.registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            onPicked(if (uri == null) emptyList() else listOf(uri))
        }

    private val permissionLauncher: ActivityResultLauncher<String> =
        activity.registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            onPermissionResult(granted)
        }

    /**
     * `CreateDocument` 的 intent type 在构造时固定，而 `saveFile` 的 mime 是每次请求才给的。
     * 用子类在 `createIntent` 里换成当前请求的 mime；其余行为（ACTION_CREATE_DOCUMENT、
     * 用户取消返回 null）完全复用官方契约。
     */
    private val saveDocumentContract = DynamicCreateDocument()

    private val saveDocumentLauncher: ActivityResultLauncher<String> =
        activity.registerForActivityResult(saveDocumentContract) { uri ->
            onSaveDocumentResult(uri)
        }

    override fun handle(method: String, params: JSONObject, callback: (Result<JSONObject>) -> Unit) {
        runOnMain {
            try {
                when (method) {
                    "pickFiles" -> pickFiles(params, callback)
                    "share" -> share(params, callback)
                    "openExternal" -> openExternal(params, callback)
                    "requestPermission" -> requestPermission(params, callback)
                    "notify" -> notify(params, callback)
                    "setKeepScreenOn" -> setKeepScreenOn(params, callback)
                    "saveFile" -> saveFile(params, callback)
                    else -> callback(Result.failure(PlatformError("unsupported", "未知平台方法: $method")))
                }
            } catch (error: PlatformError) {
                callback(Result.failure(error))
            } catch (error: RuntimeException) {
                // Activity 正在销毁、没有可处理的应用等；统一归一成 platform 失败，别让桥线程崩。
                callback(Result.failure(PlatformError("protocol", error.javaClass.simpleName, error)))
            }
        }
    }

    override fun close() {
        ioScope.cancel()
        pendingPick = null
        pendingPermission = null
        // 保存对话框还开着时 Activity 被销毁：临时文件必须在这里删，结果回来时 pendingSave 已空。
        pendingSave?.temp?.file?.delete()
        pendingSave = null
    }

    /**
     * 选文件后直接复制进临时文件区，返回 `{files:[{tempId,name,size,mime}]}`。
     * 不把内容 base64 过桥：选一个 50 MiB 的附件时，base64 会多占 1/3 内存还要跨 JS 字符串。
     */
    private fun pickFiles(params: JSONObject, callback: (Result<JSONObject>) -> Unit) {
        if (pendingPick != null) {
            callback(Result.failure(PlatformError("busy", "已有文件选择进行中")))
            return
        }
        pendingPick = callback
        val mimeTypes = readMimeTypes(params)
        val multiple = params.optBoolean("multiple", true)
        try {
            if (multiple) {
                pickLauncher.launch(mimeTypes)
            } else {
                pickSingleLauncher.launch(mimeTypes)
            }
        } catch (error: RuntimeException) {
            // ActivityNotFoundException 或 Activity 已经进入 STARTED 之后才注册导致的 IllegalStateException：
            // 都要清掉 pending，否则后续选择会永远报 busy。
            pendingPick = null
            callback(Result.failure(PlatformError("unsupported", "无法打开文件选择器", error)))
        }
    }

    private fun onPicked(uris: List<Uri>) {
        val callback = pendingPick ?: return
        pendingPick = null
        if (uris.isEmpty()) {
            callback(Result.success(JSONObject().put("files", JSONArray())))
            return
        }
        // 复制可能很慢，放到 IO；callback 由 ShellBridge 统一送回 UI 线程。
        ioScope.launch {
            val created = ArrayList<String>()
            try {
                val files = JSONArray()
                for (uri in uris) {
                    val name = queryDisplayName(uri) ?: "file"
                    val mime = activity.contentResolver.getType(uri)
                        ?: "application/octet-stream"
                    val size = querySize(uri) ?: -1L
                    val input = activity.contentResolver.openInputStream(uri)
                        ?: throw PlatformError("protocol", "无法读取所选文件")
                    val temp = input.use {
                        uploads.saveFromStream(name, mime, size, it)
                    }
                    created.add(temp.id)
                    // 字段名按渲染层 PickedFile：name/mime/size/tempId。
                    files.put(
                        JSONObject()
                            .put("tempId", temp.id)
                            .put("name", temp.name)
                            .put("size", temp.size)
                            .put("mime", temp.mime)
                    )
                }
                callback(Result.success(JSONObject().put("files", files)))
            } catch (error: PlatformError) {
                created.forEach { tempId -> uploads.discard(tempId) }
                callback(Result.failure(error))
            } catch (error: Exception) {
                // 复制阶段可能抛 NetError（超过 64 MiB/临时目录不可写）或 IO/运行时异常；
                // 不接住的话这个协程会静默结束，桥永远等不到 done。
                created.forEach { tempId -> uploads.discard(tempId) }
                callback(Result.failure(PlatformError("protocol", error.message ?: "读取所选文件失败", error)))
            }
        }
    }

    private fun share(params: JSONObject, callback: (Result<JSONObject>) -> Unit) {
        val text = params.optString("text", "")
        val url = params.optString("url", "")
        val shared = listOf(text, url).filter { it.isNotEmpty() }.joinToString("\n")
        if (shared.isEmpty()) {
            callback(Result.failure(PlatformError("protocol", "share 缺少 text/url")))
            return
        }
        val title = params.optString("title", "")
        val send = Intent(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_TEXT, shared)
        if (title.isNotEmpty()) {
            send.putExtra(Intent.EXTRA_SUBJECT, title)
        }
        activity.startActivity(Intent.createChooser(send, title))
        callback(Result.success(JSONObject().put("ok", true)))
    }

    private fun openExternal(params: JSONObject, callback: (Result<JSONObject>) -> Unit) {
        val raw = params.optString("url", "").trim()
        val uri = try {
            Uri.parse(raw)
        } catch (_: RuntimeException) {
            null
        }
        if (uri == null || (uri.scheme != "http" && uri.scheme != "https")) {
            callback(Result.failure(PlatformError("protocol", "只支持 http(s) 外部链接")))
            return
        }
        try {
            // 页面在 WebView 里，外链交给 Custom Tabs：有地址栏、有站点身份，且不继承壳的 JS 桥。
            CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(activity, uri)
            callback(Result.success(JSONObject().put("ok", true)))
        } catch (error: ActivityNotFoundException) {
            callback(Result.failure(PlatformError("unsupported", "没有可打开链接的浏览器", error)))
        }
    }

    /**
     * 权限只用桥上的名字，不把 Android 权限常量暴露给渲染层：
     * `microphone` / `camera` / `notifications`。
     * 通知权限在 Android 13 以下没有运行时开关，直接返回 granted。
     */
    private fun requestPermission(params: JSONObject, callback: (Result<JSONObject>) -> Unit) {
        val raw = params.optString("permission", "").ifEmpty { params.optString("name", "") }
        val permission = when (raw) {
            "microphone", "record_audio", Manifest.permission.RECORD_AUDIO -> Manifest.permission.RECORD_AUDIO
            "camera", Manifest.permission.CAMERA -> Manifest.permission.CAMERA
            "notifications", Manifest.permission.POST_NOTIFICATIONS -> Manifest.permission.POST_NOTIFICATIONS
            else -> {
                callback(Result.failure(PlatformError("unsupported", "未知权限: $raw")))
                return
            }
        }
        if (permission == Manifest.permission.POST_NOTIFICATIONS && Build.VERSION.SDK_INT < 33) {
            callback(Result.success(JSONObject().put("granted", true)))
            return
        }
        if (ContextCompat.checkSelfPermission(activity, permission) == PackageManager.PERMISSION_GRANTED) {
            callback(Result.success(JSONObject().put("granted", true)))
            return
        }
        if (pendingPermission != null) {
            callback(Result.failure(PlatformError("busy", "已有权限请求进行中")))
            return
        }
        pendingPermission = callback
        try {
            permissionLauncher.launch(permission)
        } catch (error: RuntimeException) {
            pendingPermission = null
            callback(Result.failure(PlatformError("unsupported", "无法发起权限请求", error)))
        }
    }

    private fun onPermissionResult(granted: Boolean) {
        val callback = pendingPermission ?: return
        pendingPermission = null
        callback(Result.success(JSONObject().put("granted", granted)))
    }

    /** 通知是尽力而为：没有权限/通道关闭时返回 `{shown:false}`，不抛错（页面据此引导开权限）。 */
    private fun notify(params: JSONObject, callback: (Result<JSONObject>) -> Unit) {
        val title = params.optString("title", "").ifEmpty { "Chat DeepSeek" }
        val body = params.optString("body", "")
        val notificationId = params.optInt("id", 1)
        val manager = NotificationManagerCompat.from(activity)
        val allowed = manager.areNotificationsEnabled() &&
            (Build.VERSION.SDK_INT < 33 ||
                ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED)
        if (!allowed) {
            callback(Result.success(JSONObject().put("shown", false)))
            return
        }
        ensureChannel()
        val notification = NotificationCompat.Builder(activity, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .build()
        manager.notify(notificationId, notification)
        callback(Result.success(JSONObject().put("shown", true)))
    }

    private fun setKeepScreenOn(params: JSONObject, callback: (Result<JSONObject>) -> Unit) {
        val enabled = params.optBoolean("enabled", false)
        if (enabled) {
            activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
        callback(Result.success(JSONObject().put("ok", true)))
    }

    /**
     * `saveFile({name,mime,tempId})`：把 fileBegin/fileChunk/fileEnd 落好的临时文件
     * 交给系统「另存为」，用 CreateDocument 让用户选位置。
     *
     * 临时文件在 take 时就从 UploadStore 摘出来，成功、取消、失败、Activity 销毁都要删；
     * 复制在 IO 线程做，不分块过桥（文件本来就在壳里）。
     */
    private fun saveFile(params: JSONObject, callback: (Result<JSONObject>) -> Unit) {
        if (pendingSave != null) {
            callback(Result.failure(PlatformError("busy", "已有保存操作在进行中")))
            return
        }
        val tempId = params.optString("tempId", "").trim()
        if (tempId.isEmpty()) {
            callback(Result.failure(PlatformError("protocol", "saveFile 缺少 tempId")))
            return
        }
        val rawMime = params.optString("mime", "").trim()
        val mime = if (rawMime.contains('/')) rawMime else DEFAULT_MIME
        val name = sanitizeFileName(params.optString("name", "").trim().ifEmpty { "download.bin" })
        val temp = try {
            uploads.take(tempId)
        } catch (error: Exception) {
            callback(
                Result.failure(
                    PlatformError("protocol", error.message ?: "临时文件不存在或已过期", error)
                )
            )
            return
        }
        pendingSave = PendingSave(callback, temp)
        saveDocumentContract.mimeType = mime
        try {
            saveDocumentLauncher.launch(name)
        } catch (error: RuntimeException) {
            pendingSave = null
            temp.file.delete()
            callback(Result.failure(PlatformError("unsupported", "无法打开保存对话框", error)))
        }
    }

    private fun onSaveDocumentResult(uri: Uri?) {
        val pending = pendingSave ?: return
        pendingSave = null
        if (uri == null) {
            // 用户取消：同样走失败路径，渲染层统一 toast「保存失败」。
            pending.temp.file.delete()
            pending.callback(Result.failure(PlatformError("protocol", "已取消保存")))
            return
        }
        ioScope.launch {
            try {
                // "wt" 会截断已有文件；用户选「覆盖」时不能留下旧文件尾部。
                val output = activity.contentResolver.openOutputStream(uri, "wt")
                    ?: throw PlatformError("protocol", "无法写入所选位置")
                FileInputStream(pending.temp.file).use { input ->
                    output.use { stream -> input.copyTo(stream, 64 * 1024) }
                }
                pending.temp.file.delete()
                pending.callback(Result.success(JSONObject().put("ok", true)))
            } catch (error: Exception) {
                pending.temp.file.delete()
                pending.callback(
                    Result.failure(
                        PlatformError("protocol", error.message ?: "保存文件失败", error)
                    )
                )
            }
        }
    }

    /** 用户输入的文件名只作为建议标题，去掉路径分隔符/控制字符，避免奇怪的名字进系统 UI。 */
    private fun sanitizeFileName(raw: String): String {
        val cleaned = raw.replace('/', '_').replace('\\', '_')
        val builder = StringBuilder(cleaned.length)
        for (char in cleaned) {
            if (char.code >= 0x20 && char.code != 0x7f) {
                builder.append(char)
            }
        }
        val value = builder.toString().trim()
        return if (value.isEmpty()) "download.bin" else value.take(180)
    }

    private class PendingSave(
        val callback: (Result<JSONObject>) -> Unit,
        val temp: UploadStore.TempFile,
    )

    private fun ensureChannel() {
        val manager = activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) == null) {
            // minSdk 26，通知通道一定存在；名字用应用名，跟随语言。
            val label = activity.applicationInfo.loadLabel(activity.packageManager).toString()
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, label, NotificationManager.IMPORTANCE_DEFAULT)
            )
        }
    }

    /**
     * 渲染层发的是 `accept`（MIME 或扩展名、逗号分隔），如 `image` 通配、`.pdf`；
     * 系统文件选择器只认 MIME，扩展名没法精确过滤，只能回落到通配 MIME 再靠 UI 判断。
     */
    private fun readMimeTypes(params: JSONObject): Array<String> {
        val accept = params.optString("accept", "").trim()
        if (accept.isEmpty()) {
            return arrayOf(PICK_MIME_ALL)
        }
        val types = ArrayList<String>()
        for (token in accept.split(',')) {
            val value = token.trim()
            if (value.isEmpty()) {
                continue
            }
            if (value.contains('/')) {
                types.add(value)
            }
        }
        return if (types.isEmpty()) arrayOf(PICK_MIME_ALL) else types.toTypedArray()
    }

    private fun queryDisplayName(uri: Uri): String? {
        return activity.contentResolver.query(
            uri,
            arrayOf(OpenableColumns.DISPLAY_NAME),
            null,
            null,
            null,
        )?.use { cursor ->
            val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (index >= 0 && cursor.moveToFirst()) cursor.getString(index) else null
        }
    }

    private fun querySize(uri: Uri): Long? {
        return activity.contentResolver.query(
            uri,
            arrayOf(OpenableColumns.SIZE),
            null,
            null,
            null,
        )?.use { cursor ->
            val index = cursor.getColumnIndex(OpenableColumns.SIZE)
            if (index >= 0 && cursor.moveToFirst() && !cursor.isNull(index)) cursor.getLong(index) else null
        }
    }

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            block()
        } else {
            mainHandler.post(block)
        }
    }
}

/** 每次启动前把 [mimeType] 改成当前请求的 mime，其余行为交给 [ActivityResultContracts.CreateDocument]。 */
private class DynamicCreateDocument : ActivityResultContracts.CreateDocument("*/*") {
    var mimeType: String = DEFAULT_MIME

    override fun createIntent(context: Context, input: String): Intent {
        return super.createIntent(context, input).apply { type = mimeType }
    }
}
