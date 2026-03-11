package com.moontv.android.ui

import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
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
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.moontv.android.R
import com.moontv.android.api.LocalLibraryItem
import com.moontv.android.util.ImageUtils
import com.moontv.android.viewmodel.LocalLibraryViewModel
import kotlinx.coroutines.launch

class LocalLibraryFragment : Fragment() {

    private val viewModel: LocalLibraryViewModel by viewModels()

    private lateinit var grid: RecyclerView
    private lateinit var emptyState: LinearLayout
    private lateinit var loading: FrameLayout

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        return inflater.inflate(R.layout.fragment_local_library, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        grid = view.findViewById(R.id.localLibraryGrid)
        emptyState = view.findViewById(R.id.emptyState)
        loading = view.findViewById(R.id.localLibraryLoading)

        grid.layoutManager = GridLayoutManager(requireContext(), 5)
        val adapter = LocalLibraryGridAdapter { item -> navigateToSearch(item) }
        grid.adapter = adapter

        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.state.collect { state ->
                    loading.visibility = if (state.loading) View.VISIBLE else View.GONE

                    if (!state.loading && state.items.isEmpty() && state.error == null) {
                        emptyState.visibility = View.VISIBLE
                        grid.visibility = View.GONE
                    } else {
                        emptyState.visibility = View.GONE
                        grid.visibility = View.VISIBLE
                    }

                    adapter.submitList(state.items)
                }
            }
        }

        viewModel.load()
    }

    private fun navigateToSearch(item: LocalLibraryItem) {
        // Search for the title to get playable episodes
        val fragment = SearchFragment.newInstance(item.title)
        parentFragmentManager.beginTransaction()
            .replace(R.id.fragmentContainer, fragment)
            .addToBackStack(null)
            .commit()
    }
}

/**
 * Grid adapter for local library items.
 */
class LocalLibraryGridAdapter(
    private val onItemClick: (LocalLibraryItem) -> Unit
) : RecyclerView.Adapter<LocalLibraryGridAdapter.ViewHolder>() {

    private var items: List<LocalLibraryItem> = emptyList()

    fun submitList(list: List<LocalLibraryItem>) {
        items = list
        notifyDataSetChanged()
    }

    override fun getItemCount(): Int = items.size

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val ctx = parent.context
        val density = ctx.resources.displayMetrics.density
        val posterH = (240 * density).toInt()
        val titleH = (44 * density).toInt()

        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
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
            layoutParams = LinearLayout.LayoutParams(
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

        // Episode count badge (top-left)
        val epBadge = TextView(ctx).apply {
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
                setColor(ctx.getColor(R.color.primary))
                cornerRadius = 6 * density
            }
            background = bg
            setPadding(
                (6 * density).toInt(), (2 * density).toInt(),
                (6 * density).toInt(), (2 * density).toInt()
            )
            visibility = View.GONE
            tag = "epBadge"
        }
        posterFrame.addView(epBadge)

        root.addView(posterFrame)

        // Title area
        val titleLayout = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, titleH
            )
            setPadding(0, (6 * density).toInt(), 0, 0)
        }

        val titleText = TextView(ctx).apply {
            layoutParams = LinearLayout.LayoutParams(
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
            layoutParams = LinearLayout.LayoutParams(
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
            AnimatorSet().apply {
                playTogether(
                    ObjectAnimator.ofFloat(v, "scaleX", scale),
                    ObjectAnimator.ofFloat(v, "scaleY", scale)
                )
                duration = 150
                start()
            }
        }

        return ViewHolder(root)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val item = items[position]
        val root = holder.itemView
        val ctx = root.context

        root.findViewWithTag<TextView>("title")?.text = item.title
        root.findViewWithTag<TextView>("subtitle")?.text = buildString {
            if (item.year.isNotBlank()) append(item.year)
            if (item.downloadedEpisodes != null) {
                if (isNotEmpty()) append(" · ")
                append("${item.downloadedEpisodes}集已下载")
            }
        }

        // Poster
        val poster = root.findViewWithTag<ImageView>("poster")
        if (!item.poster.isNullOrBlank()) {
            ImageUtils.loadInto(ctx, item.poster, poster!!)
        } else {
            poster?.setImageDrawable(null)
            poster?.setBackgroundColor(ctx.getColor(R.color.bg_card))
        }

        // Episode count badge
        val epBadge = root.findViewWithTag<TextView>("epBadge")
        if (item.downloadedEpisodes != null && item.downloadedEpisodes > 0) {
            epBadge?.text = "${item.downloadedEpisodes}集"
            epBadge?.visibility = View.VISIBLE
        } else {
            epBadge?.visibility = View.GONE
        }

        root.setOnClickListener { onItemClick(item) }
    }

    class ViewHolder(view: View) : RecyclerView.ViewHolder(view)
}
