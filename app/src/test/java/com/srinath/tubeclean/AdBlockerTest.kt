package com.srinath.tubeclean

import com.srinath.tubeclean.AdBlocker.Verdict
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Runs against the real shipped rules.json, so a bad revision fails the build. */
class AdBlockerTest {
    private val json = File("src/main/assets/rules.json").readText()
    private val blocker = AdBlocker(Rules.parse(json))

    @Test
    fun blocksAdEndpoints() {
        listOf(
            "https://www.youtube.com/api/stats/ads?ver=2&cpn=x",
            "https://googleads.g.doubleclick.net/pagead/id",
            "https://www.youtube.com/pagead/adview?ai=x",
            "https://www.youtube.com/get_midroll_info?ei=x",
            "https://www.youtube.com/ptracking?pltype=x",
            "https://tpc.googlesyndication.com/simgad/123",
        ).forEach { assertEquals(it, Verdict.AD, blocker.classify(it)) }
    }

    @Test
    fun blocksTrackers() {
        listOf(
            "https://www.youtube.com/api/stats/watchtime?ns=yt",
            "https://www.youtube.com/api/stats/qoe?fmt=1",
            "https://www.youtube.com/youtubei/v1/log_event?alt=json",
        ).forEach { assertEquals(it, Verdict.TRACKER, blocker.classify(it)) }
    }

    @Test
    fun refusesSignIn() {
        listOf(
            "https://accounts.google.com/ServiceLogin?service=youtube",
            "https://www.youtube.com/o/oauth2/device/code",
            "https://oauth2.googleapis.com/token",
        ).forEach { assertEquals(it, Verdict.SIGN_IN, blocker.classify(it)) }
    }

    @Test
    fun neverBlocksVideoOrThePage() {
        listOf(
            "https://rr3---sn-abc.googlevideo.com/videoplayback?expire=1&source=doubleclick.net",
            "https://www.youtube.com/tv#/watch?v=dQw4w9WgXcQ",
            "https://www.youtube.com/youtubei/v1/player?key=x",
            "https://www.youtube.com/youtubei/v1/browse?key=x",
            "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
            // A query parameter mentioning an ad host must not trigger a block.
            "https://www.youtube.com/youtubei/v1/next?ref=doubleclick.net",
        ).forEach { assertEquals(it, Verdict.ALLOW, blocker.classify(it)) }
    }

    @Test
    fun onlyYouTubeIsNavigable() {
        assertTrue(blocker.isAllowedHost("https://www.youtube.com/tv"))
        assertTrue(blocker.isAllowedHost("https://youtube.com/tv#/"))
        assertFalse(blocker.isAllowedHost("https://www.youtube.com.evil.example/tv"))
        assertFalse(blocker.isAllowedHost("https://example.com/"))
        assertFalse(blocker.isAllowedHost("http://www.youtube.com/tv"))
        assertFalse(blocker.isAllowedHost("intent://scan/#Intent;scheme=zxing;end"))
    }

    @Test
    fun phoneProfileSwapsInTheMobileSite() {
        val tv = Rules.parse(json)
        val phone = Rules.parse(json, Rules.PHONE)
        assertTrue("the TV site needs a TV user agent", tv.userAgents.isNotEmpty())
        assertTrue(tv.startUrl.contains("/tv"))
        assertTrue(phone.startUrl.startsWith("https://m.youtube.com"))
        assertTrue("phones use the WebView's own user agent", phone.userAgents.isEmpty())
        assertEquals("", phone.tvPathMarker)
        assertTrue(AdBlocker(phone).isAllowedHost(phone.startUrl))
        // Blocking lists are shared, so the phone blocks the same endpoints.
        assertEquals(tv.adUrls, phone.adUrls)
        assertEquals(Verdict.AD, AdBlocker(phone).classify("https://m.youtube.com/api/stats/ads?ver=2"))
        assertEquals(Verdict.SIGN_IN, AdBlocker(phone).classify("https://accounts.google.com/ServiceLogin"))

        val page = JSONObject(phone.rawJson)
        assertFalse("the page sees only the effective rules", page.has(Rules.PHONE))
        assertTrue(page.getJSONArray("hideSelectors").toString().contains("ad-slot-renderer"))
        assertFalse(JSONObject(tv.rawJson).has(Rules.PHONE))
        assertFalse("the Chrome extension's section never reaches the app", page.has(Rules.DESKTOP))
        assertFalse(JSONObject(tv.rawJson).has(Rules.DESKTOP))
        val watch = Regex(page.getString("watchRoutePattern"))
        assertEquals("dQw4w9WgXcQ", watch.find("/shorts/dQw4w9WgXcQ")?.groupValues?.get(1))
        assertEquals("dQw4w9WgXcQ", watch.find("/watch?v=dQw4w9WgXcQ&t=1")?.groupValues?.get(1))
    }

    @Test
    fun rulesFileIsComplete() {
        val o = JSONObject(json)
        listOf(
            "version", "startUrl", "userAgents", "adUrls", "trackerUrls", "signInUrls", "adDataKeys",
            "playerSelectors", "adClassNames", "skipButtonSelectors", "hideSelectors", "watchRoutePattern",
        ).forEach { assertTrue("rules.json is missing $it", o.has(it)) }
        assertTrue(o.getJSONArray("adDataKeys").length() > 0)
        // No ad/tracker rule may catch the video stream itself.
        val stream = "https://rr1---sn-x.googlevideo.com/videoplayback"
        assertEquals(Verdict.ALLOW, blocker.classify(stream))
    }
}
