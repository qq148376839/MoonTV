package com.moontv.android

import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.ui.PlayerView
import com.moontv.android.api.ApiClient
import com.moontv.android.api.PlayRecord
import com.moontv.android.api.SearchResult
import com.moontv.android.util.Prefs
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json

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

    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    // Source switching
    private var allResults: List<SearchResult> = emptyList()
    private var currentSource: String = ""
    private var currentSourceType: String = ""
    private var currentSourceName: String = ""
    private var currentId: String = ""
    private var currentEpisodeIndex: Int = 0
    private var currentEpisodes: List<String> = emptyList()
    private var currentTitle: String = ""

    // Panels
    private var sourcePanelContainer: FrameLayout? = null
    private var episodePanelContainer: FrameLayout? = null
    private var speedPanelContainer: FrameLayout? = null
    private var speedBadge: TextView? = null
    private var currentSpeed: Float = 1.0f
    private var panelVisible: String? = null // "source", "episode", "speed", or null

    // Long press detection
    private var centerKeyDownTime: Long = 0L

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

        // Parse extras
        currentTitle = intent.getStringExtra(EXTRA_TITLE) ?: ""
        currentSource = intent.getStringExtra(EXTRA_SOURCE) ?: ""
        currentSourceName = intent.getStringExtra(EXTRA_SOURCE_NAME) ?: ""
        currentSourceType = intent.getStringExtra(EXTRA_SOURCE_TYPE) ?: ""
        currentId = intent.getStringExtra(EXTRA_ID) ?: ""
        currentEpisodeIndex = intent.getIntExtra(EXTRA_EPISODE_INDEX, 0)

        // Parse all results for source switching
        val allResultsStr = intent.getStringExtra(EXTRA_ALL_RESULTS)
        if (!allResultsStr.isNullOrBlank() && allResultsStr != "[]") {
            try {
                allResults = json.decodeFromString(allResultsStr)
            } catch (_: Exception) {}
        }

        // Parse episodes for episode switching
        val episodesStr = intent.getStringExtra(EXTRA_EPISODES_JSON)
        if (!episodesStr.isNullOrBlank()) {
            try {
                currentEpisodes = json.decodeFromString(episodesStr)
            } catch (_: Exception) {}
        }

        // Show title overlay
        val subtitle = intent.getStringExtra(EXTRA_SUBTITLE) ?: ""
        val displayTitle = "$currentTitle - $subtitle".trim(' ', '-')
        if (displayTitle.isNotBlank()) {
            titleOverlayView.text = displayTitle
            titleOverlayView.visibility = View.VISIBLE
            handler.postDelayed(hideTitleRunnable, 3000)
        }

        // Create speed badge
        createSpeedBadge()

        initPlayer(url)
    }

    @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
    private fun initPlayer(url: String) {
        player?.release()
        player = ExoPlayer.Builder(this).build().also { exoPlayer ->
            playerView.player = exoPlayer
            playerView.useController = false

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

            // Restore speed if not 1.0
            if (currentSpeed != 1.0f) {
                exoPlayer.playbackParameters = PlaybackParameters(currentSpeed)
            }

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

    private fun createSpeedBadge() {
        val rootView = findViewById<FrameLayout>(android.R.id.content)
        val density = resources.displayMetrics.density

        speedBadge = TextView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP or Gravity.END
            ).apply {
                topMargin = (24 * density).toInt()
                marginEnd = (32 * density).toInt()
            }
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setTextColor(Color.WHITE)
            val bg = GradientDrawable().apply {
                setColor(0xB3000000.toInt())
                cornerRadius = 6 * density
            }
            background = bg
            setPadding(
                (10 * density).toInt(), (4 * density).toInt(),
                (10 * density).toInt(), (4 * density).toInt()
            )
            visibility = View.GONE
        }
        rootView.addView(speedBadge)
    }

    private fun updateSpeedBadge() {
        if (currentSpeed != 1.0f) {
            speedBadge?.text = "${currentSpeed}x"
            speedBadge?.visibility = View.VISIBLE
        } else {
            speedBadge?.visibility = View.GONE
        }
    }

    private fun showSeekOverlay() {
        val p = player ?: return
        val pos = p.currentPosition
        val dur = if (p.duration > 0) p.duration else 0L

        seekCurrentTime.text = formatTime(pos)
        seekTotalTime.text = formatTime(dur)

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

    // ==================== Panel Management ====================

    private fun showSourcePanel() {
        if (allResults.size <= 1) return
        hideAllPanels()
        panelVisible = "source"

        val rootView = findViewById<FrameLayout>(android.R.id.content)
        val density = resources.displayMetrics.density

        val container = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP
            )
            setBackgroundColor(0xE6151718.toInt())
            setPadding(
                (48 * density).toInt(), (24 * density).toInt(),
                (48 * density).toInt(), (24 * density).toInt()
            )
        }

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }

        // Title
        val titleTv = TextView(this@PlayerActivity).apply {
            text = "切换源"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            setTextColor(Color.WHITE)
            setPadding(0, 0, 0, (16 * density).toInt())
        }
        content.addView(titleTv)

        // Source buttons in a flow layout (3 per row)
        var rowLayout = createButtonRow(density)
        var colCount = 0

        allResults.forEach { result ->
            val isCurrent = result.source == currentSource && result.id == currentId
            val btn = createPanelButton(
                text = result.sourceName.ifEmpty { result.source },
                isCurrent = isCurrent,
                density = density
            )
            btn.setOnClickListener { switchSource(result) }
            btn.setOnFocusChangeListener { v, hasFocus ->
                val bg = v.background as? GradientDrawable
                val isCurrentSrc = (v.tag as? Boolean) == true
                if (hasFocus) {
                    bg?.setColor(getColor(R.color.primary))
                } else {
                    bg?.setColor(
                        if (isCurrentSrc) getColor(R.color.primary_dark)
                        else getColor(R.color.bg_surface)
                    )
                }
            }
            btn.tag = isCurrent
            rowLayout.addView(btn)
            colCount++
            if (colCount % 3 == 0) {
                content.addView(rowLayout)
                rowLayout = createButtonRow(density)
            }
        }
        if (colCount % 3 != 0) {
            content.addView(rowLayout)
        }

        container.addView(content)
        rootView.addView(container)
        sourcePanelContainer = container

        // Focus first button
        container.post {
            val firstBtn = findFirstFocusableChild(content)
            firstBtn?.requestFocus()
        }
    }

    private fun showEpisodePanel() {
        if (currentEpisodes.isEmpty()) return
        hideAllPanels()
        panelVisible = "episode"

        val rootView = findViewById<FrameLayout>(android.R.id.content)
        val density = resources.displayMetrics.density

        val container = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                (280 * density).toInt(),
                Gravity.BOTTOM
            )
            setBackgroundColor(0xE6151718.toInt())
            setPadding(
                (48 * density).toInt(), (24 * density).toInt(),
                (48 * density).toInt(), (24 * density).toInt()
            )
        }

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        }

        // Title with episode range tabs
        val headerRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        val titleTv = TextView(this@PlayerActivity).apply {
            text = "选集"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            setTextColor(Color.WHITE)
            setPadding(0, 0, (24 * density).toInt(), 0)
        }
        headerRow.addView(titleTv)

        // Episode range tabs if many episodes
        val totalEp = currentEpisodes.size
        val rangeSize = 30
        val ranges = (0 until totalEp step rangeSize).map { start ->
            val end = minOf(start + rangeSize, totalEp)
            Pair(start, end)
        }

        // Default to range containing current episode
        var activeRange = ranges.indexOfFirst {
            currentEpisodeIndex in it.first until it.second
        }.coerceAtLeast(0)

        val rangeButtons = mutableListOf<TextView>()
        if (ranges.size > 1) {
            ranges.forEachIndexed { idx, (start, end) ->
                val rangeBtn = TextView(this@PlayerActivity).apply {
                    text = "${start + 1}-$end"
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                    setTextColor(
                        if (idx == activeRange) Color.WHITE
                        else getColor(R.color.text_muted)
                    )
                    val bg = GradientDrawable().apply {
                        setColor(
                            if (idx == activeRange) getColor(R.color.primary)
                            else getColor(R.color.bg_surface)
                        )
                        cornerRadius = 4 * density
                    }
                    background = bg
                    setPadding(
                        (12 * density).toInt(), (4 * density).toInt(),
                        (12 * density).toInt(), (4 * density).toInt()
                    )
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.WRAP_CONTENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT
                    ).apply {
                        marginEnd = (8 * density).toInt()
                    }
                    isFocusable = true
                    isFocusableInTouchMode = true
                }
                rangeButtons.add(rangeBtn)
                headerRow.addView(rangeBtn)
            }
        }

        content.addView(headerRow)

        // Scrollable episode grid
        val scrollView = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0, 1f
            ).apply {
                topMargin = (12 * density).toInt()
            }
        }

        val episodeGrid = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            tag = "episodeGrid"
        }
        scrollView.addView(episodeGrid)
        content.addView(scrollView)

        container.addView(content)
        rootView.addView(container)
        episodePanelContainer = container

        // Function to populate episodes for a range
        fun populateEpisodes(rangeIdx: Int) {
            episodeGrid.removeAllViews()
            val (start, end) = ranges[rangeIdx]
            var row = createButtonRow(density)
            var colCount = 0

            for (i in start until end) {
                val isCurrent = i == currentEpisodeIndex
                val btn = createPanelButton(
                    text = "${i + 1}",
                    isCurrent = isCurrent,
                    density = density,
                    width = (56 * density).toInt()
                )
                btn.setOnClickListener { switchEpisode(i) }
                btn.tag = isCurrent
                btn.setOnFocusChangeListener { v, hasFocus ->
                    val bg = v.background as? GradientDrawable
                    val isCurrentEp = (v.tag as? Boolean) == true
                    if (hasFocus) {
                        bg?.setColor(getColor(R.color.primary))
                    } else {
                        bg?.setColor(
                            if (isCurrentEp) getColor(R.color.primary_dark)
                            else getColor(R.color.bg_surface)
                        )
                    }
                }
                row.addView(btn)
                colCount++
                if (colCount % 5 == 0) {
                    episodeGrid.addView(row)
                    row = createButtonRow(density)
                }
            }
            if (colCount % 5 != 0) {
                episodeGrid.addView(row)
            }
        }

        // Setup range tab clicks
        rangeButtons.forEachIndexed { idx, btn ->
            btn.setOnClickListener {
                activeRange = idx
                rangeButtons.forEachIndexed { i, b ->
                    val bg = b.background as? GradientDrawable
                    if (i == activeRange) {
                        bg?.setColor(getColor(R.color.primary))
                        b.setTextColor(Color.WHITE)
                    } else {
                        bg?.setColor(getColor(R.color.bg_surface))
                        b.setTextColor(getColor(R.color.text_muted))
                    }
                }
                populateEpisodes(idx)
            }
            btn.setOnFocusChangeListener { v, hasFocus ->
                val bg = v.background as? GradientDrawable
                if (hasFocus) {
                    bg?.setColor(getColor(R.color.primary))
                    (v as TextView).setTextColor(Color.WHITE)
                } else {
                    val isActive = rangeButtons.indexOf(v) == activeRange
                    bg?.setColor(
                        if (isActive) getColor(R.color.primary)
                        else getColor(R.color.bg_surface)
                    )
                    (v as TextView).setTextColor(
                        if (isActive) Color.WHITE
                        else getColor(R.color.text_muted)
                    )
                }
            }
        }

        populateEpisodes(activeRange)

        // Focus current episode button
        container.post {
            val firstBtn = findFirstFocusableChild(episodeGrid)
            firstBtn?.requestFocus()
        }
    }

    private fun showSpeedPanel() {
        hideAllPanels()
        panelVisible = "speed"

        val rootView = findViewById<FrameLayout>(android.R.id.content)
        val density = resources.displayMetrics.density

        val container = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER
            )
            setBackgroundColor(0xE6151718.toInt())
            setPadding(
                (48 * density).toInt(), (24 * density).toInt(),
                (48 * density).toInt(), (24 * density).toInt()
            )
        }

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
        }

        val titleTv = TextView(this@PlayerActivity).apply {
            text = "播放速度"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            setTextColor(Color.WHITE)
            setPadding(0, 0, 0, (16 * density).toInt())
        }
        content.addView(titleTv)

        val speeds = listOf(0.5f, 0.75f, 1.0f, 1.25f, 1.5f, 1.75f, 2.0f)
        var row = createButtonRow(density)
        var colCount = 0

        speeds.forEach { speed ->
            val isCurrent = speed == currentSpeed
            val label = if (speed == 1.0f) "1.0x (正常)" else "${speed}x"
            val btn = createPanelButton(
                text = label,
                isCurrent = isCurrent,
                density = density
            )
            btn.setOnClickListener { setPlaybackSpeed(speed) }
            btn.tag = isCurrent
            btn.setOnFocusChangeListener { v, hasFocus ->
                val bg = v.background as? GradientDrawable
                val isCurrentSpd = (v.tag as? Boolean) == true
                if (hasFocus) {
                    bg?.setColor(getColor(R.color.primary))
                } else {
                    bg?.setColor(
                        if (isCurrentSpd) getColor(R.color.primary_dark)
                        else getColor(R.color.bg_surface)
                    )
                }
            }
            row.addView(btn)
            colCount++
            if (colCount % 4 == 0) {
                content.addView(row)
                row = createButtonRow(density)
            }
        }
        if (colCount % 4 != 0) {
            content.addView(row)
        }

        container.addView(content)
        rootView.addView(container)
        speedPanelContainer = container

        container.post {
            val firstBtn = findFirstFocusableChild(content)
            firstBtn?.requestFocus()
        }
    }

    private fun createButtonRow(density: Float): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = (8 * density).toInt()
            }
        }
    }

    private fun createPanelButton(
        text: String,
        isCurrent: Boolean,
        density: Float,
        width: Int = (140 * density).toInt()
    ): TextView {
        return TextView(this).apply {
            this.text = if (isCurrent) "$text (当前)" else text
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            val bg = GradientDrawable().apply {
                setColor(
                    if (isCurrent) getColor(R.color.primary_dark)
                    else getColor(R.color.bg_surface)
                )
                cornerRadius = 8 * density
            }
            background = bg
            layoutParams = LinearLayout.LayoutParams(width, (42 * density).toInt()).apply {
                marginEnd = (8 * density).toInt()
            }
            setPadding((8 * density).toInt(), 0, (8 * density).toInt(), 0)
            isFocusable = true
            isFocusableInTouchMode = true
        }
    }

    private fun findFirstFocusableChild(parent: ViewGroup): View? {
        for (i in 0 until parent.childCount) {
            val child = parent.getChildAt(i)
            if (child.isFocusable && child !is ViewGroup) return child
            if (child is ViewGroup) {
                val found = findFirstFocusableChild(child)
                if (found != null) return found
            }
        }
        return null
    }

    private fun hideAllPanels() {
        val rootView = findViewById<FrameLayout>(android.R.id.content)
        sourcePanelContainer?.let { rootView.removeView(it) }
        episodePanelContainer?.let { rootView.removeView(it) }
        speedPanelContainer?.let { rootView.removeView(it) }
        sourcePanelContainer = null
        episodePanelContainer = null
        speedPanelContainer = null
        panelVisible = null
    }

    // ==================== Source/Episode Switching ====================

    private fun switchSource(newResult: SearchResult) {
        val savedPosition = player?.currentPosition ?: 0L

        // Update current state
        currentSource = newResult.source
        currentSourceName = newResult.sourceName
        currentSourceType = newResult.sourceType
        currentId = newResult.id
        currentEpisodes = newResult.episodes

        // Clamp episode index
        if (currentEpisodeIndex >= currentEpisodes.size) {
            currentEpisodeIndex = 0
        }

        hideAllPanels()

        val serverUrl = Prefs.getServerUrl(this) ?: return
        val newUrl = buildPlayUrl(serverUrl, newResult, currentEpisodeIndex)

        // Show title with new source
        val displayTitle = "$currentTitle - 第${currentEpisodeIndex + 1}集 · $currentSourceName"
        titleOverlayView.text = displayTitle
        titleOverlayView.visibility = View.VISIBLE
        titleOverlayView.alpha = 1f
        handler.removeCallbacks(hideTitleRunnable)
        handler.postDelayed(hideTitleRunnable, 3000)

        initPlayer(newUrl)

        // Seek to saved position after player is ready
        player?.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_READY && savedPosition > 0) {
                    player?.seekTo(savedPosition)
                    player?.removeListener(this)
                }
            }
        })
    }

    private fun switchEpisode(newIndex: Int) {
        if (newIndex < 0 || newIndex >= currentEpisodes.size) return

        currentEpisodeIndex = newIndex
        hideAllPanels()

        val serverUrl = Prefs.getServerUrl(this) ?: return
        // Build URL for the current source's new episode
        val result = allResults.find { it.source == currentSource && it.id == currentId }
            ?: SearchResult(
                source = currentSource,
                sourceType = currentSourceType,
                sourceName = currentSourceName,
                id = currentId,
                title = currentTitle,
                episodes = currentEpisodes
            )
        val newUrl = buildPlayUrl(serverUrl, result, newIndex)

        // Show title
        val displayTitle = "$currentTitle - 第${newIndex + 1}集"
        titleOverlayView.text = displayTitle
        titleOverlayView.visibility = View.VISIBLE
        titleOverlayView.alpha = 1f
        handler.removeCallbacks(hideTitleRunnable)
        handler.postDelayed(hideTitleRunnable, 3000)

        initPlayer(newUrl)
    }

    private fun setPlaybackSpeed(speed: Float) {
        currentSpeed = speed
        player?.playbackParameters = PlaybackParameters(speed)
        updateSpeedBadge()
        hideAllPanels()
    }

    private fun buildPlayUrl(serverUrl: String, item: SearchResult, episodeIndex: Int): String {
        val encode = { s: String -> java.net.URLEncoder.encode(s, "UTF-8") }
        val episodeUrl = if (episodeIndex < item.episodes.size) item.episodes[episodeIndex] else ""
        return if (item.sourceType == "official") {
            "$serverUrl/api/official-play.m3u8?" +
                    "url=${encode(episodeUrl)}" +
                    "&source=${encode(item.source)}" +
                    "&id=${encode(item.id)}" +
                    "&ep=${episodeIndex + 1}" +
                    "&total=${item.episodes.size}" +
                    "&q=${encode(item.title.ifEmpty { currentTitle })}"
        } else {
            "$serverUrl/api/unofficial-play.m3u8?" +
                    "source=${encode(item.source)}" +
                    "&id=${encode(item.id)}" +
                    "&q=${encode(item.title.ifEmpty { currentTitle })}" +
                    "&url=${encode(episodeUrl)}" +
                    "&ep=${episodeIndex + 1}" +
                    "&total=${item.episodes.size}"
        }
    }

    // ==================== Key Handling ====================

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        // If a panel is visible, let panel handle navigation
        if (panelVisible != null) {
            if (keyCode == KeyEvent.KEYCODE_BACK) {
                hideAllPanels()
                return true
            }
            // Let D-pad navigate within the panel
            return super.onKeyDown(keyCode, event)
        }

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
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> {
                centerKeyDownTime = System.currentTimeMillis()
                // Don't consume yet - wait for key up to differentiate tap vs long press
                true
            }
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
                if (p.isPlaying) p.pause() else p.play()
                showSeekOverlay()
                true
            }
            KeyEvent.KEYCODE_DPAD_UP -> {
                showSourcePanel()
                true
            }
            KeyEvent.KEYCODE_DPAD_DOWN -> {
                showEpisodePanel()
                true
            }
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> {
                showSpeedPanel()
                true
            }
            KeyEvent.KEYCODE_BACK -> {
                finishWithResult()
                true
            }
            else -> super.onKeyDown(keyCode, event)
        }
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent?): Boolean {
        if (panelVisible != null) {
            return super.onKeyUp(keyCode, event)
        }

        if (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER) {
            val elapsed = System.currentTimeMillis() - centerKeyDownTime
            val p = player
            if (elapsed >= 800) {
                // Long press → speed panel
                showSpeedPanel()
            } else if (p != null) {
                // Short press → play/pause
                if (p.isPlaying) p.pause() else p.play()
                showSeekOverlay()
            }
            return true
        }

        return super.onKeyUp(keyCode, event)
    }

    // ==================== Lifecycle ====================

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
        if (currentSource.isBlank() || currentId.isBlank()) return
        if (currentEpisodeIndex < 0) return

        val totalEpisodes = intent.getIntExtra(EXTRA_TOTAL_EPISODES, currentEpisodes.size)
        val searchTitle = intent.getStringExtra(EXTRA_SEARCH_TITLE) ?: currentTitle

        val key = "$currentSource+$currentId"
        val record = PlayRecord(
            title = currentTitle,
            sourceName = currentSourceName,
            cover = "",
            year = "",
            index = currentEpisodeIndex + 1,
            totalEpisodes = totalEpisodes,
            playTime = p.currentPosition / 1000.0,
            totalTime = (if (p.duration > 0) p.duration else 0L) / 1000.0,
            saveTime = System.currentTimeMillis(),
            searchTitle = searchTitle,
            source = currentSource,
            id = currentId
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
        const val EXTRA_SOURCE_NAME = "extra_source_name"
        const val EXTRA_SOURCE_TYPE = "extra_source_type"
        const val EXTRA_ID = "extra_id"
        const val EXTRA_EPISODE_INDEX = "extra_episode_index"
        const val EXTRA_TOTAL_EPISODES = "extra_total_episodes"
        const val EXTRA_SEARCH_TITLE = "extra_search_title"
        const val EXTRA_ALL_RESULTS = "extra_all_results"
        const val EXTRA_EPISODES_JSON = "extra_episodes_json"
        const val RESULT_CURRENT_TIME = "result_current_time"
        const val RESULT_DURATION = "result_duration"
    }
}
