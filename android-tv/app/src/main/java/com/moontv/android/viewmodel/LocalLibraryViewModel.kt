package com.moontv.android.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.moontv.android.api.ApiClient
import com.moontv.android.api.LocalLibraryItem
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class LocalLibraryViewModel(app: Application) : AndroidViewModel(app) {

    private val api = ApiClient.getInstance(app)

    private val _state = MutableStateFlow(LocalLibraryState())
    val state: StateFlow<LocalLibraryState> = _state

    fun load() {
        _state.value = _state.value.copy(loading = true, error = null)

        viewModelScope.launch {
            try {
                val items = api.getLocalLibrary()
                _state.value = LocalLibraryState(items = items, loading = false)
            } catch (e: Exception) {
                _state.value = _state.value.copy(
                    loading = false,
                    error = "加载失败: ${e.message}"
                )
            }
        }
    }
}

data class LocalLibraryState(
    val items: List<LocalLibraryItem> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null
)
