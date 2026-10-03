package com.srinath.tubeclean

import android.app.Activity
import android.app.AlertDialog
import android.content.pm.ActivityInfo
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.widget.Button
import android.widget.TextView

/** Stats screen (☰ on a TV remote, the 🛡 button on a phone): ads blocked in this video, today, and the 30-day trend, plus the health banner. */
class StatsActivity : Activity() {
    private val app get() = application as TubeCleanApp

    override fun onCreate(savedInstanceState: Bundle?) {
        if (app.isTv) requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
        else SystemBars.show(this)
        super.onCreate(savedInstanceState)
        setContentView(if (app.isTv) R.layout.activity_stats else R.layout.activity_stats_phone)
        findViewById<Button>(R.id.back).setOnClickListener { finish() }
        findViewById<Button>(R.id.reset).setOnClickListener { confirmReset() }
        findViewById<TextView>(R.id.health_banner).setOnClickListener { RevisionDialog.details(this, app.health) }
        render()
        if (app.isTv) findViewById<Button>(R.id.back).requestFocus()
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_MENU) { finish(); return true }
        return super.onKeyUp(keyCode, event)
    }

    private fun render() {
        val stats = app.stats
        val today = stats.todayStats()
        val month = stats.lastDays()

        findViewById<TextView>(R.id.current).text = getString(R.string.stats_current, stats.currentVideoAds)
        findViewById<TextView>(R.id.today).text = getString(
            R.string.stats_today, today.adsBlocked, today.videos, today.avgPerVideo, today.requestsBlocked,
        )
        val monthAds = month.sumOf { it.adsBlocked }
        val monthVideos = month.sumOf { it.videos }
        findViewById<TextView>(R.id.month).text = getString(
            R.string.stats_month, monthAds, monthVideos, if (monthVideos == 0) 0f else monthAds.toFloat() / monthVideos,
        )
        findViewById<TextView>(R.id.per_video).text =
            if (today.perVideo.isEmpty()) getString(R.string.stats_no_videos)
            else getString(R.string.stats_per_video, today.perVideo.takeLast(40).joinToString("  ·  "))
        findViewById<TrendChartView>(R.id.chart).setDays(month)
        findViewById<TextView>(R.id.rules_version).text = getString(R.string.stats_rules, app.rules.version)

        val issues = app.health.issues()
        findViewById<TextView>(R.id.health_banner).apply {
            visibility = if (issues.isEmpty()) View.GONE else View.VISIBLE
            text = getString(R.string.health_banner, issues.joinToString(", ") { it.code })
        }
    }

    private fun confirmReset() {
        AlertDialog.Builder(this)
            .setTitle(R.string.reset_title)
            .setMessage(R.string.reset_message)
            .setPositiveButton(R.string.reset) { _, _ -> app.stats.reset(); render() }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }
}
