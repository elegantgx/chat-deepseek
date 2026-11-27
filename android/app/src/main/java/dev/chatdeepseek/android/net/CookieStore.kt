package dev.chatdeepseek.android.net

import android.content.Context
import android.util.Log
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.util.concurrent.ConcurrentHashMap

private const val TAG = "CookieStore"
private const val PREFS_NAME = "chat_deepseek_shell_secure"
private const val KEY_PREFIX = "cookies."

/**
 * 按 `serverId` 分桶的 Cookie 存储：每个服务器一份，互不串味。
 *
 * 落盘值整体用 [SecretBox] 加密后再进 SharedPreferences，**任何情况下都不写明文**；
 * 加密不可用时只保留内存态（本次进程有效），而不是退回明文持久化。
 * 渲染层拿不到 Cookie：CookieJar 只在壳的 OkHttp 客户端里，响应头里的 `Set-Cookie` 也会被剥掉。
 */
class CookieStore private constructor(context: Context) {

    companion object {
        @Volatile
        private var instance: CookieStore? = null

        fun getInstance(context: Context): CookieStore {
            return instance ?: synchronized(this) {
                instance ?: CookieStore(context.applicationContext).also { instance = it }
            }
        }
    }

    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /** 内存缓存先于 SharedPreferences 生效，避免每次请求都做一次 Keystore 解密。 */
    private val cache = ConcurrentHashMap<String, List<Cookie>>()

    /** 每个服务器一个 CookieJar 实例，但真正的读写都收敛在这里，便于按服务器清理。 */
    fun jar(serverId: String): CookieJar = PersistentCookieJar(this, serverId)

    fun load(serverId: String, url: HttpUrl): List<Cookie> {
        synchronized(this) {
            val stored = read(serverId)
            val now = System.currentTimeMillis()
            val kept = ArrayList<Cookie>(stored.size)
            val matching = ArrayList<Cookie>(stored.size)
            var changed = false
            for (cookie in stored) {
                if (cookie.expiresAt > 0 && cookie.expiresAt <= now) {
                    // 过期 Cookie 只在该服务器桶里清，不按当前 url 过滤，否则会把别的 host 的 Cookie 一起删掉。
                    changed = true
                    continue
                }
                kept.add(cookie)
                if (cookie.matches(url)) {
                    matching.add(cookie)
                }
            }
            if (changed) {
                write(serverId, kept)
            }
            return matching
        }
    }

    fun save(serverId: String, url: HttpUrl, cookies: List<Cookie>) {
        if (cookies.isEmpty()) {
            return
        }
        synchronized(this) {
            val now = System.currentTimeMillis()
            val merged = read(serverId).toMutableList()
            for (incoming in cookies) {
                // 同 name+domain+path 是同一个逻辑 Cookie，后者覆盖前者；这是 RFC 6265 的覆盖语义。
                merged.removeAll { existing ->
                    existing.name == incoming.name &&
                        existing.domain == incoming.domain &&
                        existing.path == incoming.path
                }
                if (incoming.expiresAt <= 0 || incoming.expiresAt > now) {
                    merged.add(incoming)
                }
            }
            write(serverId, merged.filter { it.expiresAt <= 0 || it.expiresAt > now })
        }
    }

    /** 删除服务器时连带清掉它的 Cookie，避免「删了远程服务器但登录态还留在磁盘上」。 */
    fun clear(serverId: String) {
        synchronized(this) {
            cache.remove(serverId)
            prefs.edit().remove(KEY_PREFIX + serverId).apply()
        }
    }

    private fun read(serverId: String): List<Cookie> {
        cache[serverId]?.let { return it }
        val key = KEY_PREFIX + serverId
        val token = prefs.getString(key, null) ?: return emptyList()
        val plain = SecretBox.open(token)
        if (plain == null) {
            // 解不开说明密钥被系统清了或数据损坏；直接删桶，按「登录态丢失」处理。
            prefs.edit().remove(key).apply()
            return emptyList()
        }
        val cookies = try {
            decode(JSONArray(String(plain, StandardCharsets.UTF_8)))
        } catch (_: JSONException) {
            prefs.edit().remove(key).apply()
            emptyList()
        }
        cache[serverId] = cookies
        return cookies
    }

    private fun write(serverId: String, cookies: List<Cookie>) {
        cache[serverId] = cookies
        val key = KEY_PREFIX + serverId
        if (cookies.isEmpty()) {
            prefs.edit().remove(key).apply()
            return
        }
        val encoded = encode(cookies).toString().toByteArray(StandardCharsets.UTF_8)
        val sealed = SecretBox.seal(encoded)
        if (sealed == null) {
            // 加密不可用时宁可这次进程内保留内存态，也不把 Cookie 明文写到磁盘。
            Log.w(TAG, "无法加密 Cookie，本次会话不持久化（$serverId）")
            return
        }
        prefs.edit().putString(key, sealed).apply()
    }

    private fun encode(cookies: List<Cookie>): JSONArray {
        val array = JSONArray()
        for (cookie in cookies) {
            val item = JSONObject()
                .put("name", cookie.name)
                .put("value", cookie.value)
                .put("domain", cookie.domain)
                .put("path", cookie.path)
                .put("secure", cookie.secure)
                .put("httpOnly", cookie.httpOnly)
                .put("hostOnly", cookie.hostOnly)
            // 会话 Cookie 的 expiresAt 是哨兵值（Long.MIN_VALUE），落盘时不写，恢复时也不设置。
            if (cookie.expiresAt > 0) {
                item.put("expiresAt", cookie.expiresAt)
            }
            array.put(item)
        }
        return array
    }

    private fun decode(array: JSONArray): List<Cookie> {
        val cookies = ArrayList<Cookie>(array.length())
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            val name = item.optString("name", "")
            val domain = item.optString("domain", "")
            val path = item.optString("path", "/").ifEmpty { "/" }
            if (name.isEmpty() || domain.isEmpty()) {
                continue
            }
            try {
                val builder = Cookie.Builder()
                    .name(name)
                    .value(item.optString("value", ""))
                    .path(path)
                if (item.optBoolean("hostOnly", true)) {
                    builder.hostOnlyDomain(domain)
                } else {
                    builder.domain(domain)
                }
                val expiresAt = item.optLong("expiresAt", 0L)
                if (expiresAt > 0) {
                    builder.expiresAt(expiresAt)
                }
                if (item.optBoolean("secure", false)) {
                    builder.secure()
                }
                if (item.optBoolean("httpOnly", false)) {
                    builder.httpOnly()
                }
                cookies.add(builder.build())
            } catch (_: IllegalArgumentException) {
                // 单条无效（域名/路径非法）只跳过它，不能让整桶 Cookie 丢掉。
                Log.w(TAG, "跳过一条无效的持久化 Cookie")
            }
        }
        return cookies
    }

    private class PersistentCookieJar(
        private val store: CookieStore,
        private val serverId: String,
    ) : CookieJar {
        override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
            store.save(serverId, url, cookies)
        }

        override fun loadForRequest(url: HttpUrl): List<Cookie> = store.load(serverId, url)
    }
}
