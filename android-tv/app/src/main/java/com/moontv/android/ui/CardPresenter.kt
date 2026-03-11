package com.moontv.android.ui

import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.leanback.widget.Presenter
import com.moontv.android.R
import com.moontv.android.util.ImageUtils

/**
 * OrionTV-style video card with poster, badges, focus animation, and progress bar.
 */
class CardPresenter : Presenter() {

    override fun onCreateViewHolder(parent: ViewGroup): ViewHolder {
        val ctx = parent.context
        val density = ctx.resources.displayMetrics.density
        val cardW = (CARD_WIDTH_DP * density).toInt()
        val cardH = (CARD_HEIGHT_DP * density).toInt()
        val totalW = cardW
        val titleH = (40 * density).toInt()

        // Root container: poster + title area
        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = ViewGroup.LayoutParams(totalW, cardH + titleH)
            isFocusable = true
            isFocusableInTouchMode = true
            clipChildren = false
            clipToPadding = false
        }

        // Poster frame
        val posterFrame = FrameLayout(ctx).apply {
            layoutParams = LinearLayout.LayoutParams(cardW, cardH)
            clipChildren = true
            val bg = GradientDrawable().apply {
                setColor(ctx.getColor(R.color.bg_card))
                cornerRadius = 8 * density
            }
            background = bg
        }

        // Poster image
        val posterImage = ImageView(ctx).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            scaleType = ImageView.ScaleType.CENTER_CROP
            tag = "poster"
        }
        posterFrame.addView(posterImage)

        // Focus border overlay (invisible by default)
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
                Gravity.TOP or Gravity.END
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

        // Source badge (top-left)
        val sourceBadge = TextView(ctx).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP or Gravity.START
            ).apply {
                topMargin = (6 * density).toInt()
                marginStart = (6 * density).toInt()
            }
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 10f)
            setTextColor(Color.WHITE)
            val bg = GradientDrawable().apply {
                setColor(0xB3000000.toInt())
                cornerRadius = 6 * density
            }
            background = bg
            setPadding((6 * density).toInt(), (2 * density).toInt(), (6 * density).toInt(), (2 * density).toInt())
            visibility = View.GONE
            tag = "source"
        }
        posterFrame.addView(sourceBadge)

        // Progress bar (bottom of poster)
        val progressTrack = FrameLayout(ctx).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                (4 * density).toInt(),
                Gravity.BOTTOM
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

        // Title area below poster
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
            val scale = if (hasFocus) 1.05f else 1.0f
            border?.visibility = if (hasFocus) View.VISIBLE else View.INVISIBLE

            val scaleX = ObjectAnimator.ofFloat(v, "scaleX", scale)
            val scaleY = ObjectAnimator.ofFloat(v, "scaleY", scale)
            AnimatorSet().apply {
                playTogether(scaleX, scaleY)
                duration = 150
                start()
            }
        }

        return ViewHolder(root)
    }

    override fun onBindViewHolder(viewHolder: ViewHolder, item: Any) {
        val card = item as CardItem
        val root = viewHolder.view
        val ctx = root.context
        val density = ctx.resources.displayMetrics.density

        val poster = root.findViewWithTag<ImageView>("poster")
        val title = root.findViewWithTag<TextView>("title")
        val subtitle = root.findViewWithTag<TextView>("subtitle")
        val rating = root.findViewWithTag<TextView>("rating")
        val source = root.findViewWithTag<TextView>("source")
        val progressTrack = root.findViewWithTag<FrameLayout>("progressTrack")
        val progressFill = root.findViewWithTag<View>("progressFill")

        title?.text = card.title
        subtitle?.text = card.subtitle

        // Load poster
        if (!card.posterUrl.isNullOrBlank()) {
            ImageUtils.loadInto(ctx, card.posterUrl, poster!!)
        } else {
            poster?.setImageDrawable(null)
            poster?.setBackgroundColor(ctx.getColor(R.color.bg_card))
        }

        // Rating badge
        if (card.rating.isNotBlank() && card.rating != "0" && card.rating != "0.0") {
            rating?.text = "★ ${card.rating}"
            rating?.visibility = View.VISIBLE
        } else {
            rating?.visibility = View.GONE
        }

        // Source badge
        if (card.sourceName.isNotBlank()) {
            source?.text = card.sourceName
            source?.visibility = View.VISIBLE
        } else {
            source?.visibility = View.GONE
        }

        // Progress bar
        if (card.progress > 0f) {
            progressTrack?.visibility = View.VISIBLE
            val trackWidth = (CARD_WIDTH_DP * density).toInt()
            val fillWidth = (trackWidth * card.progress.coerceIn(0f, 1f)).toInt()
            progressFill?.layoutParams = FrameLayout.LayoutParams(fillWidth, FrameLayout.LayoutParams.MATCH_PARENT)
        } else {
            progressTrack?.visibility = View.GONE
        }
    }

    override fun onUnbindViewHolder(viewHolder: ViewHolder) {
        val poster = viewHolder.view.findViewWithTag<ImageView>("poster")
        poster?.setImageDrawable(null)
    }

    companion object {
        const val CARD_WIDTH_DP = 160
        const val CARD_HEIGHT_DP = 240
    }
}

/**
 * Unified card data for presenters. Adapts different API models.
 */
data class CardItem(
    val id: String,
    val title: String,
    val subtitle: String,
    val posterUrl: String?,
    val source: String = "",
    val sourceType: String = "",
    val sourceName: String = "",
    val episodes: List<String> = emptyList(),
    val year: String = "",
    val desc: String = "",
    val category: String = "",
    val searchTitle: String = "",
    val rating: String = "",
    val progress: Float = 0f  // 0.0-1.0 watch progress
)
