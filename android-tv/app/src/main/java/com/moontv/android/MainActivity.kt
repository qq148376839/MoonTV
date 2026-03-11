package com.moontv.android

import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import androidx.fragment.app.FragmentActivity
import com.moontv.android.api.ApiClient
import com.moontv.android.ui.HomeFragment
import com.moontv.android.ui.LoginFragment
import com.moontv.android.util.Prefs

class MainActivity : FragmentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Check if server URL is configured
        val serverUrl = Prefs.getServerUrl(this)
        if (serverUrl.isNullOrBlank()) {
            startActivity(Intent(this, SettingsActivity::class.java))
            finish()
            return
        }

        if (savedInstanceState == null) {
            val api = ApiClient.getInstance(this)
            val fragment = if (api.cookieStore.hasAuthCookie()) {
                HomeFragment()
            } else {
                LoginFragment()
            }

            supportFragmentManager.beginTransaction()
                .replace(R.id.fragmentContainer, fragment)
                .commit()
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        // Menu button → open settings
        if (keyCode == KeyEvent.KEYCODE_MENU) {
            startActivity(Intent(this, SettingsActivity::class.java))
            return true
        }
        return super.onKeyDown(keyCode, event)
    }
}
