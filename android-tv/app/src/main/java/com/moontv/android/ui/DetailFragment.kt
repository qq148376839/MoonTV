package com.moontv.android.ui

import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.moontv.android.PlayerActivity
import com.moontv.android.R
import com.moontv.android.api.SearchResult
import com.moontv.android.util.ImageUtils
import com.moontv.android.util.Prefs
import com.moontv.android.viewmodel.DetailViewModel
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class DetailFragment : Fragment() {

    private val viewModel: DetailViewModel by viewModels()

    private lateinit var poster: ImageView
    private lateinit var titleView: TextView
    private lateinit var metaView: TextView
    private lateinit var descView: TextView
    private lateinit var btnPlay: TextView
    private lateinit var btnFavorite: TextView
    private lateinit var episodesHeader: TextView
    private lateinit var episodesGrid: RecyclerView
    private lateinit var loadingOverlay: FrameLayout
    private lateinit var errorOverlay: LinearLayout
    private lateinit var errorText: TextView
    private lateinit var sourceTabsScroll: HorizontalScrollView
    private lateinit var sourceTabsContainer: LinearLayout

    private var currentResult: SearchResult? = null
    private var allResultsJson: String = "[]"
    private var episodeAdapter: EpisodeGridAdapter? = null

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        return inflater.inflate(R.layout.fragment_detail, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        poster = view.findViewById(R.id.detailPoster)
        titleView = view.findViewById(R.id.detailTitle)
        metaView = view.findViewById(R.id.detailMeta)
        descView = view.findViewById(R.id.detailDesc)
        btnPlay = view.findViewById(R.id.btnPlay)
        btnFavorite = view.findViewById(R.id.btnFavorite)
        episodesHeader = view.findViewById(R.id.episodesHeader)
        episodesGrid = view.findViewById(R.id.episodesGrid)
        loadingOverlay = view.findViewById(R.id.loadingOverlay)
        errorOverlay = view.findViewById(R.id.errorOverlay)
        errorText = view.findViewById(R.id.errorText)
        sourceTabsScroll = view.findViewById(R.id.sourceTabsScroll)
        sourceTabsContainer = view.findViewById(R.id.sourceTabsContainer)

        // Setup episodes RecyclerView
        episodesGrid.layoutManager = GridLayoutManager(requireContext(), 8)
        episodeAdapter = EpisodeGridAdapter { episode -> playEpisode(episode) }
        episodesGrid.adapter = episodeAdapter

        // Button focus animations
        setupButtonFocus(btnPlay)
        setupButtonFocus(btnFavorite)

        // Play button click -> play first episode
        btnPlay.setOnClickListener {
            val episodes = viewModel.state.value.item?.episodes ?: return@setOnClickListener
            if (episodes.isNotEmpty()) {
                playEpisode(EpisodeItem(0, "第1集", episodes[0]))
            }
        }

        // Favorite button click
        btnFavorite.setOnClickListener { viewModel.toggleFavorite() }

        // Retry button
        view.findViewById<TextView>(R.id.btnRetry)?.setOnClickListener {
            currentResult?.let { viewModel.loadDetail(it) }
        }

        // Load data
        val jsonStr = arguments?.getString(ARG_RESULT) ?: return
        val result = Json.decodeFromString<SearchResult>(jsonStr)
        currentResult = result
        allResultsJson = arguments?.getString(ARG_ALL_RESULTS) ?: "[]"

        observeState()
        viewModel.loadDetail(result)
    }

    private fun setupButtonFocus(button: TextView) {
        button.setOnFocusChangeListener { v, hasFocus ->
            val scale = if (hasFocus) 1.05f else 1.0f
            AnimatorSet().apply {
                playTogether(
                    ObjectAnimator.ofFloat(v, "scaleX", scale),
                    ObjectAnimator.ofFloat(v, "scaleY", scale)
                )
                duration = 150
                start()
            }
            // Highlight effect
            if (v.id == R.id.btnFavorite) {
                val bg = v.background as? GradientDrawable
                bg?.setColor(
                    if (hasFocus) requireContext().getColor(R.color.bg_focus)
                    else requireContext().getColor(R.color.bg_surface)
                )
            }
        }
    }

    private fun observeState() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.state.collect { state ->
                    // Loading
                    loadingOverlay.visibility = if (state.loading) View.VISIBLE else View.GONE

                    // Error
                    if (state.error != null) {
                        errorOverlay.visibility = View.VISIBLE
                        errorText.text = state.error
                    } else {
                        errorOverlay.visibility = View.GONE
                    }

                    // Content
                    state.item?.let { item ->
                        bindContent(item, state.isFavorite)
                    }
                }
            }
        }
    }

    private fun bindContent(item: SearchResult, isFavorite: Boolean) {
        // Poster
        if (item.poster.isNotBlank()) {
            ImageUtils.loadInto(requireContext(), item.poster, poster)
        }

        // Title
        titleView.text = item.title

        // Meta
        val meta = buildString {
            if (item.year.isNotBlank()) append(item.year)
            if (item.category.isNotBlank()) {
                if (isNotEmpty()) append(" · ")
                append(item.category)
            }
            if (item.sourceName.isNotBlank()) {
                if (isNotEmpty()) append(" · ")
                append(item.sourceName)
            }
            if (item.episodes.isNotEmpty()) {
                if (isNotEmpty()) append(" · ")
                append("共${item.episodes.size}集")
            }
        }
        metaView.text = meta
        metaView.visibility = if (meta.isNotBlank()) View.VISIBLE else View.GONE

        // Description
        descView.text = item.desc
        descView.visibility = if (item.desc.isNotBlank()) View.VISIBLE else View.GONE

        // Favorite button state
        btnFavorite.text = if (isFavorite) "★ 已收藏" else "☆ 收藏"
        if (isFavorite) {
            btnFavorite.setTextColor(requireContext().getColor(R.color.favorite_active))
        } else {
            btnFavorite.setTextColor(requireContext().getColor(R.color.text_primary))
        }

        // Play button
        if (item.episodes.isNotEmpty()) {
            btnPlay.visibility = View.VISIBLE
            btnPlay.text = if (item.episodes.size == 1) "播放" else "播放第1集"
        } else {
            btnPlay.visibility = View.GONE
        }

        // Episodes
        if (item.episodes.isNotEmpty()) {
            episodesHeader.text = "选集 (共${item.episodes.size}集)"
            episodesHeader.visibility = View.VISIBLE

            val episodes = item.episodes.mapIndexed { index, url ->
                EpisodeItem(index, "第${index + 1}集", url)
            }
            episodeAdapter?.submitList(episodes)
        } else {
            episodesHeader.visibility = View.GONE
            episodeAdapter?.submitList(emptyList())
        }
    }

    private fun playEpisode(episode: EpisodeItem) {
        val item = viewModel.state.value.item ?: return
        val serverUrl = Prefs.getServerUrl(requireContext()) ?: return

        val playUrl = buildPlayUrl(serverUrl, item, episode)

        val intent = Intent(requireContext(), PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_URL, playUrl)
            putExtra(PlayerActivity.EXTRA_TITLE, item.title)
            putExtra(PlayerActivity.EXTRA_SUBTITLE, "第${episode.index + 1}集")
            putExtra(PlayerActivity.EXTRA_SOURCE, item.source)
            putExtra(PlayerActivity.EXTRA_SOURCE_NAME, item.sourceName)
            putExtra(PlayerActivity.EXTRA_SOURCE_TYPE, item.sourceType)
            putExtra(PlayerActivity.EXTRA_ID, item.id)
            putExtra(PlayerActivity.EXTRA_EPISODE_INDEX, episode.index)
            putExtra(PlayerActivity.EXTRA_TOTAL_EPISODES, item.episodes.size)
            putExtra(PlayerActivity.EXTRA_SEARCH_TITLE, item.title)
            putExtra(PlayerActivity.EXTRA_ALL_RESULTS, allResultsJson)
            putExtra(PlayerActivity.EXTRA_EPISODES_JSON, Json.encodeToString(item.episodes))
        }
        startActivity(intent)
    }

    private fun buildPlayUrl(serverUrl: String, item: SearchResult, episode: EpisodeItem): String {
        val encode = { s: String -> java.net.URLEncoder.encode(s, "UTF-8") }
        return if (item.sourceType == "official") {
            "$serverUrl/api/official-play.m3u8?" +
                    "url=${encode(episode.url)}" +
                    "&source=${encode(item.source)}" +
                    "&id=${encode(item.id)}" +
                    "&ep=${episode.index + 1}" +
                    "&total=${item.episodes.size}" +
                    "&q=${encode(item.title)}"
        } else {
            "$serverUrl/api/unofficial-play.m3u8?" +
                    "source=${encode(item.source)}" +
                    "&id=${encode(item.id)}" +
                    "&q=${encode(item.title)}" +
                    "&url=${encode(episode.url)}" +
                    "&ep=${episode.index + 1}" +
                    "&total=${item.episodes.size}"
        }
    }

    companion object {
        private const val ARG_RESULT = "arg_result"
        private const val ARG_ALL_RESULTS = "arg_all_results"

        fun newInstance(result: SearchResult, allResultsJson: String = "[]"): DetailFragment {
            return DetailFragment().apply {
                arguments = Bundle().apply {
                    putString(ARG_RESULT, Json.encodeToString(result))
                    putString(ARG_ALL_RESULTS, allResultsJson)
                }
            }
        }
    }
}

