package com.srinath.tubeclean

import android.annotation.SuppressLint
import android.annotation.TargetApi
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.io.ByteArrayInputStream

/**
 * Guest-only YouTube with TubeClean's four blocking layers: the TV site driven by the remote on a
 * TV, the mobile site driven by touch on a phone or tablet.
 */
class MainActivity : Activity() {
    private val app get() = application as TubeCleanApp
    private val debuggable get() = applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0

    private val isTv get() = app.isTv

    private lateinit var root: FrameLayout
    private lateinit var web: WebView
    /** TV: fades in when ads are blocked. Phone: always shown, and tapping it opens the stats. */
    private lateinit var badge: TextView
    private lateinit var blocker: AdBlocker

    private var uaIndex = 0
    private var docStartSupported = false
    private var openingStats = false
    private var promptShowing = false
    private var backLongPressed = false
    private var noDrmShown = false
    private var fullscreenView: View? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null

    private val pageScript by lazy {
        // The codec-probe shim is only for the TV site.
        val scripts = if (isTv) listOf("tvcompat.js", "prune.js", "adskip.js") else listOf("prune.js", "adskip.js")
        "window.__TC_RULES=${app.rules.rawJson};\n" + scripts.joinToString("\n") { readAsset(it) }
    }
    private val fadeBadge = Runnable {
        if (isTv) badge.animate().alpha(0f).setDuration(600)
        else showPhoneBadge(expanded = false)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        if (isTv) requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
        else SystemBars.show(this)
        super.onCreate(savedInstanceState)
        // Before this process's first WebView exists, its on-disk profile can simply be deleted.
        if (!app.webViewStarted) PrivacyGuard.wipeProfileBeforeWebView(this)
        app.webViewStarted = true
        blocker = AdBlocker(app.rules)

        web = WebView(this)
        badge = TextView(this).apply {
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, if (isTv) 18f else 14f)
            setPadding(dp(14), dp(8), dp(14), dp(8))
        }
        root = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
            addView(web, FrameLayout.LayoutParams(MATCH, MATCH))
        }
        if (isTv) {
            badge.setBackgroundColor(0xCC000000.toInt())
            badge.alpha = 0f
            root.addView(badge, FrameLayout.LayoutParams(WRAP, WRAP, Gravity.TOP or Gravity.END).apply {
                setMargins(dp(32), dp(24), dp(32), 0)
            })
        } else {
            setUpPhoneBadge()
            // Keep the page clear of the status bar, navigation bar and camera cutout.
            root.setOnApplyWindowInsetsListener { v, insets -> padForSystemBars(v, insets); insets }
        }
        setContentView(root)

        configureWebView()
        PrivacyGuard.wipe(web) { load() }
    }

    override fun onStart() {
        super.onStart()
        openingStats = false
    }

    override fun onResume() {
        super.onResume()
        maybePromptRevision()
    }

    override fun onStop() {
        super.onStop()
        app.stats.flush()
        if (!openingStats && !isChangingConfigurations) {
            // Leaving the app (Home, another app, screensaver) ends the guest session.
            PrivacyGuard.wipe(web)
            finish()
        }
    }

    override fun onDestroy() {
        badge.removeCallbacks(fadeBadge)
        (web.parent as? ViewGroup)?.removeView(web)
        web.destroy()
        super.onDestroy()
    }

    // ---- Remote control -----------------------------------------------------------

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        when (event.keyCode) {
            KeyEvent.KEYCODE_BACK -> { if (isTv) onBackKey(event) else onPhoneBack(event); return true }
            KeyEvent.KEYCODE_MENU -> { if (event.action == KeyEvent.ACTION_UP) openStats(); return true }
        }
        return super.dispatchKeyEvent(event)
    }

    /** Short press: back inside YouTube (it treats Escape as Back). Long press: exit. */
    private fun onBackKey(e: KeyEvent) {
        when (e.action) {
            KeyEvent.ACTION_DOWN ->
                if (e.repeatCount == 0) backLongPressed = false
                else if (!backLongPressed && e.eventTime - e.downTime >= LONG_PRESS_MS) {
                    backLongPressed = true
                    finish()
                }
            KeyEvent.ACTION_UP -> if (!backLongPressed) backInPage()
        }
    }

    /** Phone Back (button or gesture): leave fullscreen, then go back through the mobile site, then exit. */
    private fun onPhoneBack(e: KeyEvent) {
        if (e.action != KeyEvent.ACTION_UP || e.isCanceled) return
        when {
            fullscreenView != null -> exitFullscreen()
            web.canGoBack() -> web.goBack()
            else -> finish()
        }
    }

    private fun backInPage() {
        if (!isTv) {
            if (fullscreenView != null) exitFullscreen()
            if (web.canGoBack()) web.goBack()
            return
        }
        web.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ESCAPE))
        web.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ESCAPE))
    }

    private fun openStats() {
        openingStats = true
        startActivity(Intent(this, StatsActivity::class.java))
    }

    // ---- WebView ------------------------------------------------------------------

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        web.setBackgroundColor(Color.BLACK)
        web.isFocusable = true
        web.isFocusableInTouchMode = true
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true // YouTube TV needs it during a session; wiped at start and exit
            mediaPlaybackRequiresUserGesture = false
            @Suppress("DEPRECATION")
            saveFormData = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            allowFileAccess = false
            allowContentAccess = false
            useWideViewPort = true
            loadWithOverviewMode = true
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(web, false)
        }
        if (debuggable) WebView.setWebContentsDebuggingEnabled(true)

        web.addJavascriptInterface(Bridge(), "TubeCleanBridge")
        docStartSupported = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
        if (docStartSupported) {
            val origins = app.rules.allowedHosts.map { "https://$it" }.toSet()
            WebViewCompat.addDocumentStartJavaScript(web, pageScript, origins)
        }
        Log.i(TAG, "rules ${app.rules.version}; document-start scripts: $docStartSupported")

        web.webViewClient = Client()
        web.webChromeClient = Chrome()
    }

    private fun load() {
        // No user agents listed (the mobile site) means the WebView's own.
        app.rules.userAgents.getOrNull(uaIndex)?.let { web.settings.userAgentString = it }
        web.loadUrl(app.rules.startUrl)
        web.requestFocus()
    }

    /** YouTube TV rejected this user agent: try the next one, and flag a revision once they're all used up. */
    private fun onUnsupported(detail: String) {
        if (uaIndex < app.rules.userAgents.lastIndex) {
            uaIndex++
            Log.w(TAG, "YouTube TV rejected user agent #${uaIndex - 1} ($detail); trying #$uaIndex")
            PrivacyGuard.wipe(web) { load() }
        } else {
            reportHealth("SITE_CHANGED", detail)
        }
    }

    private fun showOffline() {
        AlertDialog.Builder(this)
            .setTitle(R.string.offline_title)
            .setMessage(R.string.offline_message)
            .setPositiveButton(R.string.retry) { _, _ -> load() }
            .setNegativeButton(R.string.exit) { _, _ -> finish() }
            .setCancelable(false)
            .show()
    }

    private inner class Client : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            val url = request.url.toString()
            val verdict = blocker.classify(url)
            if (verdict == AdBlocker.Verdict.ALLOW) return null
            if (verdict != AdBlocker.Verdict.SIGN_IN) app.stats.addBlockedRequest()
            Log.d(TAG, "blocked $verdict ${AdBlocker.hostAndPath(url)}")
            return emptyResponse(request)
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
            refuseNavigation(request.url.toString())

        /** Android 5–6 (Fire OS 5) only call this older overload. */
        @Deprecated("Called instead of the WebResourceRequest overload before Android 7")
        override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean = refuseNavigation(url)

        private fun refuseNavigation(url: String): Boolean {
            if (blocker.classify(url) == AdBlocker.Verdict.SIGN_IN) {
                Toast.makeText(this@MainActivity, R.string.guest_only, Toast.LENGTH_LONG).show()
                return true
            }
            if (!blocker.isAllowedHost(url)) {
                Log.i(TAG, "refused navigation to ${AdBlocker.hostAndPath(url).substringBefore('/')}")
                return true
            }
            return false
        }

        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
            if (!docStartSupported) view.evaluateJavascript(pageScript, null)
        }

        override fun onPageFinished(view: WebView, url: String) {
            // Scripts guard against running twice; this catches pages where onPageStarted was too early.
            if (!docStartSupported) view.evaluateJavascript(pageScript, null)
            // Unsupported browsers get redirected from /tv to the desktop site.
            val marker = app.rules.tvPathMarker
            if (marker.isNotEmpty() && blocker.isAllowedHost(url) && !AdBlocker.hostAndPath(url).contains(marker)) {
                onUnsupported("redirected away from ${app.rules.tvPathMarker}")
            }
        }

        @TargetApi(Build.VERSION_CODES.M) // only called on Android 6+
        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) onMainFrameError(error.errorCode, error.description)
        }

        /** Android 5 (Fire OS 5) only calls this older overload, and only for the main frame. */
        @Deprecated("Called instead of the WebResourceError overload before Android 6")
        override fun onReceivedError(view: WebView, errorCode: Int, description: String?, failingUrl: String?) =
            onMainFrameError(errorCode, description)

        private fun onMainFrameError(code: Int, description: CharSequence?) {
            when (code) {
                ERROR_HOST_LOOKUP, ERROR_CONNECT, ERROR_TIMEOUT, ERROR_IO -> showOffline()
                else -> reportHealth("SITE_CHANGED", "load error $code: $description")
            }
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
            if (request.isForMainFrame && response.statusCode in 400..499) onUnsupported("HTTP ${response.statusCode}")
        }

        @TargetApi(Build.VERSION_CODES.O)
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // Low-memory Fire Sticks can lose the renderer; restart cleanly instead of crashing.
            Log.w(TAG, "renderer gone (crash=${detail.didCrash()}); restarting")
            startActivity(Intent(this@MainActivity, MainActivity::class.java))
            finish()
            return true
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onCloseWindow(window: WebView) = finish()

        /**
         * Many music videos reach TV clients Widevine-protected; WebView refuses DRM unless the app
         * allows it, which YouTube reports as "This video format is not supported". Allow protected
         * media for YouTube only; everything else (camera, microphone, ...) stays denied.
         */
        override fun onPermissionRequest(request: PermissionRequest) {
            val drm = PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID
            if (blocker.isAllowedHost(request.origin.toString()) && drm in request.resources) {
                request.grant(arrayOf(drm))
            } else {
                request.deny()
            }
        }

        /** Hides the grey "play" placeholder WebView draws before a video starts. */
        override fun getDefaultVideoPoster(): Bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)

        /** The mobile site's fullscreen button: show the player over everything, landscape, without system bars. */
        override fun onShowCustomView(view: View, callback: CustomViewCallback) {
            if (isTv) return super.onShowCustomView(view, callback)
            if (fullscreenView != null) { callback.onCustomViewHidden(); return }
            fullscreenView = view
            fullscreenCallback = callback
            root.addView(view, FrameLayout.LayoutParams(MATCH, MATCH))
            badge.visibility = View.GONE
            hideSystemBars(true)
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        }

        override fun onHideCustomView() {
            if (isTv) return super.onHideCustomView()
            closeFullscreenView()
        }

        override fun onConsoleMessage(message: ConsoleMessage): Boolean {
            if (debuggable) Log.v(TAG, "js: ${message.message()}")
            return true
        }
    }

    /** The page scripts' only way to talk to the app. Every call carries counts or problem codes, never video details. */
    private inner class Bridge {
        @JavascriptInterface
        fun videoStarted() = runOnUiThread {
            app.stats.videoStarted()
            if (!isTv) showPhoneBadge(expanded = false)
        }

        @JavascriptInterface
        fun adsPruned(n: Int) = runOnUiThread { addAds(n) }

        @JavascriptInterface
        fun adSkipped() = runOnUiThread { addAds(1) }

        @JavascriptInterface
        fun playing(isPlaying: Boolean) = runOnUiThread {
            if (isPlaying) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }

        /** Guest auto-entry: the TV UI only reacts to real key presses, so the page asks the app to press them. */
        @JavascriptInterface
        fun remoteKey(action: String) = runOnUiThread {
            val key = when (action) {
                "select" -> KeyEvent.KEYCODE_DPAD_CENTER
                "down" -> KeyEvent.KEYCODE_DPAD_DOWN
                else -> return@runOnUiThread
            }
            web.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, key))
            web.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, key))
        }

        /**
         * Most popular videos reach TV clients Widevine-protected. Without working Widevine (e.g. the
         * Android TV emulator) they sit on a black loading screen, so say why, once per launch.
         */
        @JavascriptInterface
        fun noDrm() = runOnUiThread {
            if (noDrmShown) return@runOnUiThread
            noDrmShown = true
            Log.w(TAG, "Widevine DRM unavailable in WebView")
            Toast.makeText(this@MainActivity, R.string.no_widevine, Toast.LENGTH_LONG).show()
        }

        /** A DRM-protected video can't start on this device: say so and go back to the previous screen. */
        @JavascriptInterface
        fun drmBlocked() = runOnUiThread {
            Log.i(TAG, "left a DRM-protected video (no Widevine)")
            Toast.makeText(this@MainActivity, R.string.drm_blocked, Toast.LENGTH_LONG).show()
            backInPage()
        }

        @JavascriptInterface
        fun health(code: String, detail: String) = runOnUiThread {
            when (code) {
                "SITE_CHANGED" -> onUnsupported(detail)
                in HealthMonitor.CODES -> reportHealth(code, detail)
            }
        }
    }

    // ---- Stats badge and revision prompt ------------------------------------------

    private fun addAds(n: Int) {
        val count = n.coerceIn(0, MAX_ADS_PER_EVENT)
        if (count == 0) return
        app.stats.addAds(count)
        badge.removeCallbacks(fadeBadge)
        if (isTv) {
            val total = app.stats.currentVideoAds
            badge.text = resources.getQuantityString(R.plurals.badge, total, total)
            badge.animate().cancel()
            badge.alpha = 1f
        } else {
            showPhoneBadge(expanded = true)
        }
        badge.postDelayed(fadeBadge, BADGE_MS)
    }

    private fun reportHealth(code: String, detail: String) {
        Log.w(TAG, "health $code: $detail")
        if (app.health.report(code, detail)) {
            Toast.makeText(this, if (isTv) R.string.revision_toast else R.string.revision_toast_phone, Toast.LENGTH_LONG).show()
        }
    }

    // ---- Phone: stats button, system bars, fullscreen video ------------------------

    /** Phones have no ☰ key, so the badge stays on screen as a small button that opens the stats. */
    private fun setUpPhoneBadge() {
        badge.background = GradientDrawable().apply {
            cornerRadius = dp(20).toFloat()
            setColor(0xD9202020.toInt())
            setStroke(dp(1), 0x55FFFFFF)
        }
        badge.contentDescription = getString(R.string.stats_button)
        badge.setOnClickListener { openStats() }
        // Above the mobile site's bottom tab bar, clear of its controls.
        root.addView(badge, FrameLayout.LayoutParams(WRAP, WRAP, Gravity.BOTTOM or Gravity.END).apply {
            setMargins(0, 0, dp(12), dp(92))
        })
        showPhoneBadge(expanded = false)
    }

    private fun showPhoneBadge(expanded: Boolean) {
        val total = app.stats.currentVideoAds
        badge.text = if (expanded) resources.getQuantityString(R.plurals.badge, total, total) else "🛡 $total"
        badge.alpha = if (expanded) 1f else 0.8f
    }

    private fun padForSystemBars(v: View, insets: WindowInsets) {
        when {
            fullscreenView != null -> v.setPadding(0, 0, 0, 0)
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.R -> {
                val i = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                v.setPadding(i.left, i.top, i.right, i.bottom)
            }
            else -> @Suppress("DEPRECATION") v.setPadding(
                insets.systemWindowInsetLeft, insets.systemWindowInsetTop,
                insets.systemWindowInsetRight, insets.systemWindowInsetBottom,
            )
        }
    }

    @Suppress("DEPRECATION") // still honoured on every Android version, and avoids an androidx.core dependency
    private fun hideSystemBars(on: Boolean) {
        window.decorView.systemUiVisibility = if (!on) 0 else
            View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        root.requestApplyInsets()
    }

    /** Back during fullscreen: restore the normal layout, then tell the page. */
    private fun exitFullscreen() {
        val callback = fullscreenCallback
        closeFullscreenView()
        callback?.onCustomViewHidden()
    }

    private fun closeFullscreenView() {
        val view = fullscreenView ?: return
        fullscreenView = null
        fullscreenCallback = null
        root.removeView(view)
        badge.visibility = View.VISIBLE
        hideSystemBars(false)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    }

    private fun maybePromptRevision() {
        if (promptShowing || !app.health.shouldPrompt()) return
        promptShowing = true
        RevisionDialog.prompt(this, app.health) { promptShowing = false }
    }

    /** A refused request gets an empty 204, with CORS headers so the page's own scripts see it succeed. */
    private fun emptyResponse(request: WebResourceRequest): WebResourceResponse {
        val origin = request.requestHeaders.entries.firstOrNull { it.key.equals("Origin", ignoreCase = true) }?.value
        return WebResourceResponse(
            "text/plain", "utf-8", 204, "No Content",
            mapOf(
                "Access-Control-Allow-Origin" to (origin?.takeIf { blocker.isAllowedHost(it) } ?: startOrigin),
                "Access-Control-Allow-Credentials" to "true",
            ),
            ByteArrayInputStream(ByteArray(0)),
        )
    }

    /** "https://m.youtube.com/" -> "https://m.youtube.com" */
    private val startOrigin by lazy { "https://" + AdBlocker.hostAndPath(app.rules.startUrl).substringBefore('/') }

    private fun readAsset(name: String) = assets.open(name).bufferedReader().use { it.readText() }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private companion object {
        const val TAG = "TubeClean"
        const val LONG_PRESS_MS = 800L
        const val BADGE_MS = 3000L
        const val MAX_ADS_PER_EVENT = 50
        const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
        const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT
    }
}
