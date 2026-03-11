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
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class SearchViewModel(app: Application) : AndroidViewModel(app) {

    private val api = ApiClient.getInstance(app)
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    private val _state = MutableStateFlow(SearchState())
    val state: StateFlow<SearchState> = _state

    private var searchJob: Job? = null

    /** Cached results grouped by title for source switching */
    private val titleResultsCache = mutableMapOf<String, List<SearchResult>>()

    fun search(query: String) {
        searchJob?.cancel()
        if (query.isBlank()) {
            _state.value = SearchState()
            return
        }

        _state.value = SearchState(loading = true, query = query)
        titleResultsCache.clear()

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

    /**
     * Cache all search results that share the same title for source switching.
     */
    fun cacheResultsForTitle(title: String) {
        val results = _state.value.results
        val matching = results.filter { it.title == title }
        if (matching.isNotEmpty()) {
            titleResultsCache[title] = matching
        }
    }

    /**
     * Get cached results for a title as JSON string for passing to DetailFragment/PlayerActivity.
     */
    fun getCachedResultsJson(title: String): String {
        val cached = titleResultsCache[title] ?: return "[]"
        return json.encodeToString(cached)
    }
}

data class SearchState(
    val query: String = "",
    val results: List<SearchResult> = emptyList(),
    val loading: Boolean = false,
    val done: Boolean = false,
    val error: String? = null
)
