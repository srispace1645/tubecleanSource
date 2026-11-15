package com.srinath.tubeclean

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class GuestIdTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private var now = 1_000 * DAY
    private val file get() = File(tmp.root, "guest.json")
    private fun guest() = GuestId(file, { now })

    @Test
    fun firstLaunchStartsANewGuest() {
        assertTrue(guest().expired())
    }

    @Test
    fun keptForTenDaysThenRenewed() {
        guest().startNew()
        now += 9 * DAY + 23 * HOUR
        assertFalse(guest().expired())
        now += HOUR
        assertTrue(guest().expired())
    }

    @Test
    fun cleanStartDropsTheGuest() {
        val g = guest()
        g.startNew()
        g.cleanStart()
        assertTrue(g.expired())
        assertTrue("survives a restart", guest().expired())
    }

    @Test
    fun clockGoingBackStartsANewGuest() {
        guest().startNew()
        now -= HOUR
        assertTrue(guest().expired())
    }

    @Test
    fun suggestsAFirstVideoOncePerNewGuest() {
        val g = guest()
        assertFalse(g.suggestFirstVideo)
        g.startNew()
        assertTrue(g.suggestFirstVideo)
        assertTrue("survives a restart", guest().suggestFirstVideo)
        g.firstVideoDone()
        assertFalse(guest().suggestFirstVideo)
        g.startNew()
        assertTrue(g.suggestFirstVideo)
    }

    @Test
    fun unreadableFileStartsANewGuest() {
        file.writeText("not json")
        assertTrue(guest().expired())
        assertEquals(0L, guest().startedAt)
    }

    private companion object {
        const val HOUR = 60L * 60 * 1000
        const val DAY = 24 * HOUR
    }
}
