package com.srinath.tubeclean

import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.TimeZone

class StatsStoreTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private val utc = TimeZone.getTimeZone("UTC")
    private var now = 100 * DAY + 12 * HOUR
    private val file get() = File(tmp.root, "stats.json")
    private fun store() = StatsStore(file, { now }, utc)

    @Test
    fun aggregatesPerVideo() {
        val s = store()
        s.videoStarted(); s.addAds(2); s.addAds(1)
        s.videoStarted()
        assertEquals(0, s.currentVideoAds)
        s.videoStarted(); s.addAds(4)
        assertEquals(4, s.currentVideoAds)

        val today = s.todayStats()
        assertEquals(3, today.videos)
        assertEquals(7, today.adsBlocked)
        assertEquals(listOf(3, 0, 4), today.perVideo)
        assertEquals(7f / 3, today.avgPerVideo, 0.001f)
    }

    @Test
    fun adsBeforeAVideoStartCountAsAVideo() {
        val s = store()
        s.addAds(1)
        assertEquals(1, s.todayStats().videos)
        assertEquals(listOf(1), s.todayStats().perVideo)
    }

    @Test
    fun persistsAcrossRestarts() {
        store().apply { videoStarted(); addAds(3); addBlockedRequest(); addBlockedRequest(); flush() }
        val today = store().todayStats()
        assertEquals(1, today.videos)
        assertEquals(3, today.adsBlocked)
        assertEquals(2, today.requestsBlocked)
    }

    @Test
    fun keepsOnlyThirtyDays() {
        store().apply { videoStarted(); addAds(5) }
        now += 29 * DAY
        assertEquals(5, store().lastDays().first().adsBlocked) // day 1 of the window
        now += DAY
        val s = store()
        val days = s.lastDays()
        assertEquals(30, days.size)
        assertEquals(s.today(), days.last().day)
        assertEquals(0, days.sumOf { it.adsBlocked })
    }

    @Test
    fun videoRunningPastMidnightCountsOnTheNewDay() {
        now = 100 * DAY + DAY - 60_000 // 23:59
        val s = store()
        s.videoStarted(); s.addAds(1)
        now += 120_000 // 00:01 next day
        s.addAds(2)
        val days = s.lastDays(2)
        assertEquals(1, days[0].adsBlocked)
        assertEquals(1, days[1].videos)
        assertEquals(2, days[1].adsBlocked)
        assertEquals(3, s.currentVideoAds)
    }

    @Test
    fun resetClearsEverything() {
        val s = store()
        s.videoStarted(); s.addAds(2)
        s.reset()
        assertEquals(0, s.todayStats().adsBlocked)
        assertEquals(0, store().lastDays().sumOf { it.videos })
    }

    @Test
    fun corruptFileStartsFresh() {
        file.writeText("{not json")
        assertEquals(0, store().todayStats().adsBlocked)
    }

    @Test
    fun dayOfUsesLocalMidnight() {
        val ist = TimeZone.getTimeZone("Asia/Kolkata") // UTC+5:30
        // 20:00 UTC is already the next day in India.
        assertEquals(StatsStore.dayOf(100 * DAY, ist) + 1, StatsStore.dayOf(100 * DAY + 20 * HOUR, ist))
    }

    private companion object {
        const val HOUR = 3_600_000L
        const val DAY = 24 * HOUR
    }
}
