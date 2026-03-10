package com.moontv.android

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.webkit.CookieManager
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class SettingsActivity : AppCompatActivity() {

    private lateinit var serverUrlInput: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        serverUrlInput = findViewById(R.id.serverUrlInput)
        val saveButton = findViewById<Button>(R.id.saveButton)
        val clearCacheButton = findViewById<Button>(R.id.clearCacheButton)

        // Load existing URL
        val prefs = getSharedPreferences(MoonTvBridge.PREFS_NAME, Context.MODE_PRIVATE)
        val existingUrl = prefs.getString(MoonTvBridge.KEY_SERVER_URL, "")
        serverUrlInput.setText(existingUrl)

        saveButton.setOnClickListener {
            val url = serverUrlInput.text.toString().trim().trimEnd('/')
            if (url.isEmpty()) {
                Toast.makeText(this, getString(R.string.server_url_required), Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            prefs.edit().putString(MoonTvBridge.KEY_SERVER_URL, url).apply()

            // Restart main activity
            val intent = Intent(this, MainActivity::class.java)
            intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            startActivity(intent)
            finish()
        }

        clearCacheButton.setOnClickListener {
            CookieManager.getInstance().removeAllCookies(null)
            Toast.makeText(this, getString(R.string.cache_cleared), Toast.LENGTH_SHORT).show()
        }

        // Focus on the input field for D-pad navigation
        serverUrlInput.requestFocus()
    }
}
