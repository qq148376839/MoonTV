package com.moontv.android.ui

import android.os.Bundle
import android.view.View
import androidx.leanback.app.SearchSupportFragment
import androidx.leanback.widget.ArrayObjectAdapter
import androidx.leanback.widget.HeaderItem
import androidx.leanback.widget.ListRow
import androidx.leanback.widget.ListRowPresenter
import androidx.leanback.widget.ObjectAdapter
import androidx.leanback.widget.OnItemViewClickedListener
import androidx.leanback.widget.Presenter
import androidx.leanback.widget.Row
import androidx.leanback.widget.RowPresenter
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.moontv.android.R
import com.moontv.android.api.SearchResult
import com.moontv.android.viewmodel.HomeViewModel
import com.moontv.android.viewmodel.SearchViewModel
import kotlinx.coroutines.launch

class SearchFragment : SearchSupportFragment(), SearchSupportFragment.SearchResultProvider {

    private val searchViewModel: SearchViewModel by viewModels()
    private val homeViewModel: HomeViewModel by viewModels({ requireActivity() })

    private lateinit var rowsAdapter: ArrayObjectAdapter

    private var initialQuery: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        initialQuery = arguments?.getString(ARG_QUERY)
        rowsAdapter = ArrayObjectAdapter(ListRowPresenter())
        setSearchResultProvider(this)

        setOnItemViewClickedListener(OnItemViewClickedListener { _: Presenter.ViewHolder?,
                                                                 item: Any?,
                                                                 _: RowPresenter.ViewHolder?,
                                                                 _: Row? ->
            if (item is CardItem) {
                navigateToDetail(item)
            }
        })
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                searchViewModel.state.collect { state ->
                    updateResults(state.results)
                }
            }
        }

        // Auto-search if launched with a query
        if (!initialQuery.isNullOrBlank()) {
            setSearchQuery(initialQuery, true)
        }
    }

    override fun getResultsAdapter(): ObjectAdapter = rowsAdapter

    override fun onQueryTextChange(newQuery: String): Boolean {
        // Pinyin suggestion
        if (newQuery.length >= 2) {
            val suggestions = PinyinHelper.filter(newQuery, homeViewModel.doubanTitleCache)
            if (suggestions.isNotEmpty()) {
                showPinyinSuggestions(suggestions.take(5))
                return true
            }
        }
        return true
    }

    override fun onQueryTextSubmit(query: String): Boolean {
        searchViewModel.search(query)
        return true
    }

    private fun updateResults(results: List<SearchResult>) {
        rowsAdapter.clear()
        if (results.isEmpty()) return

        // Group by source
        val grouped = results.groupBy { it.sourceName.ifEmpty { it.source } }
        grouped.entries.forEachIndexed { idx, (sourceName, items) ->
            val header = HeaderItem(idx.toLong(), sourceName)
            val listAdapter = ArrayObjectAdapter(CardPresenter())
            items.forEach { result ->
                listAdapter.add(result.toCardItem())
            }
            rowsAdapter.add(ListRow(header, listAdapter))
        }
    }

    private fun showPinyinSuggestions(suggestions: List<String>) {
        rowsAdapter.clear()
        val header = HeaderItem(0, "拼音匹配")
        val listAdapter = ArrayObjectAdapter(CardPresenter())
        suggestions.forEach { title ->
            listAdapter.add(
                CardItem(
                    id = "",
                    title = title,
                    subtitle = "点击搜索",
                    posterUrl = null,
                    searchTitle = title
                )
            )
        }
        rowsAdapter.add(ListRow(header, listAdapter))
    }

    private fun navigateToDetail(card: CardItem) {
        // If this is a pinyin suggestion, trigger search
        if (card.source.isEmpty() && card.id.isEmpty()) {
            setSearchQuery(card.title, true)
            return
        }

        val result = SearchResult(
            id = card.id,
            title = card.title,
            poster = card.posterUrl ?: "",
            episodes = card.episodes,
            source = card.source,
            sourceName = card.sourceName,
            sourceType = card.sourceType,
            year = card.year,
            desc = card.desc,
            category = card.category
        )
        val fragment = DetailFragment.newInstance(result)
        parentFragmentManager.beginTransaction()
            .replace(R.id.fragmentContainer, fragment)
            .addToBackStack(null)
            .commit()
    }

    companion object {
        private const val ARG_QUERY = "arg_query"

        fun newInstance(query: String? = null): SearchFragment {
            return SearchFragment().apply {
                arguments = Bundle().apply {
                    query?.let { putString(ARG_QUERY, it) }
                }
            }
        }
    }
}

private fun SearchResult.toCardItem(): CardItem = CardItem(
    id = id,
    title = title,
    subtitle = buildString {
        if (year.isNotBlank()) append(year)
        if (sourceName.isNotBlank()) {
            if (isNotEmpty()) append(" · ")
            append(sourceName)
        }
        if (episodes.isNotEmpty()) {
            if (isNotEmpty()) append(" · ")
            append("${episodes.size}集")
        }
    },
    posterUrl = poster,
    source = source,
    sourceType = sourceType,
    sourceName = sourceName,
    episodes = episodes,
    year = year,
    desc = desc,
    category = category,
    searchTitle = title
)
