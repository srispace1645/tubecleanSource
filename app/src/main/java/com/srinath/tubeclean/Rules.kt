package com.srinath.tubeclean

import org.json.JSONObject

/**
 * Everything that goes stale when YouTube changes lives in assets/rules.json, so a revision
 * is normally an edit to that one file. See README, "Revising the rules".
 *
 * The top level describes the TV site. A [PHONE] section overrides any of those keys on phones
 * and tablets, which get YouTube's mobile site instead. A [DESKTOP] section is for the Chrome
 * extension (extension/) only; the app always removes it.
 */
class Rules(
    val version: String,
    val startUrl: String,
    /** The page must stay on a path containing this; blank turns the check off. */
    val tvPathMarker: String,
    /** Tried in order when the site rejects one; empty means the WebView's own. */
    val userAgents: List<String>,
    val allowedHosts: List<String>,
    val neverBlock: List<String>,
    val adUrls: List<String>,
    val trackerUrls: List<String>,
    val signInUrls: List<String>,
    /** Suggested to a new guest as its first video (see [GuestId]); blank turns the suggestion off. */
    val newGuestVideoId: String,
    val newGuestVideoTitle: String,
    /** The effective rules (profile applied), handed to the page scripts as `window.__TC_RULES`. */
    val rawJson: String,
) {
    companion object {
        const val PHONE = "phone"
        const val DESKTOP = "desktop"
        private val VIDEO_ID = Regex("[\\w-]{11}")

        fun parse(json: String, profile: String? = null): Rules {
            val o = JSONObject(json)
            val overrides = profile?.let { o.optJSONObject(it) }
            o.remove(PHONE)
            o.remove(DESKTOP)
            overrides?.keys()?.forEach { key -> o.put(key, overrides.get(key)) }

            fun list(key: String): List<String> {
                val a = o.optJSONArray(key) ?: return emptyList()
                return List(a.length()) { a.getString(it) }
            }
            return Rules(
                version = o.getString("version"),
                startUrl = o.getString("startUrl"),
                tvPathMarker = o.optString("tvPathMarker", "/tv"),
                userAgents = list("userAgents"),
                allowedHosts = list("allowedHosts"),
                neverBlock = list("neverBlock"),
                adUrls = list("adUrls"),
                trackerUrls = list("trackerUrls"),
                signInUrls = list("signInUrls"),
                newGuestVideoId = o.optJSONObject("newGuestVideo")?.optString("id").orEmpty().takeIf { VIDEO_ID.matches(it) }.orEmpty(),
                newGuestVideoTitle = o.optJSONObject("newGuestVideo")?.optString("title").orEmpty(),
                rawJson = o.toString(),
            )
        }
    }
}
