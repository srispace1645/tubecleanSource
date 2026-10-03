package com.srinath.tubeclean

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.TreeMap

/**
 * The only thing TubeClean remembers: ad-block counts. For each of the last 30 days it keeps how many
 * videos were watched, how many ads were blocked in each one, and how many ad/tracker requests were
 * refused. No video IDs, titles, searches or timestamps finer than a day are ever stored.
 */
class StatsStore(
    private val file: File?,
    private val clock: () -> Long = System::currentTimeMillis,
    private val tz: TimeZone = TimeZone.getDefault(),
) {
    class Day(
        val day: Int,
        var videos: Int = 0,
        var adsBlocked: Int = 0,
        var requestsBlocked: Int = 0,
        val perVideo: MutableList<Int> = mutableListOf(),
    ) {
        val avgPerVideo: Float get() = if (videos == 0) 0f else adsBlocked.toFloat() / videos
        fun copy() = Day(day, videos, adsBlocked, requestsBlocked, perVideo.toMutableList())
    }

    private val days = TreeMap<Int, Day>()
    private var pendingRequests = 0
    private var inVideo = false

    /** Ads blocked in the video playing now; resets when the next video starts. */
    @get:Synchronized
    var currentVideoAds = 0
        private set

    init {
        load()
        prune()
    }

    fun today(): Int = dayOf(clock(), tz)

    @Synchronized
    fun videoStarted() {
        dayEntry().apply { videos++; perVideo.add(0) }
        currentVideoAds = 0
        inVideo = true
        save()
    }

    @Synchronized
    fun addAds(n: Int) {
        if (n <= 0) return
        if (!inVideo) videoStarted()
        val d = dayEntry()
        // A video that started before midnight counts as a video of the new day too.
        if (d.perVideo.isEmpty()) { d.videos++; d.perVideo.add(0) }
        d.adsBlocked += n
        d.perVideo[d.perVideo.lastIndex] += n
        currentVideoAds += n
        save()
    }

    /** Called from WebView's network threads for every refused request; written with the next save. */
    @Synchronized
    fun addBlockedRequest() { pendingRequests++ }

    @Synchronized
    fun flush() { if (pendingRequests > 0) save() }

    /** The last [n] days, oldest first, today last; days without data are zero-filled. */
    @Synchronized
    fun lastDays(n: Int = WINDOW_DAYS): List<Day> {
        val t = today()
        return (t - n + 1..t).map { days[it]?.copy() ?: Day(it) }
    }

    @Synchronized
    fun todayStats(): Day = (days[today()] ?: Day(today())).copy().apply { requestsBlocked += pendingRequests }

    @Synchronized
    fun reset() {
        days.clear()
        pendingRequests = 0
        currentVideoAds = 0
        inVideo = false
        save()
    }

    private fun dayEntry(): Day {
        val t = today()
        return days.getOrPut(t) { Day(t) }
    }

    private fun prune() {
        days.headMap(today() - WINDOW_DAYS + 1).clear()
    }

    private fun save() {
        if (pendingRequests > 0) {
            dayEntry().requestsBlocked += pendingRequests
            pendingRequests = 0
        }
        prune()
        val f = file ?: return
        val arr = JSONArray()
        for (d in days.values) {
            arr.put(
                JSONObject()
                    .put("day", d.day)
                    .put("videos", d.videos)
                    .put("ads", d.adsBlocked)
                    .put("requests", d.requestsBlocked)
                    .put("perVideo", JSONArray(d.perVideo))
            )
        }
        writeAtomically(f, JSONObject().put("v", 1).put("days", arr).toString())
    }

    private fun load() {
        val f = file ?: return
        if (!f.exists()) return
        try {
            val arr = JSONObject(f.readText()).getJSONArray("days")
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val pv = o.getJSONArray("perVideo")
                val day = o.getInt("day")
                days[day] = Day(day, o.getInt("videos"), o.getInt("ads"), o.optInt("requests"), MutableList(pv.length()) { pv.getInt(it) })
            }
        } catch (e: Exception) {
            days.clear() // unreadable file: start fresh rather than crash on the TV
        }
    }

    companion object {
        const val WINDOW_DAYS = 30
        private const val DAY_MS = 86_400_000L

        /** Local calendar day as a day number, so arithmetic works without java.time (API 26+). */
        fun dayOf(ms: Long, tz: TimeZone): Int {
            val local = ms + tz.getOffset(ms)
            // Floor division by hand: Math.floorDiv needs API 24 and Fire OS 5 is API 22.
            val day = local / DAY_MS
            return (if (local % DAY_MS < 0) day - 1 else day).toInt()
        }

        fun dayLabel(day: Int, pattern: String = "MMM d"): String =
            SimpleDateFormat(pattern, Locale.getDefault())
                .apply { timeZone = TimeZone.getTimeZone("UTC") }
                .format(day * DAY_MS)

        internal fun writeAtomically(f: File, text: String) {
            val tmp = File(f.path + ".tmp")
            tmp.writeText(text)
            if (!tmp.renameTo(f)) { f.delete(); tmp.renameTo(f) }
        }
    }
}
