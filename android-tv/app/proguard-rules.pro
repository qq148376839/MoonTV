# Keep JS bridge methods accessible from JavaScript
-keepclassmembers class com.moontv.android.MoonTvBridge {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep ExoPlayer classes
-keep class androidx.media3.** { *; }

# Keep WebView JS interface
-keepattributes JavascriptInterface

# Keep ZXing QR code classes
-keep class com.google.zxing.** { *; }
