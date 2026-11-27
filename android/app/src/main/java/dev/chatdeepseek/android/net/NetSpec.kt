package dev.chatdeepseek.android.net

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets

/**
 * `netRequest` / `netStream` / `netDownload` / `netUpload` 的 specJson 解析结果。
 *
 * 形状以渲染层的 `src/mobile/bridge/types.ts` 为准（两边必须逐字对齐）：
 * - `serverId`：`string|null`；null 表示用当前选中的服务器（没有选中就 `no_server`）。
 * - `method`：GET/HEAD/POST/PUT/PATCH/DELETE。
 * - `url`：`/api/v1/...`（渲染层保持原样），origin 由壳按服务器 baseUrl 拼。
 * - `headers`：字符串到字符串；Cookie/Host/Content-Length/Accept-Encoding 由壳接管。
 * - `body`：`{kind:'text',text}` 或 `{kind:'bytes',base64}`；upload 没有 body。
 * - upload：`fields` 是 `[{name,value}]` 数组（保序、允许同名多值），
 *   `files` 是 `[{field,name,mime,size,tempId}]` 数组，文件内容已在 `fileBegin/fileChunk/fileEnd`
 *   落到临时文件，spec 里不出现 base64。
 *
 * `path`/`bodyBase64`/`file` 是对更早一版 spec 的兼容读法，新渲染层不会发。
 */
class NetSpec private constructor(
    val serverId: String?,
    val method: String,
    val url: String,
    val headers: Map<String, String>,
    val body: ByteArray?,
    val fields: List<Field>,
    val files: List<UploadRef>,
) {

    data class Field(val name: String, val value: String)

    data class UploadRef(
        val tempId: String,
        val field: String,
        val name: String,
        val mime: String,
    )

    companion object {
        private val ALLOWED_METHODS = setOf("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE")
        private const val DEFAULT_MIME = "application/octet-stream"

        fun parse(raw: JSONObject, defaultMethod: String): NetSpec {
            val method = raw.optString("method", defaultMethod).trim().uppercase()
            if (method !in ALLOWED_METHODS) {
                throw NetError("protocol", "不支持的 HTTP 方法: $method")
            }
            val url = raw.optString("url", "").trim().ifEmpty {
                // 兼容旧 spec 的 path 字段。
                raw.optString("path", "").trim()
            }
            if (url.isEmpty()) {
                throw NetError("protocol", "缺少 url")
            }
            val serverId = raw.optString("serverId", "").trim().ifEmpty { null }
            val headers = parseHeaders(raw.optJSONObject("headers"))
            val body = parseBody(raw)
            val fields = parseFields(raw.opt("fields"))
            val files = parseFiles(raw)
            return NetSpec(serverId, method, url, headers, body, fields, files)
        }

        private fun parseHeaders(raw: JSONObject?): Map<String, String> {
            if (raw == null) {
                return emptyMap()
            }
            val result = LinkedHashMap<String, String>(raw.length())
            val keys = raw.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                val value = raw.opt(key)
                if (value == null || value == JSONObject.NULL) {
                    continue
                }
                if (value !is String && value !is Number && value !is Boolean) {
                    throw NetError("protocol", "headers.$key 必须是字符串")
                }
                result[key] = value.toString()
            }
            return result
        }

        private fun parseBody(raw: JSONObject): ByteArray? {
            val body = raw.optJSONObject("body")
            if (body != null) {
                return when (body.optString("kind", "")) {
                    "text" -> body.optString("text", "").toByteArray(StandardCharsets.UTF_8)
                    "bytes" -> decodeBase64(body.optString("base64", ""))
                    else -> throw NetError("protocol", "body.kind 必须是 text 或 bytes")
                }
            }
            // 兼容旧 spec：bodyBase64。
            val legacy = raw.optString("bodyBase64", "")
            return if (legacy.isEmpty()) null else decodeBase64(legacy)
        }

        private fun decodeBase64(encoded: String): ByteArray {
            if (encoded.isEmpty()) {
                return ByteArray(0)
            }
            return try {
                Base64.decode(encoded, Base64.DEFAULT)
            } catch (_: IllegalArgumentException) {
                throw NetError("protocol", "请求体不是合法的 base64")
            }
        }

        private fun parseFields(raw: Any?): List<Field> {
            when (raw) {
                is JSONArray -> {
                    val result = ArrayList<Field>(raw.length())
                    for (index in 0 until raw.length()) {
                        val item = raw.optJSONObject(index)
                            ?: throw NetError("protocol", "fields[$index] 必须是对象")
                        val name = item.optString("name", "")
                        if (name.isEmpty()) {
                            throw NetError("protocol", "fields[$index].name 不能为空")
                        }
                        result.add(Field(name, item.optString("value", "")))
                    }
                    return result
                }
                // 兼容旧 spec 的对象形式；新渲染层发数组（保序，同名多值）。
                is JSONObject -> {
                    val result = ArrayList<Field>(raw.length())
                    val keys = raw.keys()
                    while (keys.hasNext()) {
                        val key = keys.next()
                        val value = raw.opt(key)
                        if (value == null || value == JSONObject.NULL) {
                            continue
                        }
                        result.add(Field(key, value.toString()))
                    }
                    return result
                }
                else -> return emptyList()
            }
        }

        private fun parseFiles(raw: JSONObject): List<UploadRef> {
            val array = raw.optJSONArray("files")
            if (array != null) {
                val result = ArrayList<UploadRef>(array.length())
                for (index in 0 until array.length()) {
                    val item = array.optJSONObject(index)
                        ?: throw NetError("protocol", "files[$index] 必须是对象")
                    result.add(parseUploadRef(item, index))
                }
                return result
            }
            val legacy = raw.optJSONObject("file") ?: return emptyList()
            return listOf(parseUploadRef(legacy, 0))
        }

        private fun parseUploadRef(item: JSONObject, index: Int): UploadRef {
            val tempId = item.optString("tempId", "").trim()
            if (tempId.isEmpty()) {
                throw NetError("protocol", "files[$index].tempId 不能为空")
            }
            return UploadRef(
                tempId = tempId,
                field = item.optString("field", "file").trim().ifEmpty { "file" },
                name = item.optString("name", "file").ifEmpty { "file" },
                mime = item.optString("mime", "").trim().ifEmpty { DEFAULT_MIME },
            )
        }
    }
}
