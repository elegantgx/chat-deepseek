# spike 的 release 也没开混淆（app/build.gradle.kts 里 isMinifyEnabled=false），
# 这里只固定一条以后一定会需要的规则：WebView 的 @JavascriptInterface 方法由反射调用，
# 被混淆后不会报错、只会静默失效，接壳时排查成本很高。
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
