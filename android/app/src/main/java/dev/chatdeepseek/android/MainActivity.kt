package dev.chatdeepseek.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import dev.chatdeepseek.android.ipc.IpcClient
import dev.chatdeepseek.android.net.UploadStore
import dev.chatdeepseek.android.platform.AndroidPlatformHost
import dev.chatdeepseek.android.web.ShellWebView

/**
 * 壳的宿主：只做「装桥、给平台宿主、卸载」。
 *
 * 必须是 ComponentActivity：AndroidPlatformHost 在构造时就 registerForActivityResult，
 * 传普通 Activity 会在运行时抛 IllegalStateException（编译期发现不了），所以这里不能用
 * Activity/AppCompatActivity 的裸壳。
 *
 * 界面本身全部在 WebView 里（assets 里的 mobile Web），这里不写任何布局。
 */
class MainActivity : ComponentActivity() {

    private lateinit var shell: ShellWebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 在 STARTED 之前构造平台宿主：文件选择/权限的 launcher 必须在 onCreate 里注册。
        val platform = AndroidPlatformHost(this, UploadStore.getInstance(this))
        shell = ShellWebView(this, platform)
        setContentView(shell.view)
        shell.loadStartPage()
    }

    override fun onDestroy() {
        shell.destroy()
        // 只有真正退出（不是旋转/被系统回收后重建）才关掉 ipc；否则 serve 会被连带 Pdeathsig 杀掉，
        // 回来还得重新启动服务。
        if (isFinishing) {
            IpcClient.getInstance(applicationContext).destroy()
        }
        super.onDestroy()
    }
}
