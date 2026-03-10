package com.moontv.android

import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import java.net.Inet4Address
import java.net.NetworkInterface

class SettingsActivity : AppCompatActivity() {

    private lateinit var serverUrlInput: EditText
    private var setupServer: SetupServer? = null
    private val handler = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        serverUrlInput = findViewById(R.id.serverUrlInput)
        val saveButton = findViewById<Button>(R.id.saveButton)
        val clearCacheButton = findViewById<Button>(R.id.clearCacheButton)
        val qrImageView = findViewById<ImageView>(R.id.qrCodeImage)
        val qrHintText = findViewById<TextView>(R.id.qrHintText)

        // Load existing URL
        val prefs = getSharedPreferences(MoonTvBridge.PREFS_NAME, Context.MODE_PRIVATE)
        val existingUrl = prefs.getString(MoonTvBridge.KEY_SERVER_URL, "")
        serverUrlInput.setText(existingUrl)

        // Show error message if coming from connection failure
        val errorMsg = intent.getStringExtra(EXTRA_ERROR_MESSAGE)
        if (!errorMsg.isNullOrBlank()) {
            Toast.makeText(this, errorMsg, Toast.LENGTH_LONG).show()
        }

        // Start setup server and show QR code
        val localIp = getLocalIpAddress()
        if (localIp != null) {
            setupServer = SetupServer { url ->
                handler.post {
                    saveUrlAndRestart(url)
                }
            }
            setupServer!!.start()
            val setupUrl = "http://$localIp:${setupServer!!.port}/setup"
            val qrBitmap = QrCodeGenerator.generate(setupUrl, 10)
            qrImageView.setImageBitmap(qrBitmap)
            qrHintText.text = getString(R.string.qr_scan_hint, setupUrl)
        } else {
            qrHintText.text = getString(R.string.qr_no_network)
        }

        saveButton.setOnClickListener {
            val url = serverUrlInput.text.toString().trim().trimEnd('/')
            if (url.isEmpty()) {
                Toast.makeText(this, getString(R.string.server_url_required), Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            saveUrlAndRestart(url)
        }

        clearCacheButton.setOnClickListener {
            CookieManager.getInstance().removeAllCookies(null)
            Toast.makeText(this, getString(R.string.cache_cleared), Toast.LENGTH_SHORT).show()
        }

        // Focus on the input field for D-pad navigation
        serverUrlInput.requestFocus()
    }

    private fun saveUrlAndRestart(url: String) {
        val prefs = getSharedPreferences(MoonTvBridge.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(MoonTvBridge.KEY_SERVER_URL, url).apply()
        Toast.makeText(this, getString(R.string.url_saved, url), Toast.LENGTH_SHORT).show()

        // Restart main activity
        val intent = Intent(this, MainActivity::class.java)
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        startActivity(intent)
        finish()
    }

    @Suppress("DEPRECATION")
    private fun getLocalIpAddress(): String? {
        // Try WifiManager first (most reliable on Android TV)
        try {
            val wifiManager = applicationContext.getSystemService(WIFI_SERVICE) as WifiManager
            val wifiInfo = wifiManager.connectionInfo
            val ip = wifiInfo.ipAddress
            if (ip != 0) {
                return String.format(
                    "%d.%d.%d.%d",
                    ip and 0xff, ip shr 8 and 0xff,
                    ip shr 16 and 0xff, ip shr 24 and 0xff
                )
            }
        } catch (_: Exception) {}

        // Fallback: enumerate network interfaces
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            while (interfaces.hasMoreElements()) {
                val intf = interfaces.nextElement()
                if (intf.isLoopback || !intf.isUp) continue
                val addrs = intf.inetAddresses
                while (addrs.hasMoreElements()) {
                    val addr = addrs.nextElement()
                    if (addr is Inet4Address && !addr.isLoopbackAddress) {
                        return addr.hostAddress
                    }
                }
            }
        } catch (_: Exception) {}

        return null
    }

    override fun onDestroy() {
        setupServer?.stop()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_ERROR_MESSAGE = "error_message"
    }
}
