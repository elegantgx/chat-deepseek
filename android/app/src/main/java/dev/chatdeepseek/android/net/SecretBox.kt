package dev.chatdeepseek.android.net

import android.util.Log
import android.util.Base64
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.IOException
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private const val TAG = "SecretBox"
private const val KEY_ALIAS = "chat-deepseek-shell-cookies"
private const val KEYSTORE = "AndroidKeyStore"
private const val TRANSFORMATION = "AES/GCM/NoPadding"
private const val IV_BYTES = 12
private const val GCM_TAG_BITS = 128

/**
 * 用 AndroidKeyStore 里的 AES-256-GCM 密钥给 Cookie 做本地加密。
 *
 * 为什么不引 `androidx.security:security-crypto`：这里只需要「加密一个字符串再解回来」，
 * 几十行就能说清密钥生成、IV 与认证标签的位置；多一个依赖还要处理它的迁移/备份语义。
 *
 * 密钥不可导出、跟着应用签名与设备走。密钥失效（例如系统重置锁屏导致 Keystore 清空）时
 * 解密会失败，调用方按「登录态丢了」处理——Cookie 是可重建状态，宁可不持久化也不能写明文。
 */
internal object SecretBox {

    fun seal(plain: ByteArray): String? {
        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, key())
            val ciphertext = cipher.doFinal(plain)
            val iv = cipher.iv
            // 打包成 iv || ciphertext，GCM 的 IV 每次加密都会新生成，必须随密文一起存。
            val packed = ByteArray(iv.size + ciphertext.size)
            System.arraycopy(iv, 0, packed, 0, iv.size)
            System.arraycopy(ciphertext, 0, packed, iv.size, ciphertext.size)
            Base64.encodeToString(packed, Base64.NO_WRAP)
        } catch (error: GeneralSecurityException) {
            Log.w(TAG, "加密 Cookie 失败: ${error.javaClass.simpleName}")
            null
        } catch (error: IOException) {
            Log.w(TAG, "打开 AndroidKeyStore 失败: ${error.javaClass.simpleName}")
            null
        }
    }

    fun open(token: String): ByteArray? {
        return try {
            val packed = Base64.decode(token, Base64.NO_WRAP)
            if (packed.size <= IV_BYTES) {
                return null
            }
            val iv = packed.copyOfRange(0, IV_BYTES)
            val ciphertext = packed.copyOfRange(IV_BYTES, packed.size)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(GCM_TAG_BITS, iv))
            cipher.doFinal(ciphertext)
        } catch (error: GeneralSecurityException) {
            // 认证标签不匹配/密钥被清空都走这里；返回 null 让上层删掉坏数据、重新登录。
            Log.w(TAG, "解密 Cookie 失败: ${error.javaClass.simpleName}")
            null
        } catch (error: IllegalArgumentException) {
            Log.w(TAG, "Cookie 密文格式无效")
            null
        } catch (error: IOException) {
            // Keystore 在少数设备上会抛 IOException（初始化失败/被系统清空）。
            Log.w(TAG, "打开 AndroidKeyStore 失败: ${error.javaClass.simpleName}")
            null
        }
    }

    private fun key(): SecretKey = synchronized(this) {
        val keyStore = KeyStore.getInstance(KEYSTORE)
        keyStore.load(null)
        val existing = keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry
        existing?.secretKey ?: generateKey()
    }

    private fun generateKey(): SecretKey {
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }
}
