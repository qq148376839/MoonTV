package com.moontv.android

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.ui.PlayerView
import com.moontv.android.api.ApiClient
import com.moontv.android.api.PlayRecord
import kotlinx.coroutines.launch

class PlayerActivity : FragmentActivity() {

    private var player: ExoPlayer? = null
    private lateinit var playerView: PlayerView
    private lateinit var loadingIndicator: ProgressBar
    private lateinit var titleOverlayView: TextView
    private lateinit var seekOverlay: LinearLayout
    private lateinit var seekCurrentTime: TextView
    private lateinit var seekTotalTime: TextView
    private lateinit var seekProgressFill: View
    private val handler = Handler(Looper.getMainLooper())

    private val hideControlsRunnable = Runnable { hideControls() }
    private val hideTitleRunnable = Runnable {
        titleOverlayView.animate().alpha(0f).setDuration(500)
            .withEndAction { titleOverlayView.visibility = View.GONE }.start()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_player)

        playerView = findViewById(R.id.playerView)
        loadingIndicator = findViewById(R.id.loadingIndicator)
        titleOverlayView = findViewById(R.id.titleOverlay)
        seekOverlay = findViewById(R.id.seekOverlay)
        seekCurrentTime = findViewById(R.id.seekCurrentTime)
        seekTotalTime = findViewById(R.id.seekTotalTime)
        seekProgressFill = findViewById(R.id.seekProgressFill)

        val url = intent.getStringExtra(EXTRA_URL) ?: run {
            finish()
            return
        }

        // Show title overlay
        val title = intent.getStringExtra(EXTRA_TITLE) ?: ""
        val subtitle = intent.getStringExtra(EXTRA_SUBTITLE) ?: ""
        val displayTitle = "$title - $subtitle".trim(' ', '-')
        if (displayTitle.isNotBlank()) {
            titleOverlayView.text = displayTitle
            titleOverlayView.visibility = View.VISIBLE
            handler.postDelayed(hideTitleRunnable, 3000)
        }

        initPlayer(url)
    }

    @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
    private fun initPlayer(url: String) {
        player = ExoPlayer.Builder(this).build().also { exoPlayer ->
            playerView.player = exoPlayer
            playerView.useController = false // We use our own controls

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

    private fun showSeekOverlay() {
        val p = player ?: return
        val pos = p.currentPosition
        val dur = if (p.duration > 0) p.duration else 0L

        seekCurrentTime.text = formatTime(pos)
        seekTotalTime.text = formatTime(dur)

        // Update progress bar
        if (dur > 0) {
            val parent = seekProgressFill.parent as? FrameLayout
            if (parent != null) {
                val fillWidth = (parent.width * (pos.toFloat() / dur)).toInt()
                seekProgressFill.layoutParams = FrameLayout.LayoutParams(
                    fillWidth, FrameLayout.LayoutParams.MATCH_PARENT
                )
            }
        }

        seekOverlay.visibility = View.VISIBLE
        handler.removeCallbacks(hideControlsRunnable)
        handler.postDelayed(hideControlsRunnable, 5000)
    }

    private fun hideControls() {
        seekOverlay.animate().alpha(0f).setDuration(300)
            .withEndAction {
                seekOverlay.visibility = View.GONE
                seekOverlay.alpha = 1f
            }.start()
    }

    private fun formatTime(ms: Long): String {
        val totalSec = ms / 1000
        val h = totalSec / 3600
        val m = (totalSec % 3600) / 60
        val s = totalSec % 60
        return if (h > 0) String.format("%d:%02d:%02d", h, m, s)
        else String.format("%02d:%02d", m, s)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        val p = player ?: return super.onKeyDown(keyCode, event)

        return when (keyCode) {
            KeyEvent.KEYCODE_DPAD_LEFT -> {
                p.seekTo(maxOf(0, p.currentPosition - 20_000))
                showSeekOverlay()
                true
            }
            KeyEvent.KEYCODE_DPAD_RIGHT -> {
                p.seekTo(minOf(p.duration, p.currentPosition + 20_000))
                showSeekOverlay()
                true
            }
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
                if (p.isPlaying) p.pause() else p.play()
                showSeekOverlay()
                true
            }
            KeyEvent.KEYCODE_DPAD_DOWN -> {
                showSeekOverlay()
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
        savePlayRecord()

        val p = player
        val resultIntent = Intent().apply {
            putExtra(RESULT_CURRENT_TIME, (p?.currentPosition ?: 0L) / 1000.0)
            putExtra(RESULT_DURATION, (p?.duration ?: 0L) / 1000.0)
        }
        setResult(Activity.RESULT_OK, resultIntent)
        finish()
    }

    private fun savePlayRecord() {
        val p = player ?: return
        val source = intent.getStringExtra(EXTRA_SOURCE) ?: return
        val id = intent.getStringExtra(EXTRA_ID) ?: return
        val episodeIndex = intent.getIntExtra(EXTRA_EPISODE_INDEX, -1)
        if (episodeIndex < 0) return

        val totalEpisodes = intent.getIntExtra(EXTRA_TOTAL_EPISODES, 0)
        val title = intent.getStringExtra(EXTRA_TITLE) ?: ""
        val searchTitle = intent.getStringExtra(EXTRA_SEARCH_TITLE) ?: title

        val key = "$source+$id"
        val record = PlayRecord(
            title = title,
            sourceName = "",
            cover = "",
            year = "",
            index = episodeIndex + 1,
            totalEpisodes = totalEpisodes,
            playTime = p.currentPosition / 1000.0,
            totalTime = (if (p.duration > 0) p.duration else 0L) / 1000.0,
            saveTime = System.currentTimeMillis(),
            searchTitle = searchTitle,
            source = source,
            id = id
        )

        val api = ApiClient.getInstance(applicationContext)
        lifecycleScope.launch {
            try {
                api.savePlayRecord(key, record)
            } catch (_: Exception) { }
        }
    }

    override fun onPause() {
        super.onPause()
        player?.pause()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        player?.release()
        player = null
        super.onDestroy()
    }

    companion object {
        const val EXTRA_URL = "extra_url"
        const val EXTRA_TITLE = "extra_title"
        const val EXTRA_SUBTITLE = "extra_subtitle"
        const val EXTRA_SOURCE = "extra_source"
        const val EXTRA_ID = "extra_id"
        const val EXTRA_EPISODE_INDEX = "extra_episode_index"
        const val EXTRA_TOTAL_EPISODES = "extra_total_episodes"
        const val EXTRA_SEARCH_TITLE = "extra_search_title"
        const val RESULT_CURRENT_TIME = "result_current_time"
        const val RESULT_DURATION = "result_duration"
    }
}
