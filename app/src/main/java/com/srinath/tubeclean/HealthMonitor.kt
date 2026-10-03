package com.srinath.tubeclean

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.TimeZone

/**
 * Detects when YouTube has changed enough that rules.json needs revising. The page scripts and the
 * WebView report problems; once a problem reaches its daily threshold it becomes an active issue,
 * and the app prompts until the rules version changes. Stores problem codes and short technical
 * details only (selector/key names), never video IDs.
 */
class HealthMonitor(
    private val file: File?,
    private val rulesVersion: String,
    private val clock: () -> Long = System::currentTimeMillis,
    private val tz: TimeZone = TimeZone.getDefault(),
) {
    class Issue(val code: String, val total: Int, val details: List<String>) {
        val hint: String get() = HINTS[code] ?: "Unknown problem."
    }

    private var day = -1
    private val todayCounts = mutableMapOf<String, Int>()
    private val totals = mutableMapOf<String, Int>()
    private val details = mutableMapOf<String, MutableList<String>>()
    private val active = sortedSetOf<String>()
    private var snoozeUntil = 0L
    private var storedVersion: String? = null

    init {
        load()
        // A new rules version means you revised the app: start over.
        if (storedVersion != rulesVersion) clearAll()
    }

    /** Records one occurrence. Returns true when this makes [code] a newly active issue. */
    @Synchronized
    fun report(code: String, detail: String): Boolean {
        if (code !in CODES) return false
        rollDay()
        val n = (todayCounts[code] ?: 0) + 1
        todayCounts[code] = n
        totals[code] = (totals[code] ?: 0) + 1
        val list = details.getOrPut(code) { mutableListOf() }
        val d = detail.take(MAX_DETAIL_CHARS)
        if (d.isNotEmpty() && d !in list) {
            list.add(d)
            if (list.size > MAX_DETAILS) list.removeAt(0)
        }
        val newlyActive = n >= thresholdFor(code) && active.add(code)
        save()
        return newlyActive
    }

    @Synchronized
    fun issues(): List<Issue> = active.map { Issue(it, totals[it] ?: 0, details[it].orEmpty().toList()) }

    @Synchronized
    fun shouldPrompt(): Boolean = active.isNotEmpty() && clock() >= snoozeUntil

    @Synchronized
    fun snooze(ms: Long = SNOOZE_MS) {
        snoozeUntil = clock() + ms
        save()
    }

    /** Human-readable report for the "Show details" dialog. */
    fun describe(): String = buildString {
        append("Rules version: ").append(rulesVersion).append("\n\n")
        for (issue in issues()) {
            append("• ").append(issue.code).append(" (reported ").append(issue.total).append("×)\n")
            append("   ").append(issue.hint).append('\n')
            issue.details.takeLast(3).forEach { append("   – ").append(it).append('\n') }
            append('\n')
        }
        append("To revise: on your PC, open app/src/main/assets/rules.json, inspect the live page with ")
        append("chrome://inspect, fix the keys named above, bump \"version\", then run install.ps1.")
    }

    private fun rollDay() {
        val t = StatsStore.dayOf(clock(), tz)
        if (t != day) {
            day = t
            todayCounts.clear()
        }
    }

    private fun thresholdFor(code: String) = if (code == "SITE_CHANGED") 1 else DEFAULT_THRESHOLD

    private fun clearAll() {
        day = -1
        todayCounts.clear(); totals.clear(); details.clear(); active.clear()
        snoozeUntil = 0L
        storedVersion = rulesVersion
        save()
    }

    private fun save() {
        val f = file ?: return
        val o = JSONObject()
            .put("version", rulesVersion)
            .put("day", day)
            .put("today", JSONObject(todayCounts as Map<*, *>))
            .put("totals", JSONObject(totals as Map<*, *>))
            .put("details", JSONObject().apply { details.forEach { (k, v) -> put(k, JSONArray(v)) } })
            .put("active", JSONArray(active.toList()))
            .put("snoozeUntil", snoozeUntil)
        StatsStore.writeAtomically(f, o.toString())
    }

    private fun load() {
        val f = file ?: return
        if (!f.exists()) return
        try {
            val o = JSONObject(f.readText())
            storedVersion = o.optString("version")
            day = o.optInt("day", -1)
            fun ints(key: String, into: MutableMap<String, Int>) {
                val m = o.optJSONObject(key) ?: return
                m.keys().forEach { into[it] = m.getInt(it) }
            }
            ints("today", todayCounts)
            ints("totals", totals)
            o.optJSONObject("details")?.let { m ->
                m.keys().forEach { k ->
                    val a = m.getJSONArray(k)
                    details[k] = MutableList(a.length()) { a.getString(it) }
                }
            }
            o.optJSONArray("active")?.let { a -> for (i in 0 until a.length()) active.add(a.getString(i)) }
            snoozeUntil = o.optLong("snoozeUntil")
        } catch (e: Exception) {
            storedVersion = null // unreadable: clearAll() in init starts fresh
        }
    }

    companion object {
        const val DEFAULT_THRESHOLD = 3
        const val SNOOZE_MS = 24 * 60 * 60 * 1000L
        private const val MAX_DETAILS = 5
        private const val MAX_DETAIL_CHARS = 200

        val HINTS = mapOf(
            "PLAYER_NOT_FOUND" to "The video player element wasn't found. Update \"playerSelectors\".",
            "SKIP_FAILED" to "An ad kept playing after the skip attempt. Update \"adClassNames\" / \"skipButtonSelectors\".",
            "AD_DATA_CHANGED" to "An ad played although ad data was stripped (or none was found). Update \"adDataKeys\" / \"adUrls\".",
            "AD_UNDETECTED" to "Video data has new ad-like fields (listed below). Add them to \"adDataKeys\", or to \"ignoreAdLikeKeys\" if harmless.",
            "SITE_CHANGED" to "YouTube TV refused this app or failed to load. Update \"userAgents\" / \"startUrl\".",
        )
        val CODES: Set<String> = HINTS.keys
    }
}
