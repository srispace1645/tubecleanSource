package com.srinath.tubeclean

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.TimeZone

class HealthMonitorTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private var now = 100 * DAY + 10 * HOUR
    private val file get() = File(tmp.root, "health.json")
    private fun monitor(version: String = "v1") = HealthMonitor(file, version, { now }, TimeZone.getTimeZone("UTC"))

    @Test
    fun activatesAfterThreeReportsInADay() {
        val h = monitor()
        assertFalse(h.report("SKIP_FAILED", "a"))
        assertFalse(h.report("SKIP_FAILED", "b"))
        assertFalse(h.shouldPrompt())
        assertTrue(h.report("SKIP_FAILED", "c"))
        assertFalse("already active", h.report("SKIP_FAILED", "d"))
        assertTrue(h.shouldPrompt())
        assertEquals(listOf("SKIP_FAILED"), h.issues().map { it.code })
    }

    @Test
    fun siteChangedActivatesImmediately() {
        assertTrue(monitor().report("SITE_CHANGED", "redirected"))
    }

    @Test
    fun dailyCountsReset() {
        val h = monitor()
        h.report("PLAYER_NOT_FOUND", "x"); h.report("PLAYER_NOT_FOUND", "x")
        now += DAY
        assertFalse(h.report("PLAYER_NOT_FOUND", "x"))
        assertTrue(h.issues().isEmpty())
    }

    @Test
    fun snoozeHidesPromptFor24Hours() {
        val h = monitor()
        h.report("SITE_CHANGED", "x")
        h.snooze()
        assertFalse(h.shouldPrompt())
        now += HealthMonitor.SNOOZE_MS
        assertTrue(h.shouldPrompt())
    }

    @Test
    fun persistsUntilRulesVersionChanges() {
        monitor("v1").report("SITE_CHANGED", "x")
        assertEquals(1, monitor("v1").issues().size)
        assertTrue("revised rules start clean", monitor("v2").issues().isEmpty())
    }

    @Test
    fun ignoresUnknownCodesAndCapsDetails() {
        val h = monitor()
        assertFalse(h.report("MADE_UP", "x"))
        repeat(10) { h.report("AD_UNDETECTED", "key$it") }
        h.report("AD_UNDETECTED", "key9") // duplicate
        val issue = h.issues().single()
        assertEquals(listOf("key5", "key6", "key7", "key8", "key9"), issue.details)
        assertEquals(11, issue.total)
        assertTrue(h.describe().contains("adDataKeys"))
    }

    private companion object {
        const val HOUR = 3_600_000L
        const val DAY = 24 * HOUR
    }
}
