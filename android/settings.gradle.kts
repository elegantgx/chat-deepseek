// 单模块工程：壳层以后都在 :app 里，不拆 library，避免早期为共享代码维护两套变体。
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    // 依赖仓库只在 settings 里声明，模块里再加仓库会直接失败，避免不同机器解析到不同来源。
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "chat-deepseek-android"
include(":app")
