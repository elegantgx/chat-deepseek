plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Android 工程在 <repo>/android，Go 源码在仓库根；Gradle 任务要回到根目录才能执行 go build。
val repoRoot: File = rootProject.projectDir.parentFile

// 仓库里还没有 dist-mobile/ 时的兜底页面。它只负责证明「assets 真的进了 APK、WebView 真的能载入」，
// spike 的进程结果由 MainActivity 显示在原生 TextView 与 logcat 里，不经过这页。
// 写成常量并登记为任务输入，改这段文案时 Gradle 会重新生成，而不是被 up-to-date 跳过。
val spikePageHtml = """
    <!doctype html>
    <html lang="zh-CN">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Chat DeepSeek Android Spike</title>
      <style>
        :root { color-scheme: light dark; }
        body { margin: 0; padding: 24px; font: 14px/1.6 system-ui, sans-serif; }
        h1 { font-size: 18px; margin: 0 0 12px; }
        code { font-family: ui-monospace, monospace; }
      </style>
    </head>
    <body>
      <h1>Chat DeepSeek Android Spike</h1>
      <p>assets 已加载：<code>file:///android_asset/index.html</code></p>
      <p>Go 子进程的 version 与 ipc system.status 结果显示在下方原生 TextView，同时以 SPIKE 前缀写 logcat。</p>
      <p id="ua"></p>
      <script>
        document.getElementById('ua').textContent = navigator.userAgent
      </script>
    </body>
    </html>
""".trimIndent()

android {
    namespace = "dev.chatdeepseek.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.chatdeepseek.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        // 跟仓库根 package.json 的版本保持一致，避免 Android 包出现一个自造的版本号；
        // spike 阶段 versionCode 固定 1，正式发版再按渠道规则推进。
        versionName = "0.1.5-official0.1.4"
    }

    buildTypes {
        release {
            // spike 只出 debug 包；release 也先不开混淆，省掉为验证包维护 keep 规则的麻烦。
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    // Go 二进制只是改了后缀进 jniLibs，要能从 nativeLibraryDir 直接 exec，就必须让安装器把它解压出来。
    // extractNativeLibs 在 Manifest 里显式写 true，这里再用 legacy packaging 让 AGP 真的压缩并解压；
    // 只写其中一处时，AGP 8 的默认行为可能把 .so 以未压缩方式留在 APK 里，nativeLibraryDir 就是空的。
    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }

    sourceSets {
        getByName("main") {
            // 目录由 prepareMobileAssets 生成：有 dist-mobile/ 就同步 mobile Web，没有就写 spike 页面。
            assets.srcDir(layout.buildDirectory.dir("generated/assets"))
        }
    }
}

dependencies {
    // 依赖先按 docs/android-architecture.md §4 的壳层需要配齐，spike 本身只用到 WebView。
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.browser:browser:1.8.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}

// Go 交叉编译。产物命名成 libchatd.so 不是因为它真的是 JNI 库，而是为了让 AGP 按 native lib 规则
// 收进 APK 并在安装时解压到 applicationInfo.nativeLibraryDir；运行时是 exec 它，不是 System.loadLibrary。
// GOOS=android 且 CGO_ENABLED=0：modernc 的纯 Go sqlite 使产物不依赖 NDK，避免为 spike 引入工具链。
val goBinary = layout.projectDirectory.file("src/main/jniLibs/arm64-v8a/libchatd.so").asFile
val buildGoArm64 = tasks.register<Exec>("buildGoArm64") {
    group = "build"
    description = "交叉编译 Go ipc 二进制到 jniLibs/arm64-v8a/libchatd.so"
    workingDir = repoRoot
    commandLine(
        "go",
        "build",
        "-trimpath",
        "-ldflags",
        "-s -w",
        "-o",
        goBinary.absolutePath,
        "./cmd/chat-deepseek",
    )
    environment("GOOS", "android")
    environment("GOARCH", "arm64")
    environment("CGO_ENABLED", "0")
    // go build 不会创建输出目录，而 jniLibs 是生成物、不进版本库，CI 首次构建时目录不存在。
    doFirst {
        goBinary.parentFile.mkdirs()
    }
    // 只把真正影响产物的 Go 输入登记为输入，避免每次改文档/前端也重编 Go。
    inputs.file(repoRoot.resolve("go.mod"))
    inputs.file(repoRoot.resolve("go.sum"))
    inputs.dir(repoRoot.resolve("cmd"))
    inputs.dir(repoRoot.resolve("internal"))
    outputs.file(goBinary)
}

val prepareMobileAssets = tasks.register("prepareMobileAssets") {
    group = "build"
    description = "把 dist-mobile/ 同步为 APK assets；没有前端产物时生成 spike 页面"
    val outputDir = layout.buildDirectory.dir("generated/assets")
    val mobileDist = repoRoot.resolve("dist-mobile")
    inputs.property("mobileDistPath", mobileDist.absolutePath)
    inputs.property("mobileDistExists", mobileDist.isDirectory)
    inputs.property("spikePageHtml", spikePageHtml)
    if (mobileDist.isDirectory) {
        // 只声明本次真实存在的文件；dist-mobile/ 由 pnpm build:mobile 生成，CI 里通常没有。
        inputs.files(fileTree(mobileDist))
    }
    outputs.dir(outputDir)
    doLast {
        val out = outputDir.get().asFile
        out.deleteRecursively()
        out.mkdirs()
        if (mobileDist.isDirectory) {
            mobileDist.copyRecursively(out, overwrite = true)
        } else {
            out.resolve("index.html").writeText(spikePageHtml, Charsets.UTF_8)
        }
    }
}

// 两个生成任务都必须在 AGP 收集资源/资产之前完成；preBuild 是所有构建变体的共同前置。
tasks.named("preBuild") {
    dependsOn(buildGoArm64, prepareMobileAssets)
}
