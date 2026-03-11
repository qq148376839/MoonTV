# Keep ExoPlayer classes
-keep class androidx.media3.** { *; }

# Keep ZXing QR code classes
-keep class com.google.zxing.** { *; }

# Keep kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt

-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}

-keep,includedescriptorclasses class com.moontv.android.api.**$$serializer { *; }
-keepclassmembers class com.moontv.android.api.** {
    *** Companion;
}
-keepclasseswithmembers class com.moontv.android.api.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Keep OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }

# Keep Coil
-keep class coil.** { *; }

