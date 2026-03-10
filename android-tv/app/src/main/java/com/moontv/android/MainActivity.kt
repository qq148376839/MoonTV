@file:Suppress("DEPRECATION")

package com.moontv.android

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.http.SslError
import android.os.Bundle
import android.view.KeyEvent
import android.webkit.CookieManager
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var hasLoadError = false
    private var pageStarted = false

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

    private val settingsLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) {
        // After returning from settings, reload with new URL
        val prefs = getSharedPreferences(MoonTvBridge.PREFS_NAME, Context.MODE_PRIVATE)
        val serverUrl = prefs.getString(MoonTvBridge.KEY_SERVER_URL, null)
        if (!serverUrl.isNullOrBlank()) {
            hasLoadError = false
            webView.loadUrl("$serverUrl/tv")
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
        // Enable Chrome DevTools remote debugging via chrome://inspect
        WebView.setWebContentsDebuggingEnabled(true)
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

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                pageStarted = true
                hasLoadError = false
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                // Only handle main frame errors
                if (request?.isForMainFrame == true) {
                    hasLoadError = true
                    goToSettings(getString(R.string.connection_failed))
                }
            }

            @SuppressLint("WebViewClientOnReceivedSslError")
            override fun onReceivedSslError(
                view: WebView?,
                handler: SslErrorHandler?,
                error: SslError?
            ) {
                // Allow self-signed certs on local network
                handler?.proceed()
            }

            override fun onReceivedHttpError(
                view: WebView?,
                request: WebResourceRequest?,
                errorResponse: android.webkit.WebResourceResponse?
            ) {
                super.onReceivedHttpError(view, request, errorResponse)
                if (request?.isForMainFrame == true) {
                    val statusCode = errorResponse?.statusCode ?: 0
                    if (statusCode >= 500) {
                        hasLoadError = true
                        goToSettings(getString(R.string.server_error, statusCode))
                    }
                }
            }
        }

        webView.webChromeClient = WebChromeClient()
    }

    private fun goToSettings(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
        val intent = Intent(this, SettingsActivity::class.java)
        intent.putExtra(SettingsActivity.EXTRA_ERROR_MESSAGE, message)
        settingsLauncher.launch(intent)
    }

    fun launchPlayer(intent: Intent) {
        playerLauncher.launch(intent)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        // Menu button or long-press back → open settings
        if (keyCode == KeyEvent.KEYCODE_MENU) {
            settingsLauncher.launch(Intent(this, SettingsActivity::class.java))
            return true
        }
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
