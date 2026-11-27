package dev.chatdeepseek.android.platform

import org.json.JSONObject

/** 壳实际提供的平台方法；`ready().capabilities.platform` 与宿主实现共用这一份。 */
val DEFAULT_PLATFORM_METHODS: Set<String> = linkedSetOf(
    "pickFiles",
    "share",
    "openExternal",
    "requestPermission",
    "notify",
    "setKeepScreenOn",
    "saveFile",
)

/**
 * 壳独有的平台能力。做成接口是为了让 WebView 宿主不依赖 Activity：
 * - 真机接线时传 [AndroidPlatformHost]（在 Activity.onCreate 里构造，ActivityResult 才能注册）；
 * - 单元测试/截图场景传 [UnsupportedPlatformHost] 或自己的实现。
 *
 * 回调可能在任意线程；[dev.chatdeepseek.android.web.ShellBridge] 负责把结果送回 UI 线程。
 */
interface PlatformHost {
    /** 当前宿主真正支持的方法；不支持的宿主返回空集，渲染层据此不渲染入口。 */
    val supportedMethods: Set<String>
        get() = DEFAULT_PLATFORM_METHODS

    fun handle(method: String, params: JSONObject, callback: (Result<JSONObject>) -> Unit)

    /** WebView 销毁时释放 ActivityResult/协程等资源；默认无需释放。 */
    fun close() {}
}

/** 平台能力失败：`unsupported`（当前宿主没有这个能力）或 `protocol`（参数不对/调用失败）。 */
class PlatformError(
    val code: String,
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause)

/**
 * 没有 Activity 的宿主（spike/测试）用这个：所有方法统一返回 `unsupported`，
 * 让页面按能力表降级，而不是崩在空 Activity 上。
 */
object UnsupportedPlatformHost : PlatformHost {
    override val supportedMethods: Set<String> = emptySet()

    override fun handle(method: String, params: JSONObject, callback: (Result<JSONObject>) -> Unit) {
        callback(Result.failure(PlatformError("unsupported", "当前宿主未提供平台能力: $method")))
    }
}
