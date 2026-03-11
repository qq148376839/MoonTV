package com.moontv.android.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class SearchResult(
    val id: String = "",
    val title: String = "",
    val poster: String = "",
    val episodes: List<String> = emptyList(),
    val source: String = "",
    @SerialName("source_name") val sourceName: String = "",
    @SerialName("source_type") val sourceType: String = "",
    @SerialName("class") val category: String = "",
    val year: String = "",
    val desc: String = "",
    @SerialName("type_name") val typeName: String = "",
    @SerialName("douban_id") val doubanId: Long? = null
)

@Serializable
data class SseMessage(
    val results: List<SearchResult> = emptyList(),
    val done: Boolean = false,
    val source: String = "",
    @SerialName("source_name") val sourceName: String = ""
)

@Serializable
data class DoubanItem(
    val id: String = "",
    val title: String = "",
    val poster: String = "",
    val rate: String = "",
    val year: String = ""
)

@Serializable
data class DoubanResponse(
    val code: Int = 0,
    val message: String = "",
    val list: List<DoubanItem> = emptyList()
)

@Serializable
data class PlayRecord(
    val title: String = "",
    @SerialName("source_name") val sourceName: String = "",
    val cover: String = "",
    val year: String = "",
    val index: Int = 0,
    @SerialName("total_episodes") val totalEpisodes: Int = 0,
    @SerialName("play_time") val playTime: Double = 0.0,
    @SerialName("total_time") val totalTime: Double = 0.0,
    @SerialName("save_time") val saveTime: Long = 0L,
    @SerialName("search_title") val searchTitle: String = "",
    val source: String = "",
    val id: String = ""
)

@Serializable
data class Favorite(
    val title: String = "",
    @SerialName("source_name") val sourceName: String = "",
    @SerialName("total_episodes") val totalEpisodes: Int = 0,
    val year: String = "",
    val cover: String = "",
    @SerialName("save_time") val saveTime: Long = 0L,
    @SerialName("search_title") val searchTitle: String = ""
)

@Serializable
data class LoginRequest(
    val password: String,
    val username: String? = null
)

@Serializable
data class LoginResponse(
    val ok: Boolean = false,
    val error: String? = null
)

@Serializable
data class SavePlayRecordRequest(
    val key: String,
    val record: PlayRecord
)

@Serializable
data class SaveFavoriteRequest(
    val key: String,
    val favorite: Favorite
)

@Serializable
data class ApiSuccess(
    val success: Boolean = false
)
