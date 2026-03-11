package com.moontv.android.api

import android.content.Context
import com.moontv.android.util.Prefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/**
 * Singleton API client wrapping OkHttp for all MoonTV server calls.
 */
class ApiClient private constructor(context: Context) {

    private val appContext = context.applicationContext
    val cookieStore = CookieStore(appContext)

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    private val client = OkHttpClient.Builder()
        .cookieJar(cookieStore)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    private val sseClient = OkHttpClient.Builder()
        .cookieJar(cookieStore)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    private fun baseUrl(): String =
        Prefs.getServerUrl(appContext) ?: throw IllegalStateException("Server URL not configured")

    // --- Auth ---

    suspend fun login(password: String, username: String? = null): LoginResponse = withContext(Dispatchers.IO) {
        val body = json.encodeToString(
            LoginRequest.serializer(),
            LoginRequest(password = password, username = username)
        )
        val request = Request.Builder()
            .url("${baseUrl()}/api/login")
            .post(body.toRequestBody(jsonMediaType))
            .build()

        val response = client.newCall(request).execute()
        val responseBody = response.body?.string() ?: "{}"
        json.decodeFromString<LoginResponse>(responseBody)
    }

    // --- Search ---

    suspend fun searchStream(query: String): Flow<SseMessage> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("${baseUrl()}/api/search/stream?q=${java.net.URLEncoder.encode(query, "UTF-8")}")
            .header("Accept", "text/event-stream")
            .build()

        val response = sseClient.newCall(request).execute()
        SseParser.parse(response)
    }

    // --- Douban ---

    suspend fun getDoubanCategories(
        kind: String,
        category: String,
        type: String,
        limit: Int = 20,
        start: Int = 0
    ): List<DoubanItem> = withContext(Dispatchers.IO) {
        val url = "${baseUrl()}/api/douban/categories?kind=$kind&category=" +
                "${java.net.URLEncoder.encode(category, "UTF-8")}" +
                "&type=${java.net.URLEncoder.encode(type, "UTF-8")}" +
                "&limit=$limit&start=$start"
        val request = Request.Builder().url(url).build()
        val response = client.newCall(request).execute()
        val body = response.body?.string() ?: "{}"
        val result = json.decodeFromString<DoubanResponse>(body)
        result.list
    }

    // --- Detail ---

    suspend fun getDetail(source: String, id: String): SearchResult = withContext(Dispatchers.IO) {
        val url = "${baseUrl()}/api/detail?source=" +
                "${java.net.URLEncoder.encode(source, "UTF-8")}" +
                "&id=${java.net.URLEncoder.encode(id, "UTF-8")}"
        val request = Request.Builder().url(url).build()
        val response = client.newCall(request).execute()
        val body = response.body?.string() ?: "{}"
        json.decodeFromString<SearchResult>(body)
    }

    // --- Play Records ---

    suspend fun getPlayRecords(): Map<String, PlayRecord> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("${baseUrl()}/api/playrecords")
            .build()
        val response = client.newCall(request).execute()
        val body = response.body?.string() ?: "{}"
        val obj = json.decodeFromString<JsonObject>(body)
        obj.mapValues { (_, value) ->
            json.decodeFromJsonElement<PlayRecord>(value)
        }
    }

    suspend fun savePlayRecord(key: String, record: PlayRecord): Boolean = withContext(Dispatchers.IO) {
        val body = json.encodeToString(
            SavePlayRecordRequest.serializer(),
            SavePlayRecordRequest(key = key, record = record)
        )
        val request = Request.Builder()
            .url("${baseUrl()}/api/playrecords")
            .post(body.toRequestBody(jsonMediaType))
            .build()
        val response = client.newCall(request).execute()
        response.isSuccessful
    }

    // --- Favorites ---

    suspend fun getFavorites(): Map<String, Favorite> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("${baseUrl()}/api/favorites")
            .build()
        val response = client.newCall(request).execute()
        val body = response.body?.string() ?: "{}"
        val obj = json.decodeFromString<JsonObject>(body)
        obj.mapValues { (_, value) ->
            json.decodeFromJsonElement<Favorite>(value)
        }
    }

    suspend fun saveFavorite(key: String, favorite: Favorite): Boolean = withContext(Dispatchers.IO) {
        val body = json.encodeToString(
            SaveFavoriteRequest.serializer(),
            SaveFavoriteRequest(key = key, favorite = favorite)
        )
        val request = Request.Builder()
            .url("${baseUrl()}/api/favorites")
            .post(body.toRequestBody(jsonMediaType))
            .build()
        val response = client.newCall(request).execute()
        response.isSuccessful
    }

    suspend fun deleteFavorite(key: String): Boolean = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("${baseUrl()}/api/favorites?key=${java.net.URLEncoder.encode(key, "UTF-8")}")
            .delete()
            .build()
        val response = client.newCall(request).execute()
        response.isSuccessful
    }

    companion object {
        @Volatile
        private var instance: ApiClient? = null

        fun getInstance(context: Context): ApiClient {
            return instance ?: synchronized(this) {
                instance ?: ApiClient(context.applicationContext).also { instance = it }
            }
        }
    }
}
