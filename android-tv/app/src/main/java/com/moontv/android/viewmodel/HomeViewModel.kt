package com.moontv.android.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.moontv.android.api.ApiClient
import com.moontv.android.api.DoubanItem
import com.moontv.android.api.PlayRecord
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class HomeViewModel(app: Application) : AndroidViewModel(app) {

    private val api = ApiClient.getInstance(app)

    private val _state = MutableStateFlow(HomeState())
    val state: StateFlow<HomeState> = _state

    /** Cached Douban titles for pinyin search dictionary */
    val doubanTitleCache = mutableListOf<String>()

    fun loadAll() {
        _state.value = _state.value.copy(loading = true)
        loadPlayRecords()
        loadDoubanRow("hotMovies", "movie", "热门", "全部")
        loadDoubanRow("hotTv", "tv", "热门", "全部")
        loadDoubanRow("hotVariety", "tv", "综艺", "全部")
    }

    private fun loadPlayRecords() {
        viewModelScope.launch {
            try {
                val records = api.getPlayRecords()
                // Sort by save_time descending
                val sorted = records.entries
                    .sortedByDescending { it.value.saveTime }
                    .associate { it.key to it.value }
                _state.value = _state.value.copy(playRecords = sorted, loading = false)
            } catch (_: Exception) {
                _state.value = _state.value.copy(loading = false)
            }
        }
    }

    private fun loadDoubanRow(field: String, kind: String, category: String, type: String) {
        viewModelScope.launch {
            try {
                val items = api.getDoubanCategories(kind, category, type, limit = 20)
                // Cache titles for pinyin search
                doubanTitleCache.addAll(items.map { it.title })

                _state.value = when (field) {
                    "hotMovies" -> _state.value.copy(hotMovies = items)
                    "hotTv" -> _state.value.copy(hotTv = items)
                    "hotVariety" -> _state.value.copy(hotVariety = items)
                    else -> _state.value
                }
            } catch (_: Exception) {
                // Silent fail
            }
        }
    }
}

data class HomeState(
    val playRecords: Map<String, PlayRecord> = emptyMap(),
    val hotMovies: List<DoubanItem> = emptyList(),
    val hotTv: List<DoubanItem> = emptyList(),
    val hotVariety: List<DoubanItem> = emptyList(),
    val loading: Boolean = false
)
