package com.moontv.android.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.moontv.android.api.ApiClient
import com.moontv.android.api.Favorite
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class FavoritesViewModel(app: Application) : AndroidViewModel(app) {

    private val api = ApiClient.getInstance(app)

    private val _state = MutableStateFlow(FavoritesState())
    val state: StateFlow<FavoritesState> = _state

    fun load() {
        _state.value = _state.value.copy(loading = true)

        viewModelScope.launch {
            try {
                val favorites = api.getFavorites()
                val sorted = favorites.entries
                    .sortedByDescending { it.value.saveTime }
                    .associate { it.key to it.value }
                _state.value = FavoritesState(favorites = sorted, loading = false)
            } catch (e: Exception) {
                _state.value = FavoritesState(
                    loading = false,
                    error = "加载收藏失败: ${e.message}"
                )
            }
        }
    }
}

data class FavoritesState(
    val favorites: Map<String, Favorite> = emptyMap(),
    val loading: Boolean = false,
    val error: String? = null
)
