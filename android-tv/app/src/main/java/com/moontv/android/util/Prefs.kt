package com.moontv.android.util

import android.content.Context
import android.content.SharedPreferences

object Prefs {
    const val PREFS_NAME = "moontv_prefs"
    const val KEY_SERVER_URL = "server_url"
    const val KEY_AUTH_COOKIE = "auth_cookie"

    private fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun getServerUrl(context: Context): String? =
        prefs(context).getString(KEY_SERVER_URL, null)?.takeIf { it.isNotBlank() }

    fun setServerUrl(context: Context, url: String) {
        prefs(context).edit().putString(KEY_SERVER_URL, url).apply()
    }

    fun getAuthCookie(context: Context): String? =
        prefs(context).getString(KEY_AUTH_COOKIE, null)?.takeIf { it.isNotBlank() }

    fun setAuthCookie(context: Context, cookie: String) {
        prefs(context).edit().putString(KEY_AUTH_COOKIE, cookie).apply()
    }

    fun clearAuth(context: Context) {
        prefs(context).edit().remove(KEY_AUTH_COOKIE).apply()
    }
}
