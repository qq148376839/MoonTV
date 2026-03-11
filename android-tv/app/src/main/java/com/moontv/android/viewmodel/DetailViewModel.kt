package com.moontv.android.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.moontv.android.api.ApiClient
import com.moontv.android.api.Favorite
import com.moontv.android.api.SearchResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class DetailViewModel(app: Application) : AndroidViewModel(app) {

    private val api = ApiClient.getInstance(app)

    private val _state = MutableStateFlow(DetailState())
    val state: StateFlow<DetailState> = _state

    fun loadDetail(result: SearchResult) {
        _state.value = DetailState(item = result, loading = true)
        checkFavorite(result.source, result.id)

        // If episodes are already present from search, no need to call detail API
        if (result.episodes.isNotEmpty()) {
            _state.value = _state.value.copy(loading = false)
            return
        }

        viewModelScope.launch {
            try {
                val detail = api.getDetail(result.source, result.id)
                _state.value = _state.value.copy(
                    item = detail,
                    loading = false
                )
            } catch (e: Exception) {
                _state.value = _state.value.copy(
                    loading = false,
                    error = "加载失败: ${e.message}"
                )
            }
        }
    }

    private fun checkFavorite(source: String, id: String) {
        viewModelScope.launch {
            try {
                val favorites = api.getFavorites()
                val key = "$source+$id"
                _state.value = _state.value.copy(isFavorite = favorites.containsKey(key))
            } catch (_: Exception) { }
        }
    }

    fun toggleFavorite() {
        val item = _state.value.item ?: return
        val key = "${item.source}+${item.id}"
        val wasFavorite = _state.value.isFavorite

        viewModelScope.launch {
            try {
                if (wasFavorite) {
                    api.deleteFavorite(key)
                } else {
                    api.saveFavorite(
                        key,
                        Favorite(
                            title = item.title,
                            sourceName = item.sourceName,
                            totalEpisodes = item.episodes.size,
                            year = item.year,
                            cover = item.poster,
                            saveTime = System.currentTimeMillis(),
                            searchTitle = item.title
                        )
                    )
                }
                _state.value = _state.value.copy(isFavorite = !wasFavorite)
            } catch (_: Exception) { }
        }
    }
}

data class DetailState(
    val item: SearchResult? = null,
    val loading: Boolean = false,
    val error: String? = null,
    val isFavorite: Boolean = false
)
