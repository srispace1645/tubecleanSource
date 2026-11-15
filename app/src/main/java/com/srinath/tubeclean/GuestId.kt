package com.srinath.tubeclean

import org.json.JSONObject
import java.io.File

/**
 * YouTube's guest ID (its cookies) is kept between launches. YouTube asks a brand-new guest to
 * "sign in to confirm you're not a bot" before some videos, and a new guest on every launch kept
 * hitting that. A new guest starts every [MAX_AGE_DAYS] days, or on Clean Start (stats screen).
 */
class GuestId(
    private val file: File?,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    /** When the current guest started; 0 when there's none yet, or after Clean Start. */
    var startedAt = 0L
        private set

    /** The current guest is new and hasn't opened a video yet, so the app suggests a first one. */
    var suggestFirstVideo = false
        private set

    init { load() }

    /** True when the guest must be dropped before YouTube loads: none yet, too old, Clean Start, or the clock went back. */
    fun expired(): Boolean {
        val age = clock() - startedAt
        return startedAt <= 0 || age < 0 || age >= MAX_AGE_DAYS * DAY_MS
    }

    fun startNew() {
        startedAt = clock()
        suggestFirstVideo = true
        save()
    }

    fun cleanStart() {
        startedAt = 0
        save()
    }

    /** A video was opened, or the suggestion was shown: don't suggest again for this guest. */
    fun firstVideoDone() {
        if (!suggestFirstVideo) return
        suggestFirstVideo = false
        save()
    }

    private fun load() {
        val f = file ?: return
        if (!f.exists()) return
        try {
            val o = JSONObject(f.readText())
            startedAt = o.optLong("startedAt")
            suggestFirstVideo = o.optBoolean("suggestFirstVideo")
        } catch (e: Exception) {
            startedAt = 0 // unreadable: start a new guest
        }
    }

    private fun save() {
        val f = file ?: return
        StatsStore.writeAtomically(f, JSONObject().put("startedAt", startedAt).put("suggestFirstVideo", suggestFirstVideo).toString())
    }

    companion object {
        const val MAX_AGE_DAYS = 10
        private const val DAY_MS = 24L * 60 * 60 * 1000
    }
}
