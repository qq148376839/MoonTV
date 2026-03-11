package com.moontv.android.ui

import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.util.TypedValue
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.moontv.android.R
import com.moontv.android.SettingsActivity
import com.moontv.android.api.DoubanItem
import com.moontv.android.api.PlayRecord
import com.moontv.android.api.SearchResult
import com.moontv.android.util.ImageUtils
import com.moontv.android.viewmodel.HomeState
import com.moontv.android.viewmodel.HomeViewModel
import kotlinx.coroutines.launch

class HomeFragment : Fragment() {

    private val viewModel: HomeViewModel by viewModels()

    private lateinit var homeRecycler: RecyclerView
    private lateinit var homeLoading: FrameLayout
    private var rowsAdapter: HomeRowsAdapter? = null

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        return inflater.inflate(R.layout.fragment_home, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        homeRecycler = view.findViewById(R.id.homeRecycler)
        homeLoading = view.findViewById(R.id.homeLoading)

        // Top navigation buttons
        val navSearch = view.findViewById<TextView>(R.id.navSearch)
        val navFavorites = view.findViewById<TextView>(R.id.navFavorites)
        val navDownloads = view.findViewById<TextView>(R.id.navDownloads)
        val navSettings = view.findViewById<TextView>(R.id.navSettings)

        setupNavButton(navSearch)
        setupNavButton(navFavorites)
        setupNavButton(navDownloads)
        setupNavButton(navSettings)

        navSearch.setOnClickListener {
            parentFragmentManager.beginTransaction()
                .replace(R.id.fragmentContainer, SearchFragment())
                .addToBackStack(null)
                .commit()
        }

        navFavorites.setOnClickListener {
            parentFragmentManager.beginTransaction()
                .replace(R.id.fragmentContainer, FavoritesFragment())
                .addToBackStack(null)
                .commit()
        }

        navDownloads.setOnClickListener {
            parentFragmentManager.beginTransaction()
                .replace(R.id.fragmentContainer, LocalLibraryFragment())
                .addToBackStack(null)
                .commit()
        }

        navSettings.setOnClickListener {
            startActivity(Intent(requireContext(), SettingsActivity::class.java))
        }

        // Setup RecyclerView for rows
        homeRecycler.layoutManager = LinearLayoutManager(requireContext())
        rowsAdapter = HomeRowsAdapter(
            onCardClick = { card -> navigateToDetail(card) }
        )
        homeRecycler.adapter = rowsAdapter

        observeState()
        viewModel.loadAll()
    }

    private fun setupNavButton(button: TextView) {
        button.setOnFocusChangeListener { v, hasFocus ->
            val bg = v.background as? GradientDrawable
            bg?.setColor(
                if (hasFocus) requireContext().getColor(R.color.primary)
                else requireContext().getColor(R.color.bg_surface)
            )
            if (hasFocus) {
                (v as TextView).setTextColor(Color.WHITE)
            } else {
                val color = if (v.id == R.id.navSettings)
                    requireContext().getColor(R.color.text_muted)
                else requireContext().getColor(R.color.text_primary)
                (v as TextView).setTextColor(color)
            }
        }
    }

    private fun observeState() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.state.collect { state ->
                    homeLoading.visibility = if (state.loading) View.VISIBLE else View.GONE
                    rebuildRows(state)
                }
            }
        }
    }

    private fun rebuildRows(state: HomeState) {
        val rows = mutableListOf<HomeRow>()

        if (state.playRecords.isNotEmpty()) {
            rows.add(HomeRow("继续观看", state.playRecords.map { (key, record) ->
                record.toCardItem(key)
            }))
        }

        if (state.hotMovies.isNotEmpty()) {
            rows.add(HomeRow("热门电影", state.hotMovies.map { it.toCardItem() }))
        }

        if (state.hotTv.isNotEmpty()) {
            rows.add(HomeRow("热门剧集", state.hotTv.map { it.toCardItem() }))
        }

        if (state.hotVariety.isNotEmpty()) {
            rows.add(HomeRow("热门综艺", state.hotVariety.map { it.toCardItem() }))
        }

        rowsAdapter?.submitList(rows)
    }

    private fun navigateToDetail(card: CardItem) {
        // For Douban items (no source), search first
        if (card.source.isEmpty()) {
            val fragment = SearchFragment.newInstance(card.title)
            parentFragmentManager.beginTransaction()
                .replace(R.id.fragmentContainer, fragment)
                .addToBackStack(null)
                .commit()
            return
        }

        // For play records / search results, go to detail
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
}

