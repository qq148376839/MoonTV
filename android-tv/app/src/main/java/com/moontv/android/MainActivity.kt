@file:Suppress("DEPRECATION")

package com.moontv.android

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    private val playerLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val currentTime = result.data?.getDoubleExtra(PlayerActivity.RESULT_CURRENT_TIME, 0.0) ?: 0.0
            val duration = result.data?.getDoubleExtra(PlayerActivity.RESULT_DURATION, 0.0) ?: 0.0
            // Call back into JavaScript
            webView.post {
                webView.evaluateJavascript(
                    "if(window.onNativePlaybackEnd) window.onNativePlaybackEnd($currentTime, $duration);",
                    null
                )
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)

        // Check if server URL is configured
        val prefs = getSharedPreferences(MoonTvBridge.PREFS_NAME, Context.MODE_PRIVATE)
        val serverUrl = prefs.getString(MoonTvBridge.KEY_SERVER_URL, null)

        if (serverUrl.isNullOrBlank()) {
            startActivity(Intent(this, SettingsActivity::class.java))
            finish()
            return
        }

        setupWebView()
        webView.loadUrl("$serverUrl/tv")
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        // Enable cookies
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            loadWithOverviewMode = true
            useWideViewPort = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            userAgentString = "${userAgentString} MoonTV-Android/1.0"
        }

        // Add JS bridge
        webView.addJavascriptInterface(MoonTvBridge(this), MoonTvBridge.BRIDGE_NAME)

        webView.webViewClient = WebViewClient()
        webView.webChromeClient = WebChromeClient()
    }

    fun launchPlayer(intent: Intent) {
        playerLauncher.launch(intent)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        // Handle back button - go back in WebView history first
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }
}
