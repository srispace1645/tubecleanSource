package com.srinath.tubeclean

import android.content.Context
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewDatabase
import java.io.File

/**
 * Keeps sessions private: search history, local storage, cache and form data are wiped when the app
 * starts and when it's left. YouTube's cookies (the guest ID) are kept until the guest is renewed
 * (see [GuestId]). Only the ad counts and the guest ID survive.
 */
object PrivacyGuard {
    /** WebView profile folders holding site data. Only safe to delete before this process creates its first WebView. */
    private val PROFILE_DIRS = listOf(
        "IndexedDB", "Local Storage", "Session Storage", "Service Worker", "databases", "blob_storage",
        "Cookies", "Cookies-journal", "Web Data", "Web Data-journal", "History", "History-journal",
    )

    fun wipeProfileBeforeWebView(context: Context, keepCookies: Boolean = false) {
        val root = File(context.applicationInfo.dataDir, "app_webview")
        for (base in listOf(root, File(root, "Default"))) {
            for (name in PROFILE_DIRS) {
                if (keepCookies && name.startsWith("Cookies")) continue
                File(base, name).deleteRecursively()
            }
        }
    }

    /** Clears everything the live WebView holds (cookies too, unless [keepCookies]), then runs [done]. */
    fun wipe(web: WebView, keepCookies: Boolean = false, done: () -> Unit = {}) {
        web.clearCache(true)
        web.clearHistory()
        web.clearFormData()
        WebStorage.getInstance().deleteAllData()
        @Suppress("DEPRECATION")
        WebViewDatabase.getInstance(web.context).clearFormData()
        val cookies = CookieManager.getInstance()
        if (keepCookies) {
            cookies.flush()
            done()
            return
        }
        cookies.removeAllCookies {
            cookies.flush()
            done()
        }
    }
}
