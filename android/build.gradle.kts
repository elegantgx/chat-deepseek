// 插件版本集中声明：版本号只在这里出现，:app 里只 apply id，避免两个模块各写一份后漂移。
// 版本与 docs/android-architecture.md §8 固定的一致；升级要单独验证 AGP/Kotlin/Gradle 三者兼容。
plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
}
