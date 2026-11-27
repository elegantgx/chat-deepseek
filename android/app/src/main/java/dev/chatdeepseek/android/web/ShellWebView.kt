package dev.chatdeepseek.android.web

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.util.Log
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabsIntent
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewFeature
import dev.chatdeepseek.android.ipc.IpcClient
import dev.chatdeepseek.android.net.NetClient
import dev.chatdeepseek.android.net.UploadStore
import dev.chatdeepseek.android.platform.AppInfo
import dev.chatdeepseek.android.platform.PlatformHost
import dev.chatdeepseek.android.platform.ServerRegistry
import dev.chatdeepseek.android.platform.UnsupportedPlatformHost
import java.io.ByteArrayInputStream

private const val TAG = "ShellWebView"

/** WebViewAssetLoader 的固定域；页面从这里加载时才有桥。 */
private const val ASSET_HOST = "appassets.androidplatform.net"
private const val ASSET_ORIGIN = "https://$ASSET_HOST"
private const val ASSET_PATH_PREFIX = "/assets/"

/** mobile Web 的入口（`dist-mobile/index.html` 被构建脚本同步到 assets 根）。 */
private const val START_URL = "$ASSET_ORIGIN${ASSET_PATH_PREFIX}index.html"

/**
 * WebView 宿主：资产加载、桥注入、外链拦截、夜间模式与返回手势。
 *
 * 必须在主线程构造（WebView 的硬性要求），并且用 Activity 作为 context；
 * 这样返回手势能挂到 Activity 的 [OnBackPressedCallback] 上。
 *
 * 注入规则只有一条：**只有 assets 源的页面才 `addJavascriptInterface`**。
 * 外链一律交给 Custom Tabs，不在 WebView 里打开，所以正常流程不会走到“非 assets 页面”分支；
 * 这里仍然在 onPageStarted 里按 URL 判断并移除桥，防止将来有人误加导航入口。
 */
