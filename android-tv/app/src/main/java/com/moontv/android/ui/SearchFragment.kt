package com.moontv.android.ui

import android.app.AlertDialog
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.wifi.WifiManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.moontv.android.QrCodeGenerator
import com.moontv.android.R
import com.moontv.android.SearchInputServer
import com.moontv.android.api.SearchResult
import com.moontv.android.viewmodel.SearchViewModel
import kotlinx.coroutines.launch

class SearchFragment : Fragment() {

    private val searchViewModel: SearchViewModel by viewModels()

    private lateinit var searchInput: EditText
    private lateinit var btnSearch: TextView
    private lateinit var btnQrSearch: TextView
    private lateinit var searchStatus: TextView
    private lateinit var searchResultsGrid: RecyclerView
    private lateinit var searchLoading: FrameLayout

    private var resultAdapter: SearchResultGridAdapter? = null
    private var searchInputServer: SearchInputServer? = null
    private val handler = Handler(Looper.getMainLooper())

    private var initialQuery: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        initialQuery = arguments?.getString(ARG_QUERY)
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        return inflater.inflate(R.layout.fragment_search, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        searchInput = view.findViewById(R.id.searchInput)
        btnSearch = view.findViewById(R.id.btnSearch)
        btnQrSearch = view.findViewById(R.id.btnQrSearch)
        searchStatus = view.findViewById(R.id.searchStatus)
        searchResultsGrid = view.findViewById(R.id.searchResultsGrid)
        searchLoading = view.findViewById(R.id.searchLoading)

        // Setup grid: 5 columns
        searchResultsGrid.layoutManager = GridLayoutManager(requireContext(), 5)
        resultAdapter = SearchResultGridAdapter { card -> navigateToDetail(card) }
        searchResultsGrid.adapter = resultAdapter

        // Focus styling for input and buttons
        setupFocusBorder(searchInput)
        setupButtonFocus(btnSearch, isPrimary = true)
        setupButtonFocus(btnQrSearch, isPrimary = false)

        // Search action
        btnSearch.setOnClickListener { doSearch() }
        searchInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEARCH) {
                doSearch()
                true
            } else false
        }
        searchInput.setOnKeyListener { _, keyCode, event ->
            if (event.action == KeyEvent.ACTION_DOWN && keyCode == KeyEvent.KEYCODE_DPAD_CENTER) {
                // Don't trigger search on center press in EditText - let it open keyboard
                false
            } else false
        }

        // QR scan button
        btnQrSearch.setOnClickListener { showQrDialog() }

        // Observe search state
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                searchViewModel.state.collect { state ->
                    // Loading
                    searchLoading.visibility = if (state.loading && state.results.isEmpty()) View.VISIBLE else View.GONE

                    // Status text
                    when {
                        state.loading -> {
                            searchStatus.text = "正在搜索... (${state.results.size}个结果)"
                            searchStatus.visibility = View.VISIBLE
                        }
                        state.done && state.results.isEmpty() -> {
                            searchStatus.text = "未找到相关内容"
                            searchStatus.visibility = View.VISIBLE
                        }
                        state.error != null -> {
                            searchStatus.text = state.error
                            searchStatus.visibility = View.VISIBLE
                        }
                        state.results.isNotEmpty() -> {
                            searchStatus.text = "搜索结果 (${state.results.size}个)"
                            searchStatus.visibility = View.VISIBLE
                        }
                        else -> {
                            searchStatus.visibility = View.GONE
                        }
                    }

                    // Results - flat list (no grouping)
                    resultAdapter?.submitList(state.results.map { it.toCardItem() })
                }
            }
        }

        // Auto-search if launched with a query
        if (!initialQuery.isNullOrBlank()) {
            searchInput.setText(initialQuery)
            doSearch()
        } else {
            searchInput.requestFocus()
        }
    }

    private fun doSearch() {
        val query = searchInput.text.toString().trim()
        if (query.isNotBlank()) {
            searchViewModel.search(query)
        }
    }

    private fun setupFocusBorder(editText: EditText) {
        editText.setOnFocusChangeListener { v, hasFocus ->
            val bg = v.background as? GradientDrawable
            bg?.setStroke(
                (2 * v.context.resources.displayMetrics.density).toInt(),
                if (hasFocus) v.context.getColor(R.color.focus_border)
                else v.context.getColor(R.color.border)
            )
        }
    }

    private fun setupButtonFocus(button: TextView, isPrimary: Boolean) {
        button.setOnFocusChangeListener { v, hasFocus ->
            val bg = v.background as? GradientDrawable
            if (isPrimary) {
                bg?.setColor(
                    if (hasFocus) v.context.getColor(R.color.primary_dark)
                    else v.context.getColor(R.color.primary)
                )
            } else {
                bg?.setColor(
                    if (hasFocus) v.context.getColor(R.color.primary)
                    else v.context.getColor(R.color.bg_surface)
                )
                (v as TextView).setTextColor(
                    if (hasFocus) Color.WHITE
                    else v.context.getColor(R.color.text_primary)
                )
            }
        }
    }

    private fun showQrDialog() {
        val ip = getDeviceIp() ?: run {
            searchStatus.text = "未检测到网络连接"
            searchStatus.visibility = View.VISIBLE
            return
        }

        // Start search input server
        if (searchInputServer == null) {
            searchInputServer = SearchInputServer { keyword ->
                handler.post {
                    searchInput.setText(keyword)
                    doSearch()
                }
            }
            searchInputServer?.start()
        }

        val port = searchInputServer?.port ?: return
        val url = "http://$ip:$port/search"

        val qrBitmap = QrCodeGenerator.generate(url, 8)

        val dialog = AlertDialog.Builder(requireContext(), R.style.Theme_MoonTV)
            .setView(FrameLayout(requireContext()).apply {
                val density = resources.displayMetrics.density
                setPadding(
                    (32 * density).toInt(), (24 * density).toInt(),
                    (32 * density).toInt(), (24 * density).toInt()
                )
                setBackgroundColor(context.getColor(R.color.bg_card))

                val container = android.widget.LinearLayout(context).apply {
                    orientation = android.widget.LinearLayout.VERTICAL
                    gravity = android.view.Gravity.CENTER
                }

                val titleTv = TextView(context).apply {
                    text = "手机扫码搜索"
                    setTextColor(Color.WHITE)
                    textSize = 20f
                    gravity = android.view.Gravity.CENTER
                    setPadding(0, 0, 0, (16 * density).toInt())
                }
                container.addView(titleTv)

                val qrView = ImageView(context).apply {
                    val size = (200 * density).toInt()
                    layoutParams = android.widget.LinearLayout.LayoutParams(size, size)
                    setImageBitmap(qrBitmap)
                    scaleType = ImageView.ScaleType.FIT_CENTER
                    setBackgroundColor(Color.WHITE)
                    val pad = (8 * density).toInt()
                    setPadding(pad, pad, pad, pad)
                }
                container.addView(qrView)

                val hintTv = TextView(context).apply {
                    text = "手机扫描二维码，输入搜索关键词\n$url"
                    setTextColor(context.getColor(R.color.text_muted))
                    textSize = 13f
                    gravity = android.view.Gravity.CENTER
                    setPadding(0, (16 * density).toInt(), 0, 0)
                }
                container.addView(hintTv)

                addView(container)
            })
            .create()
        dialog.show()
    }

    @Suppress("DEPRECATION")
    private fun getDeviceIp(): String? {
        try {
            val wifiManager = requireContext().applicationContext
                .getSystemService(android.content.Context.WIFI_SERVICE) as WifiManager
            val ip = wifiManager.connectionInfo.ipAddress
            if (ip == 0) return null
            return "${ip and 0xFF}.${ip shr 8 and 0xFF}.${ip shr 16 and 0xFF}.${ip shr 24 and 0xFF}"
        } catch (_: Exception) {
            return null
        }
    }

    private fun navigateToDetail(card: CardItem) {
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

        // Cache search results for source switching in player
        searchViewModel.cacheResultsForTitle(card.title)

        val fragment = DetailFragment.newInstance(result, searchViewModel.getCachedResultsJson(card.title))
        parentFragmentManager.beginTransaction()
            .replace(R.id.fragmentContainer, fragment)
            .addToBackStack(null)
            .commit()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        searchInputServer?.stop()
        searchInputServer = null
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

/**
 * Flat grid adapter for search results (5-column).
 * Each card shows poster + title + source badge.
 */
class SearchResultGridAdapter(
    private val onItemClick: (CardItem) -> Unit
) : RecyclerView.Adapter<SearchResultGridAdapter.ViewHolder>() {

    private var items: List<CardItem> = emptyList()

    fun submitList(list: List<CardItem>) {
        items = list
        notifyDataSetChanged()
    }

    override fun getItemCount(): Int = items.size

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val ctx = parent.context
        val density = ctx.resources.displayMetrics.density
        val posterH = (240 * density).toInt()
        val titleH = (44 * density).toInt()

        val root = android.widget.LinearLayout(ctx).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            layoutParams = ViewGroup.MarginLayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                posterH + titleH
            ).apply {
                val hMargin = (6 * density).toInt()
                val vMargin = (8 * density).toInt()
                setMargins(hMargin, vMargin, hMargin, vMargin)
            }
            isFocusable = true
            isFocusableInTouchMode = true
            clipChildren = false
            clipToPadding = false
        }

        // Poster frame
        val posterFrame = FrameLayout(ctx).apply {
            layoutParams = android.widget.LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, posterH
            )
            val bg = GradientDrawable().apply {
                setColor(ctx.getColor(R.color.bg_card))
                cornerRadius = 8 * density
            }
            background = bg
            clipChildren = true
        }

        val posterImage = ImageView(ctx).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            scaleType = ImageView.ScaleType.CENTER_CROP
            tag = "poster"
        }
        posterFrame.addView(posterImage)

        // Focus border
        val focusBorder = View(ctx).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            val borderBg = GradientDrawable().apply {
                setColor(Color.TRANSPARENT)
                setStroke((2 * density).toInt(), ctx.getColor(R.color.focus_border))
                cornerRadius = 8 * density
            }
            background = borderBg
            visibility = View.INVISIBLE
            tag = "focusBorder"
        }
        posterFrame.addView(focusBorder)

        // Source badge (top-left)
        val sourceBadge = TextView(ctx).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                android.view.Gravity.TOP or android.view.Gravity.START
            ).apply {
                topMargin = (6 * density).toInt()
                marginStart = (6 * density).toInt()
            }
            setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 10f)
            setTextColor(Color.WHITE)
            val bg = GradientDrawable().apply {
                setColor(0xB3000000.toInt())
                cornerRadius = 6 * density
            }
            background = bg
            setPadding(
                (6 * density).toInt(), (2 * density).toInt(),
                (6 * density).toInt(), (2 * density).toInt()
            )
            visibility = View.GONE
            tag = "source"
        }
        posterFrame.addView(sourceBadge)

        // Rating badge (top-right)
        val ratingBadge = TextView(ctx).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                android.view.Gravity.TOP or android.view.Gravity.END
            ).apply {
                topMargin = (6 * density).toInt()
                marginEnd = (6 * density).toInt()
            }
            setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 11f)
            setTextColor(ctx.getColor(R.color.rating_gold))
            val bg = GradientDrawable().apply {
                setColor(0xB3000000.toInt())
                cornerRadius = 6 * density
            }
            background = bg
            setPadding(
                (6 * density).toInt(), (2 * density).toInt(),
                (6 * density).toInt(), (2 * density).toInt()
            )
            visibility = View.GONE
            tag = "rating"
        }
        posterFrame.addView(ratingBadge)

        root.addView(posterFrame)

        // Title area
        val titleLayout = android.widget.LinearLayout(ctx).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            layoutParams = android.widget.LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, titleH
            )
            setPadding(0, (6 * density).toInt(), 0, 0)
        }

        val titleText = TextView(ctx).apply {
            layoutParams = android.widget.LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 14f)
            setTextColor(Color.WHITE)
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            tag = "title"
        }
        titleLayout.addView(titleText)

        val subtitleText = TextView(ctx).apply {
            layoutParams = android.widget.LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 12f)
            setTextColor(ctx.getColor(R.color.text_muted))
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            tag = "subtitle"
        }
        titleLayout.addView(subtitleText)

        root.addView(titleLayout)

        // Focus animation
        root.setOnFocusChangeListener { v, hasFocus ->
            val border = v.findViewWithTag<View>("focusBorder")
            border?.visibility = if (hasFocus) View.VISIBLE else View.INVISIBLE
            val scale = if (hasFocus) 1.05f else 1.0f
            android.animation.AnimatorSet().apply {
                playTogether(
                    android.animation.ObjectAnimator.ofFloat(v, "scaleX", scale),
                    android.animation.ObjectAnimator.ofFloat(v, "scaleY", scale)
                )
                duration = 150
                start()
            }
        }

        return ViewHolder(root)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val card = items[position]
        val root = holder.itemView
        val ctx = root.context

        root.findViewWithTag<TextView>("title")?.text = card.title
        root.findViewWithTag<TextView>("subtitle")?.text = card.subtitle

        // Poster
        val poster = root.findViewWithTag<ImageView>("poster")
        if (!card.posterUrl.isNullOrBlank()) {
            com.moontv.android.util.ImageUtils.loadInto(ctx, card.posterUrl, poster!!)
        } else {
            poster?.setImageDrawable(null)
            poster?.setBackgroundColor(ctx.getColor(R.color.bg_card))
        }

        // Source badge
        val source = root.findViewWithTag<TextView>("source")
        if (card.sourceName.isNotBlank()) {
            source?.text = card.sourceName
            source?.visibility = View.VISIBLE
        } else {
            source?.visibility = View.GONE
        }

        // Rating
        val rating = root.findViewWithTag<TextView>("rating")
        if (card.rating.isNotBlank() && card.rating != "0" && card.rating != "0.0") {
            rating?.text = "★ ${card.rating}"
            rating?.visibility = View.VISIBLE
        } else {
            rating?.visibility = View.GONE
        }

        root.setOnClickListener { onItemClick(card) }
    }

    class ViewHolder(view: View) : RecyclerView.ViewHolder(view)
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
