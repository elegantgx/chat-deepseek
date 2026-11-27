package dev.chatdeepseek.android.platform

import android.content.Context
import android.util.Log
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.util.UUID

private const val TAG = "ServerRegistry"
private const val PREFS_NAME = "chat_deepseek_shell"
private const val KEY_REMOTES = "servers.remote"
private const val KEY_SELECTED = "servers.selected"

/**
 * 壳自己的服务器表：本机（内置后端，唯一）+ 用户添加的远程服务器。
 *
 * 本机不落盘，id 固定 [LOCAL_ID]，地址（端口）来自 ipc 的 `service.status.listen`，
 * **不写死端口**；listen 还没投影回来时本机 `baseUrl` 为空，[dev.chatdeepseek.android.web.ShellBridge]
 * 会把它标成 stopped，等投影到了再更新。
 *
 * 远程只持久化 `{id,name,baseUrl}`，地址必须是 https；这里不存任何凭据，
 * Cookie 在 [dev.chatdeepseek.android.net.CookieStore] 里按 serverId 分开。
 */
class ServerRegistry private constructor(context: Context) {

    data class RemoteServer(
        val id: String,
        val name: String,
        val baseUrl: String,
    )

    companion object {
        const val LOCAL_ID = "local"

        @Volatile
        private var instance: ServerRegistry? = null

        fun getInstance(context: Context): ServerRegistry {
            return instance ?: synchronized(this) {
                instance ?: ServerRegistry(context.applicationContext).also { instance = it }
            }
        }
    }

    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /** ipc 投影回来的本机状态；只驻留内存，权威状态每次启动重新拉。 */
    @Volatile
    private var localListen: String? = null

    @Volatile
    private var localInitialized: Boolean = false

    @Volatile
    private var localRunning: Boolean = false

    /** 由 ipc 的 `system.status` / `auth.whoami` 更新，必须在刷新服务器列表之前调用。 */
    fun updateLocalState(listen: String?, initialized: Boolean, running: Boolean) {
        localListen = listen
        localInitialized = initialized
        localRunning = running
    }

    /** 本机显示状态：未初始化 / 已安装且运行中 / 已初始化但已停止。 */
    fun localMode(): String = when {
        !localInitialized -> "uninitialized"
        localRunning -> "installed"
        else -> "stopped"
    }

    /**
     * 本机数据面地址。listen 可能是 `0.0.0.0:8091`，但 Android 上 serve 只该被回环访问，
     * 统一折成 `127.0.0.1`；端口仍然来自 ipc，避免壳和 config 各写一个。
     */
    fun localBaseUrl(): String? {
        val listen = localListen ?: return null
        val port = listen.substringAfterLast(':', "").toIntOrNull() ?: return null
        if (port !in 1..65535) {
            return null
        }
        return "http://127.0.0.1:$port"
    }

    fun selectedId(): String? {
        val stored = prefs.getString(KEY_SELECTED, null) ?: return null
        if (stored == LOCAL_ID) {
            return stored
        }
        if (remotes().any { it.id == stored }) {
            return stored
        }
        // 远程服务器被删/数据损坏时不要让 selectedId 悬空，下一次 ready() 让用户重选。
        prefs.edit().remove(KEY_SELECTED).apply()
        return null
    }

    fun select(serverId: String) {
        require(serverId == LOCAL_ID || remotes().any { it.id == serverId }) { "服务器不存在" }
        prefs.edit().putString(KEY_SELECTED, serverId).apply()
    }

    fun remotes(): List<RemoteServer> {
        val raw = prefs.getString(KEY_REMOTES, null) ?: return emptyList()
        val array = try {
            JSONArray(raw)
        } catch (_: JSONException) {
            Log.w(TAG, "远程服务器列表损坏，按空列表处理")
            return emptyList()
        }
        val result = ArrayList<RemoteServer>(array.length())
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            val id = item.optString("id", "")
            val baseUrl = item.optString("baseUrl", "")
            if (id.isEmpty() || baseUrl.isEmpty()) {
                continue
            }
            result.add(RemoteServer(id, item.optString("name", baseUrl), baseUrl))
        }
        return result
    }

    /**
     * 添加远程服务器：只收 https、去掉尾部斜杠、按 baseUrl 去重（重复添加返回已有条目，
     * 这样「测试连接后点添加」重试不会产生两个一样的服务器）。
     */
    fun addRemote(rawName: String?, rawBaseUrl: String): RemoteServer {
        val baseUrl = normalizeRemoteUrl(rawBaseUrl)
        val existing = remotes().firstOrNull { it.baseUrl == baseUrl }
        if (existing != null) {
            return existing
        }
        val parsed = requireNotNull(baseUrl.toHttpUrlOrNull())
        val name = rawName?.trim().takeUnless { it.isNullOrEmpty() } ?: defaultName(parsed.host, parsed.port)
        val server = RemoteServer(
            id = "remote-${UUID.randomUUID()}",
            name = name,
            baseUrl = baseUrl,
        )
        val updated = remotes() + server
        persistRemotes(updated)
        return server
    }

    /** 本机不是用户资产，不能删；由 ipc 管启停而不是从列表里移除。 */
    fun removeRemote(serverId: String) {
        require(serverId != LOCAL_ID) { "本机服务器不能删除" }
        val updated = remotes().filterNot { it.id == serverId }
        persistRemotes(updated)
        if (prefs.getString(KEY_SELECTED, null) == serverId) {
            prefs.edit().remove(KEY_SELECTED).apply()
        }
    }

    /** 返回该 id 的数据面根地址；本机地址未投影回来时返回 null。 */
    fun baseUrlOf(serverId: String): String? {
        if (serverId == LOCAL_ID) {
            return localBaseUrl()
        }
        return remotes().firstOrNull { it.id == serverId }?.baseUrl
    }

    /**
     * 解析并规范化远程地址。只允许 https：远程服务端在公网/局域网里，
     * 明文 HTTP 与「忽略证书」都不给入口，避免把登录 Cookie 暴露在链路上。
     */
    private fun normalizeRemoteUrl(raw: String): String {
        val trimmed = raw.trim().trimEnd('/')
        require(trimmed.isNotEmpty()) { "地址不能为空" }
        val url = trimmed.toHttpUrlOrNull() ?: throw IllegalArgumentException("地址格式不正确")
        require(url.scheme == "https") { "远程服务器必须使用 https" }
        require(url.username.isEmpty() && url.password.isEmpty()) { "地址里不能带用户名或密码" }
        require(url.query == null && url.fragment == null) { "地址不能带查询参数或片段" }
        // HttpUrl 会补默认端口，统一输出成去掉尾部斜杠的形式，便于按字符串去重。
        return trimmed
    }

    private fun defaultName(host: String, port: Int): String {
        return if (port == 443) host else "$host:$port"
    }

    private fun persistRemotes(servers: List<RemoteServer>) {
        val array = JSONArray()
        for (server in servers) {
            array.put(
                JSONObject()
                    .put("id", server.id)
                    .put("name", server.name)
                    .put("baseUrl", server.baseUrl)
            )
        }
        prefs.edit().putString(KEY_REMOTES, array.toString()).apply()
    }
}