class ShellWebView(
    context: Context,
    platformHost: PlatformHost? = null,
) {

    private val appContext = context.applicationContext
    private val activity = context as? ComponentActivity

    @Volatile
    private var destroyed = false

    @Volatile
    private var interfaceInjected = false

    /** WebView 的文件选择回调；同一时间只允许一个，重复打开时旧的用 null 收尾。 */
    private var pendingFileChooser: ValueCallback<Array<Uri>>? = null

    val view: WebView = WebView(context)

    private val registry = ServerRegistry.getInstance(appContext)
    private val uploads = UploadStore.getInstance(appContext)
    private val ipc = IpcClient.getInstance(appContext)
    private val net = NetClient.getInstance(appContext, registry)
    private val callbacks = BridgeCallbacks(view) { !destroyed }

    val bridge: ShellBridge = ShellBridge(
        context = appContext,
        ipc = ipc,
        net = net,
        uploads = uploads,
        registry = registry,
        platformHost = platformHost ?: UnsupportedPlatformHost,
        callbacks = callbacks,
    )

    private val backCallback: OnBackPressedCallback? = activity?.let { owner ->
        val callback = object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (view.canGoBack()) {
                    view.goBack()
                } else {
                    // 页面没有历史可退时把事件交还给 Activity，避免返回键被永久吃掉。
                    isEnabled = false
                    owner.onBackPressedDispatcher.onBackPressed()
                }
            }
        }
        owner.onBackPressedDispatcher.addCallback(callback)
        callback
    }

    private val assetLoader: WebViewAssetLoader = WebViewAssetLoader.Builder()
        .setDomain(ASSET_HOST)
        .addPathHandler(ASSET_PATH_PREFIX, WebViewAssetLoader.AssetsPathHandler(appContext))
        .build()

    /**
     * `<input type=file>` 走系统文件选择器。必须在 Activity 创建阶段注册；
     * 不是 ComponentActivity（spike/测试）时保持 null，onShowFileChooser 直接返回 false。
     */
    private val fileChooserLauncher: ActivityResultLauncher<Intent>? =
        activity?.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            finishFileChooser(result.resultCode, result.data)
        }

    fun loadStartPage() {
        if (destroyed) {
            return
        }
        view.loadUrl(START_URL)
    }

    fun destroy() {
        if (destroyed) {
            return
        }
        destroyed = true
        // 文件选择器还开着时以 null 收尾，避免 WebView 持有页面回调造成泄漏。
        pendingFileChooser?.onReceiveValue(null)
        pendingFileChooser = null
        // 先停桥再拆 WebView：bridge.destroy 会 abort 在途请求、删临时文件并关掉回调队列。
        bridge.destroy()
        removeInterface()
        backCallback?.remove()
        try {
            view.stopLoading()
        } catch (_: Throwable) {
            // WebView 已经处于销毁流程时 stopLoading 可能抛，继续清理即可。
        }
        try {
            view.loadUrl("about:blank")
        } catch (_: Throwable) {
            // 同上。
        }
        view.clearHistory()
        view.removeAllViews()
        try {
            view.destroy()
        } catch (error: Throwable) {
            Log.w(TAG, "销毁 WebView 失败: ${error.javaClass.simpleName}")
        }
    }

    private fun configureSettings() {
        val settings = view.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        // 渲染层只有 assets，不需要文件/内容访问；关掉能减小被页面诱导读本地文件的面。
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.setSupportMultipleWindows(false)
        settings.javaScriptCanOpenWindowsAutomatically = false
        // 语音播放要能自动开始：聊天里的朗读/提示音由用户手势之外的状态驱动。
        settings.mediaPlaybackRequiresUserGesture = false
        // 页面是 https 源，壳的 HTTP 全在原生侧；页面里任何明文请求都不该被放行。
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        // 服务端日志/UA 检查需要能区分 Android 壳；版本与 ready().version 同源。
        settings.userAgentString = settings.userAgentString +
            " chat-deepseek-android/" + AppInfo.versionName(appContext)
        // 页面自己按 prefers-color-scheme 出明暗两套 token；算法反色会把暗色再反一次。
        // 这里显式关掉，统一交给 CSS 的 color-scheme + media query。WebView 本身会跟随系统夜间模式。
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, false)
        }
    }

    private val shellChromeClient: WebChromeClient = object : WebChromeClient() {
        override fun onShowFileChooser(
            webView: WebView,
            filePathCallback: ValueCallback<Array<Uri>>,
            fileChooserParams: WebChromeClient.FileChooserParams,
        ): Boolean {
            // 只有 assets 页面能拉起选择器；外链页面（理论上进不来）不许碰本地文件。
            val current = webView.url ?: return false
            if (!isAssetUrl(Uri.parse(current)) || fileChooserLauncher == null) {
                return false
            }
            // WebView 不允许两个选择器并行；旧的必须以 null 结束，否则页面会一直等。
            pendingFileChooser?.onReceiveValue(null)
            pendingFileChooser = filePathCallback
            val acceptTypes = fileChooserParams.acceptTypes?.filter { it.isNotBlank() } ?: emptyList()
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                // 系统只认真实 MIME；accept 里混入扩展名时优先挑第一个像 MIME 的。
                type = acceptTypes.firstOrNull { it.contains('/') }
                    ?: acceptTypes.firstOrNull()
                    ?: "*/*"
                if (acceptTypes.isNotEmpty()) {
                    putExtra(Intent.EXTRA_MIME_TYPES, acceptTypes.toTypedArray())
                }
                putExtra(
                    Intent.EXTRA_ALLOW_MULTIPLE,
                    fileChooserParams.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE,
                )
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            return try {
                fileChooserLauncher.launch(intent)
                true
            } catch (error: RuntimeException) {
                pendingFileChooser = null
                filePathCallback.onReceiveValue(null)
                Log.w(TAG, "打开文件选择器失败: ${error.javaClass.simpleName}")
                true
            }
        }
    }

    private val shellClient: WebViewClient = object : WebViewClient() {
        override fun shouldInterceptRequest(
            view: WebView,
            request: WebResourceRequest,
        ): WebResourceResponse? {
            val url = request.url
            if (url.scheme == "https" && url.host == ASSET_HOST) {
                // 资产优先走 loader；loader 也不认识就当 404，别让它落到网络。
                return assetLoader.shouldInterceptRequest(url) ?: emptyResponse(404, "Not Found")
            }
            if (url.scheme == "http" || url.scheme == "https") {
                // 渲染层没有网络权限：除 assets 外的 http(s) 子资源直接 403。
                // 外链导航另有 shouldOverrideUrlLoading 交给 Custom Tabs。
                return emptyResponse(403, "Forbidden")
            }
            return null
        }

        override fun shouldOverrideUrlLoading(
            view: WebView,
            request: WebResourceRequest,
        ): Boolean {
            val url = request.url
            if (isAssetUrl(url)) {
                return false
            }
            if (!request.isForMainFrame) {
                // 子 frame 的外链不弹浏览器（那会变成页面里嵌一个链接就能拉起外部 App），直接拦掉。
                return true
            }
            openExternally(url)
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            super.onPageStarted(view, url, favicon)
            if (url == null) {
                return
            }
            // 新页面开始：旧页面的 id、在途请求、临时文件全部作废。
            bridge.onPageStarted()
            if (isAssetUrl(Uri.parse(url))) {
                injectInterface()
            } else {
                removeInterface()
            }
        }

        override fun onPageFinished(view: WebView, url: String?) {
            super.onPageFinished(view, url)
            if (url == null || !isAssetUrl(Uri.parse(url))) {
                return
            }
            // 有些 WebView 在 onPageStarted 注入后仍要等文档建好才可见，这里补一次并通知页面。
            injectInterface()
            try {
                view.evaluateJavascript("window.__chatBridgeReady&&window.__chatBridgeReady()", null)
            } catch (error: Throwable) {
                Log.w(TAG, "通知 __chatBridgeReady 失败: ${error.javaClass.simpleName}")
            }
        }
    }

    init {
        configureSettings()
        view.webViewClient = shellClient
        view.webChromeClient = shellChromeClient
    }

    private fun injectInterface() {
        if (interfaceInjected || destroyed) {
            return
        }
        view.addJavascriptInterface(bridge, BRIDGE_INTERFACE_NAME)
        interfaceInjected = true
    }

    private fun removeInterface() {
        if (!interfaceInjected) {
            return
        }
        try {
            view.removeJavascriptInterface(BRIDGE_INTERFACE_NAME)
        } catch (error: Throwable) {
            Log.w(TAG, "移除 JS 桥失败: ${error.javaClass.simpleName}")
        }
        interfaceInjected = false
    }

    private fun openExternally(url: Uri) {
        if (url.scheme != "http" && url.scheme != "https") {
            // mailto/tel 之类不在桥的职责里；直接忽略，避免落到 WebView 内部导航。
            return
        }
        val host = activity ?: appContext
        try {
            val customTabs = CustomTabsIntent.Builder().setShowTitle(true).build()
            if (host !is ComponentActivity) {
                // application context 启动 Activity 必须带 NEW_TASK；正常接线走 Activity 分支。
                customTabs.intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            customTabs.launchUrl(host, url)
        } catch (error: RuntimeException) {
            Log.w(TAG, "打开外部链接失败: ${error.javaClass.simpleName}")
        }
    }

    /** 把 ActivityResult 转成 WebView 要的 Array<Uri>；取消/无结果必须回 null，否则输入框一直转圈。 */
    private fun finishFileChooser(resultCode: Int, data: Intent?) {
        val callback = pendingFileChooser ?: return
        pendingFileChooser = null
        if (resultCode != Activity.RESULT_OK || data == null) {
            callback.onReceiveValue(null)
            return
        }
        val uris = ArrayList<Uri>()
        val clip = data.clipData
        if (clip != null) {
            for (index in 0 until clip.itemCount) {
                clip.getItemAt(index)?.uri?.let { uri -> uris.add(uri) }
            }
        } else {
            data.data?.let { uri -> uris.add(uri) }
        }
        callback.onReceiveValue(if (uris.isEmpty()) null else uris.toTypedArray())
    }

    private fun isAssetUrl(url: Uri?): Boolean {
        if (url == null) {
            return false
        }
        return url.scheme == "https" &&
            url.host == ASSET_HOST &&
            url.path?.startsWith(ASSET_PATH_PREFIX) == true
    }

    private fun emptyResponse(status: Int, reason: String): WebResourceResponse {
        return WebResourceResponse(
            "text/plain",
            "utf-8",
            status,
            reason,
            mapOf("Cache-Control" to "no-store"),
            ByteArrayInputStream(ByteArray(0)),
        )
    }
}
