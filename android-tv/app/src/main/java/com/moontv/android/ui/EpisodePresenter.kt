package com.moontv.android.ui

import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup
import android.widget.TextView
import androidx.leanback.widget.Presenter
import com.moontv.android.R

/**
 * OrionTV-style episode button with focus animation.
 */
class EpisodePresenter : Presenter() {

    override fun onCreateViewHolder(parent: ViewGroup): ViewHolder {
        val ctx = parent.context
        val density = ctx.resources.displayMetrics.density

        val tv = TextView(ctx).apply {
            val w = (100 * density).toInt()
            val h = (40 * density).toInt()
            layoutParams = ViewGroup.MarginLayoutParams(w, h).apply {
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
                val scaleX = ObjectAnimator.ofFloat(v, "scaleX", 1.1f)
                val scaleY = ObjectAnimator.ofFloat(v, "scaleY", 1.1f)
                AnimatorSet().apply { playTogether(scaleX, scaleY); duration = 100; start() }
            } else {
                bg?.setColor(v.context.getColor(R.color.bg_surface))
                val scaleX = ObjectAnimator.ofFloat(v, "scaleX", 1.0f)
                val scaleY = ObjectAnimator.ofFloat(v, "scaleY", 1.0f)
                AnimatorSet().apply { playTogether(scaleX, scaleY); duration = 100; start() }
            }
        }

        return ViewHolder(tv)
    }

    override fun onBindViewHolder(viewHolder: ViewHolder, item: Any) {
        val episode = item as EpisodeItem
        val tv = viewHolder.view as TextView
        tv.text = episode.label
    }

    override fun onUnbindViewHolder(viewHolder: ViewHolder) {}
}

data class EpisodeItem(
    val index: Int,       // 0-based
    val label: String,    // e.g. "第1集"
    val url: String       // episode URL
)