// Data model for a home row
data class HomeRow(
    val title: String,
    val items: List<CardItem>
)

// Extension functions to convert API models to CardItem

private fun DoubanItem.toCardItem(): CardItem = CardItem(
    id = id,
    title = title,
    subtitle = if (rate.isNotBlank()) "$year · ★$rate" else year,
    posterUrl = poster,
    year = year,
    searchTitle = title,
    rating = rate
)

private fun PlayRecord.toCardItem(key: String): CardItem {
    val parts = key.split("+", limit = 2)
    val recordSource = if (parts.size == 2) parts[0] else source
    val recordId = if (parts.size == 2) parts[1] else id
    val watchProgress = if (totalTime > 0) (playTime / totalTime).toFloat() else 0f
    return CardItem(
        id = recordId,
        title = title,
        subtitle = "看到第${index}集 · $sourceName",
        posterUrl = cover,
        source = recordSource,
        sourceName = sourceName,
        year = year,
        searchTitle = searchTitle.ifEmpty { title },
        progress = watchProgress
    )
}

/**
 * Vertical list adapter: each item is a row with a title + horizontal scroll of cards.
 */
class HomeRowsAdapter(
    private val onCardClick: (CardItem) -> Unit
) : RecyclerView.Adapter<HomeRowsAdapter.RowViewHolder>() {

    private var rows: List<HomeRow> = emptyList()

    fun submitList(list: List<HomeRow>) {
        rows = list
        notifyDataSetChanged()
    }

    override fun getItemCount(): Int = rows.size

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RowViewHolder {
        val ctx = parent.context
        val density = ctx.resources.displayMetrics.density

        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }

        // Row title
        val titleText = TextView(ctx).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = (12 * density).toInt()
            }
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            setTextColor(Color.WHITE)
            tag = "rowTitle"
        }
        root.addView(titleText)

        // Horizontal cards recycler
        val cardsRecycler = RecyclerView(ctx).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = (24 * density).toInt()
            }
            layoutManager = LinearLayoutManager(ctx, LinearLayoutManager.HORIZONTAL, false)
            clipToPadding = false
            clipChildren = false
            tag = "cardsRecycler"
        }
        root.addView(cardsRecycler)

        return RowViewHolder(root)
    }

    override fun onBindViewHolder(holder: RowViewHolder, position: Int) {
        val row = rows[position]
        val root = holder.itemView

        root.findViewWithTag<TextView>("rowTitle")?.text = row.title

        val recycler = root.findViewWithTag<RecyclerView>("cardsRecycler")
        recycler?.adapter = HorizontalCardAdapter(row.items, onCardClick)
    }

    class RowViewHolder(view: View) : RecyclerView.ViewHolder(view)
}

/**
 * Horizontal card adapter for each row.
 */
