package com.moontv.android

import android.app.Application
import coil.ImageLoader
import coil.ImageLoaderFactory

class TvApplication : Application(), ImageLoaderFactory {

    override fun newImageLoader(): ImageLoader {
        return ImageLoader.Builder(this)
            .crossfade(true)
            .build()
    }
}
