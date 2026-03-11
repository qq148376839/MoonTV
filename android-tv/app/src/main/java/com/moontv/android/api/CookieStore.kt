package com.moontv.android.api

import android.content.Context
import com.moontv.android.util.Prefs
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

/**
 * OkHttp CookieJar that persists the auth cookie to SharedPreferences.
 */
class CookieStore(private val context: Context) : CookieJar {

    private val memoryStore = mutableMapOf<String, MutableList<Cookie>>()

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val host = url.host
        val list = memoryStore.getOrPut(host) { mutableListOf() }

        for (cookie in cookies) {
            // Remove existing cookie with same name
            list.removeAll { it.name == cookie.name }
            list.add(cookie)

            // Persist auth cookie
            if (cookie.name == "auth") {
                Prefs.setAuthCookie(context, cookie.value)
            }
        }
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val host = url.host
        val list = memoryStore.getOrPut(host) { mutableListOf() }

        // If no auth cookie in memory, restore from prefs
        if (list.none { it.name == "auth" }) {
            val saved = Prefs.getAuthCookie(context)
            if (saved != null) {
                val cookie = Cookie.Builder()
                    .name("auth")
                    .value(saved)
                    .domain(host)
                    .path("/")
                    .build()
                list.add(cookie)
            }
        }

        // Remove expired cookies
        val now = System.currentTimeMillis()
        list.removeAll { it.expiresAt < now }

        return list.toList()
    }

    fun hasAuthCookie(): Boolean {
        return Prefs.getAuthCookie(context) != null
    }

    fun clearAuth() {
        Prefs.clearAuth(context)
        for (list in memoryStore.values) {
            list.removeAll { it.name == "auth" }
        }
    }
}