/**
 * RecyclerView adapter for episodes grid with focus animation.
 */
class EpisodeGridAdapter(
    private val onEpisodeClick: (EpisodeItem) -> Unit
) : RecyclerView.Adapter<EpisodeGridAdapter.EpisodeViewHolder>() {

    private var episodes: List<EpisodeItem> = emptyList()

    fun submitList(list: List<EpisodeItem>) {
        episodes = list
        notifyDataSetChanged()
    }

    override fun getItemCount(): Int = episodes.size

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): EpisodeViewHolder {
        val ctx = parent.context
        val density = ctx.resources.displayMetrics.density

        val tv = TextView(ctx).apply {
            layoutParams = ViewGroup.MarginLayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                (42 * density).toInt()
            ).apply {
                marginEnd = (8 * density).toInt()
                bottomMargin = (8 * density).toInt()
            }
            gravity = Gravity.CENTER
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setTextColor(Color.WHITE)
            val bg = GradientDrawable().apply {
                setColor(ctx.getColor(R.color.bg_surface))
                cornerRadius = 8 * density
            }
            background = bg
            isFocusable = true
            isFocusableInTouchMode = true
        }

        // Focus animation
        tv.setOnFocusChangeListener { v, hasFocus ->
            val textView = v as TextView
            val bg = textView.background as? GradientDrawable
            if (hasFocus) {
                bg?.setColor(v.context.getColor(R.color.primary))
                AnimatorSet().apply {
                    playTogether(
                        ObjectAnimator.ofFloat(v, "scaleX", 1.08f),
                        ObjectAnimator.ofFloat(v, "scaleY", 1.08f)
                    )
                    duration = 100
                    start()
                }
            } else {
                bg?.setColor(v.context.getColor(R.color.bg_surface))
                AnimatorSet().apply {
                    playTogether(
                        ObjectAnimator.ofFloat(v, "scaleX", 1.0f),
                        ObjectAnimator.ofFloat(v, "scaleY", 1.0f)
                    )
                    duration = 100
                    start()
                }
            }
        }

        return EpisodeViewHolder(tv)
    }

    override fun onBindViewHolder(holder: EpisodeViewHolder, position: Int) {
        val episode = episodes[position]
        (holder.itemView as TextView).text = episode.label
        holder.itemView.setOnClickListener { onEpisodeClick(episode) }
    }

    class EpisodeViewHolder(view: View) : RecyclerView.ViewHolder(view)
}
