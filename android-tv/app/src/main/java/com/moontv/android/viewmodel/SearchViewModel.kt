package com.moontv.android.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.moontv.android.api.ApiClient
import com.moontv.android.api.SearchResult
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class SearchViewModel(app: Application) : AndroidViewModel(app) {

    private val api = ApiClient.getInstance(app)

    private val _state = MutableStateFlow(SearchState())
    val state: StateFlow<SearchState> = _state

    private var searchJob: Job? = null

    fun search(query: String) {
        // Cancel previous search
        searchJob?.cancel()
        if (query.isBlank()) {
            _state.value = SearchState()
            return
        }

        _state.value = SearchState(loading = true, query = query)

        searchJob = viewModelScope.launch {
            try {
                val accumulated = mutableListOf<SearchResult>()
                api.searchStream(query).collect { message ->
                    accumulated.addAll(message.results)
                    _state.value = _state.value.copy(
                        results = accumulated.toList(),
                        done = message.done
                    )
                    if (message.done) {
                        _state.value = _state.value.copy(loading = false)
                    }
                }
            } catch (e: Exception) {
                _state.value = _state.value.copy(
                    loading = false,
                    done = true,
                    error = "搜索失败: ${e.message}"
                )
            }
        }
    }
}

data class SearchState(
    val query: String = "",
    val results: List<SearchResult> = emptyList(),
    val loading: Boolean = false,
    val done: Boolean = false,
    val error: String? = null
)
