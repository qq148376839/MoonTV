package com.moontv.android.util

import android.content.Context
import android.graphics.drawable.Drawable
import android.widget.ImageView
import androidx.leanback.widget.ImageCardView
import coil.imageLoader
import coil.request.ImageRequest

object ImageUtils {

    fun loadInto(context: Context, url: String?, target: ImageView) {
        if (url.isNullOrBlank()) return
        val request = ImageRequest.Builder(context)
            .data(url)
            .target(target)
            .crossfade(true)
            .build()
        context.imageLoader.enqueue(request)
    }

    fun loadIntoCardView(context: Context, url: String?, cardView: ImageCardView) {
        if (url.isNullOrBlank()) return
        val request = ImageRequest.Builder(context)
            .data(url)
            .target(
                onSuccess = { drawable: Drawable ->
                    cardView.mainImageView?.setImageDrawable(drawable)
                },
                onError = { _: Drawable? -> }
            )
            .crossfade(true)
            .build()
        context.imageLoader.enqueue(request)
    }
}
