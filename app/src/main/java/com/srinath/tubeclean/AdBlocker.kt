package com.srinath.tubeclean

/** Layer 1: decides which network requests the WebView may make. Immutable, so safe on WebView's IO threads. */
class AdBlocker(rules: Rules) {
    enum class Verdict { ALLOW, AD, TRACKER, SIGN_IN }

    private val neverBlock = rules.neverBlock.map { it.lowercase() }
    private val signIn = rules.signInUrls.map { it.lowercase() }
    private val ads = rules.adUrls.map { it.lowercase() }
    private val trackers = rules.trackerUrls.map { it.lowercase() }
    private val allowedHosts = rules.allowedHosts.map { it.lowercase() }.toSet()

    fun classify(url: String): Verdict {
        val target = hostAndPath(url)
        return when {
            neverBlock.any { target.contains(it) } -> Verdict.ALLOW
            signIn.any { target.contains(it) } -> Verdict.SIGN_IN
            ads.any { target.contains(it) } -> Verdict.AD
            trackers.any { target.contains(it) } -> Verdict.TRACKER
            else -> Verdict.ALLOW
        }
    }

    /** Top-level navigation is limited to YouTube itself; anything else (other sites, intent:// links) is refused. */
    fun isAllowedHost(url: String): Boolean {
        val lower = url.lowercase()
        if (!lower.startsWith("https://")) return false
        val host = hostAndPath(lower).substringBefore('/').substringBefore(':')
        return host in allowedHosts
    }

    companion object {
        /**
         * "https://www.youtube.com/api/stats/ads?ref=doubleclick.net" -> "www.youtube.com/api/stats/ads".
         * Matching ignores the query and fragment, so a parameter can't cause (or dodge) a block.
         */
        fun hostAndPath(url: String): String =
            url.lowercase().substringAfter("://").substringBefore('#').substringBefore('?')
    }
}
