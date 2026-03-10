package com.moontv.android

import android.content.Context
import android.content.Intent
import android.webkit.JavascriptInterface

/**
 * JavaScript bridge exposed to the WebView as `window.MoonTvBridge`.
 */
class MoonTvBridge(private val context: Context) {

    @JavascriptInterface
    fun playVideo(url: String, title: String, subtitle: String) {
        val intent = Intent(context, PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_URL, url)
            putExtra(PlayerActivity.EXTRA_TITLE, title)
            putExtra(PlayerActivity.EXTRA_SUBTITLE, subtitle)
        }
        // Launch from Activity context
        if (context is MainActivity) {
            context.launchPlayer(intent)
        }
    }

    @JavascriptInterface
    fun isAndroidTv(): Boolean = true

    @JavascriptInterface
    fun getServerUrl(): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_SERVER_URL, "") ?: ""
    }

    companion object {
        const val BRIDGE_NAME = "MoonTvBridge"
        const val PREFS_NAME = "moontv_prefs"
        const val KEY_SERVER_URL = "server_url"
    }
}
