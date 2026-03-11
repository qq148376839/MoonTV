package com.moontv.android.ui

import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.moontv.android.R
import com.moontv.android.api.Favorite
import com.moontv.android.util.ImageUtils
import com.moontv.android.viewmodel.FavoritesViewModel
import kotlinx.coroutines.launch

class FavoritesFragment : Fragment() {

    private val viewModel: FavoritesViewModel by viewModels()

    private lateinit var favoritesGrid: RecyclerView
    private lateinit var favCount: TextView
    private lateinit var emptyState: LinearLayout
    private lateinit var loading: ProgressBar

    private var gridAdapter: FavoriteGridAdapter? = null

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        return inflater.inflate(R.layout.fragment_favorites, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        favoritesGrid = view.findViewById(R.id.favoritesGrid)
        favCount = view.findViewById(R.id.favCount)
        emptyState = view.findViewById(R.id.emptyState)
        loading = view.findViewById(R.id.favLoading)

        favoritesGrid.layoutManager = GridLayoutManager(requireContext(), 5)
        gridAdapter = FavoriteGridAdapter { card -> navigateToSearch(card) }
        favoritesGrid.adapter = gridAdapter

        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.state.collect { state ->
                    val items = state.favorites.map { (key, fav) -> fav.toCardItem(key) }
                    gridAdapter?.submitList(items)

                    favCount.text = "${items.size}部"
                    emptyState.visibility = if (items.isEmpty() && !state.loading) View.VISIBLE else View.GONE
                    loading.visibility = if (state.loading) View.VISIBLE else View.GONE
                }
            }
        }

        viewModel.load()
    }

    private fun navigateToSearch(card: CardItem) {
        val query = card.searchTitle.ifEmpty { card.title }
        val fragment = SearchFragment.newInstance(query)
        parentFragmentManager.beginTransaction()
            .replace(R.id.fragmentContainer, fragment)
            .addToBackStack(null)
            .commit()
    }
}

private fun Favorite.toCardItem(key: String): CardItem = CardItem(
    id = key,
    title = title,
    subtitle = buildString {
        if (year.isNotBlank()) append(year)
        if (sourceName.isNotBlank()) {
            if (isNotEmpty()) append(" · ")
            append(sourceName)
        }
        if (totalEpisodes > 0) {
            if (isNotEmpty()) append(" · ")
            append("共${totalEpisodes}集")
        }
    },
    posterUrl = cover,
    sourceName = sourceName,
    year = year,
    searchTitle = searchTitle.ifEmpty { title }
)

/**
 * RecyclerView adapter for favorites grid with OrionTV-style card rendering.
 */
class FavoriteGridAdapter(
    private val onItemClick: (CardItem) -> Unit
) : RecyclerView.Adapter<FavoriteGridAdapter.CardViewHolder>() {

    private var items: List<CardItem> = emptyList()

    fun submitList(list: List<CardItem>) {
        items = list
        notifyDataSetChanged()
    }

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
                bottomMargin = (16 * density).toInt()
            }
            isFocusable = true
            isFocusableInTouchMode = true
            clipChildren = false
            clipToPadding = false
        }

        // Poster
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

        root.findViewWithTag<TextView>("title")?.text = card.title
        root.findViewWithTag<TextView>("subtitle")?.text = card.subtitle

        val poster = root.findViewWithTag<ImageView>("poster")
        if (!card.posterUrl.isNullOrBlank()) {
            ImageUtils.loadInto(ctx, card.posterUrl, poster!!)
        } else {
            poster?.setImageDrawable(null)
            poster?.setBackgroundColor(ctx.getColor(R.color.bg_card))
        }

        root.setOnClickListener { onItemClick(card) }
    }

    class CardViewHolder(view: View) : RecyclerView.ViewHolder(view)
}
