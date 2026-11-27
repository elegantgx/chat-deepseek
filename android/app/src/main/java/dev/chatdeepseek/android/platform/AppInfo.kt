package dev.chatdeepseek.android.platform

import android.content.Context
import android.content.pm.PackageManager

/**
 * 壳的版本号信息，**只从 PackageManager 读**，不依赖 `BuildConfig`：
 * 构建脚本是否开启 buildConfig 由别人决定，壳层不该因此编不过。
 * WebView 的 UA 后缀与 `ready().version` 必须是同一个值，否则服务端/日志里对不上。
 */
object AppInfo {
    fun versionName(context: Context): String {
        return try {
            val info = context.packageManager.getPackageInfo(context.packageName, 0)
            info.versionName ?: "0"
        } catch (_: PackageManager.NameNotFoundException) {
            "0"
        }
    }
}