class HorizontalCardAdapter(
    private val items: List<CardItem>,
    private val onItemClick: (CardItem) -> Unit
) : RecyclerView.Adapter<HorizontalCardAdapter.CardViewHolder>() {

    override fun getItemCount(): Int = items.size

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): CardViewHolder {
        val ctx = parent.context
        val density = ctx.resources.displayMetrics.density
        val cardW = (160 * density).toInt()
        val posterH = (240 * density).toInt()
        val titleH = (44 * density).toInt()

        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = ViewGroup.MarginLayoutParams(cardW, posterH + titleH).apply {
                marginEnd = (12 * density).toInt()
            }
            isFocusable = true
            isFocusableInTouchMode = true
            clipChildren = false
            clipToPadding = false
        }

        // Poster frame
        val posterFrame = FrameLayout(ctx).apply {
            layoutParams = LinearLayout.LayoutParams(cardW, posterH)
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
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            setTextColor(ctx.getColor(R.color.rating_gold))
            val bg = GradientDrawable().apply {
                setColor(0xB3000000.toInt())
                cornerRadius = 6 * density
            }
            background = bg
            setPadding((6 * density).toInt(), (2 * density).toInt(), (6 * density).toInt(), (2 * density).toInt())
            visibility = View.GONE
            tag = "rating"
        }
        posterFrame.addView(ratingBadge)

        // Progress bar (bottom of poster)
        val progressTrack = FrameLayout(ctx).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                (4 * density).toInt(),
                android.view.Gravity.BOTTOM
            )
            visibility = View.GONE
            tag = "progressTrack"
        }
        val progressFill = View(ctx).apply {
            layoutParams = FrameLayout.LayoutParams(0, FrameLayout.LayoutParams.MATCH_PARENT)
            setBackgroundColor(ctx.getColor(R.color.primary))
            tag = "progressFill"
        }
        progressTrack.addView(progressFill)
        posterFrame.addView(progressTrack)

        root.addView(posterFrame)

        // Title area
        val titleLayout = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(cardW, titleH)
            setPadding(0, (6 * density).toInt(), 0, 0)
        }

        val titleText = TextView(ctx).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setTextColor(Color.WHITE)
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            tag = "title"
        }
        titleLayout.addView(titleText)

        val subtitleText = TextView(ctx).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
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
            AnimatorSet().apply {
                playTogether(
                    ObjectAnimator.ofFloat(v, "scaleX", scale),
                    ObjectAnimator.ofFloat(v, "scaleY", scale)
                )
                duration = 150
                start()
            }
        }

        return CardViewHolder(root)
    }

    override fun onBindViewHolder(holder: CardViewHolder, position: Int) {
        val card = items[position]
        val root = holder.itemView
        val ctx = root.context
        val density = ctx.resources.displayMetrics.density

        root.findViewWithTag<TextView>("title")?.text = card.title
        root.findViewWithTag<TextView>("subtitle")?.text = card.subtitle

        // Poster
        val poster = root.findViewWithTag<ImageView>("poster")
        if (!card.posterUrl.isNullOrBlank()) {
            ImageUtils.loadInto(ctx, card.posterUrl, poster!!)
        } else {
            poster?.setImageDrawable(null)
            poster?.setBackgroundColor(ctx.getColor(R.color.bg_card))
        }

        // Rating
        val rating = root.findViewWithTag<TextView>("rating")
        if (card.rating.isNotBlank() && card.rating != "0" && card.rating != "0.0") {
            rating?.text = "★ ${card.rating}"
            rating?.visibility = View.VISIBLE
        } else {
            rating?.visibility = View.GONE
        }

        // Progress
        val progressTrack = root.findViewWithTag<FrameLayout>("progressTrack")
        val progressFill = root.findViewWithTag<View>("progressFill")
        if (card.progress > 0f) {
            progressTrack?.visibility = View.VISIBLE
            val trackWidth = (160 * density).toInt()
            val fillWidth = (trackWidth * card.progress.coerceIn(0f, 1f)).toInt()
            progressFill?.layoutParams = FrameLayout.LayoutParams(fillWidth, FrameLayout.LayoutParams.MATCH_PARENT)
        } else {
            progressTrack?.visibility = View.GONE
        }

        root.setOnClickListener { onItemClick(card) }
    }

    class CardViewHolder(view: View) : RecyclerView.ViewHolder(view)
}
