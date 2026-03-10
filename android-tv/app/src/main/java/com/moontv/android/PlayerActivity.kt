package com.moontv.android

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.widget.ProgressBar
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.ui.PlayerView

class PlayerActivity : AppCompatActivity() {

    private var player: ExoPlayer? = null
    private lateinit var playerView: PlayerView
    private lateinit var loadingIndicator: ProgressBar

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_player)

        playerView = findViewById(R.id.playerView)
        loadingIndicator = findViewById(R.id.loadingIndicator)

        val url = intent.getStringExtra(EXTRA_URL) ?: run {
            finish()
            return
        }

        initPlayer(url)
    }

    @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
    private fun initPlayer(url: String) {
        player = ExoPlayer.Builder(this).build().also { exoPlayer ->
            playerView.player = exoPlayer

            // Build HLS media source (follows 302 redirects automatically)
            val dataSourceFactory = DefaultHttpDataSource.Factory()
                .setUserAgent("MoonTV-Android/1.0")
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(15_000)
                .setReadTimeoutMs(15_000)

            val hlsSource = HlsMediaSource.Factory(dataSourceFactory)
                .createMediaSource(MediaItem.fromUri(Uri.parse(url)))

            exoPlayer.setMediaSource(hlsSource)
            exoPlayer.prepare()
            exoPlayer.playWhenReady = true

            exoPlayer.addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(playbackState: Int) {
                    when (playbackState) {
                        Player.STATE_BUFFERING -> loadingIndicator.visibility = View.VISIBLE
                        Player.STATE_READY -> loadingIndicator.visibility = View.GONE
                        Player.STATE_ENDED -> finishWithResult()
                        else -> {}
                    }
                }
            })
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        val p = player ?: return super.onKeyDown(keyCode, event)

        return when (keyCode) {
            KeyEvent.KEYCODE_DPAD_LEFT -> {
                p.seekTo(maxOf(0, p.currentPosition - 10_000))
                true
            }
            KeyEvent.KEYCODE_DPAD_RIGHT -> {
                p.seekTo(minOf(p.duration, p.currentPosition + 10_000))
                true
            }
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
                if (p.isPlaying) p.pause() else p.play()
                true
            }
            KeyEvent.KEYCODE_BACK -> {
                finishWithResult()
                true
            }
            else -> super.onKeyDown(keyCode, event)
        }
    }

    private fun finishWithResult() {
        val p = player
        val resultIntent = Intent().apply {
            putExtra(RESULT_CURRENT_TIME, (p?.currentPosition ?: 0L) / 1000.0)
            putExtra(RESULT_DURATION, (p?.duration ?: 0L) / 1000.0)
        }
        setResult(Activity.RESULT_OK, resultIntent)
        finish()
    }

    override fun onPause() {
        super.onPause()
        player?.pause()
    }

    override fun onDestroy() {
        player?.release()
        player = null
        super.onDestroy()
    }

    companion object {
        const val EXTRA_URL = "extra_url"
        const val EXTRA_TITLE = "extra_title"
        const val EXTRA_SUBTITLE = "extra_subtitle"
        const val RESULT_CURRENT_TIME = "result_current_time"
        const val RESULT_DURATION = "result_duration"
    }
}
