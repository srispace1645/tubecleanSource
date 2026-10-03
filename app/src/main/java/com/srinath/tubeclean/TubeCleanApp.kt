package com.srinath.tubeclean

import android.app.Application
import android.app.UiModeManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import java.io.File

class TubeCleanApp : Application() {
    /** TVs get YouTube's TV site and the remote; phones and tablets get the mobile site and touch. */
    val isTv: Boolean by lazy {
        val ui = getSystemService(Context.UI_MODE_SERVICE) as UiModeManager
        ui.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION ||
            packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK) ||
            packageManager.hasSystemFeature("amazon.hardware.fire_tv")
    }

    val rules: Rules by lazy {
        Rules.parse(assets.open("rules.json").bufferedReader().use { it.readText() }, if (isTv) null else Rules.PHONE)
    }
    val stats: StatsStore by lazy { StatsStore(File(filesDir, "stats.json")) }
    val health: HealthMonitor by lazy { HealthMonitor(File(filesDir, "health.json"), rules.version) }

    /** Set once this process has created a WebView; after that its profile folders must not be deleted from under it. */
    var webViewStarted = false
}
