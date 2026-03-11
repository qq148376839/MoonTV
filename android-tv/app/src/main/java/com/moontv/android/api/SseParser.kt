package com.moontv.android.api

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.serialization.json.Json
import okhttp3.Response
import java.io.BufferedReader
import java.io.InputStreamReader

/**
 * Parses Server-Sent Events from an OkHttp response body into a Flow of SseMessage.
 */
object SseParser {

    private val json = Json { ignoreUnknownKeys = true }

    fun parse(response: Response): Flow<SseMessage> = flow {
        val body = response.body ?: return@flow
        val reader = BufferedReader(InputStreamReader(body.byteStream()))

        try {
            var line: String?
            while (reader.readLine().also { line = it } != null) {
                val l = line ?: continue
                if (l.startsWith("data:")) {
                    val data = l.removePrefix("data:").trim()
                    if (data.isNotEmpty()) {
                        try {
                            val message = json.decodeFromString<SseMessage>(data)
                            emit(message)
                            if (message.done) break
                        } catch (_: Exception) {
                            // Skip malformed JSON lines
                        }
                    }
                }
            }
        } finally {
            reader.close()
            body.close()
        }
    }.flowOn(Dispatchers.IO)
}
