package com.srinath.tubeclean

import android.content.Context
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewDatabase
import java.io.File

/**
 * Keeps every session a fresh guest session: search history, watch history, cookies, cache and the
 * guest visitor ID are wiped when the app starts and when it's left. Only the ad counts survive.
 */
object PrivacyGuard {
    /** WebView profile folders holding site data. Only safe to delete before this process creates its first WebView. */
    private val PROFILE_DIRS = listOf(
        "IndexedDB", "Local Storage", "Session Storage", "Service Worker", "databases", "blob_storage",
        "Cookies", "Cookies-journal", "Web Data", "Web Data-journal", "History", "History-journal",
    )

    fun wipeProfileBeforeWebView(context: Context) {
        val root = File(context.applicationInfo.dataDir, "app_webview")
        for (base in listOf(root, File(root, "Default"))) {
            for (name in PROFILE_DIRS) File(base, name).deleteRecursively()
        }
    }

    /** Clears everything the live WebView holds, then runs [done] once cookies are gone. */
    fun wipe(web: WebView, done: () -> Unit = {}) {
        web.clearCache(true)
        web.clearHistory()
        web.clearFormData()
        WebStorage.getInstance().deleteAllData()
        @Suppress("DEPRECATION")
        WebViewDatabase.getInstance(web.context).clearFormData()
        val cookies = CookieManager.getInstance()
        cookies.removeAllCookies {
            cookies.flush()
            done()
        }
    }
}
