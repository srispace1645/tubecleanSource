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
    fun isAllowedHost(url: String): Boolean = host(url)?.let { it in allowedHosts } ?: false

    companion object {
        /**
         * The host an https URL really goes to, read the way the browser reads it, or null when it isn't
         * plain https or names a user ("https://www.youtube.com:x@evil.com/" goes to evil.com, not YouTube).
         */
        fun host(url: String): String? {
            // Browsers drop tabs and line breaks anywhere in a URL, and treat "\" as "/".
            val clean = url.trim().replace(Regex("[\\t\\n\\r]"), "").lowercase()
            if (!clean.startsWith("https://")) return null
            val authority = clean.substring("https://".length).split('/', '\\', '?', '#').first()
            if ('@' in authority || '%' in authority) return null
            val host = authority.substringBefore(':')
            val port = authority.substringAfter(':', "")
            if (port.isNotEmpty() && port != "443") return null
            return host.ifEmpty { null }
        }

        /**
         * "https://www.youtube.com/api/stats/ads?ref=doubleclick.net" -> "www.youtube.com/api/stats/ads".
         * Matching ignores the query and fragment, so a parameter can't cause (or dodge) a block.
         */
        fun hostAndPath(url: String): String =
            url.lowercase().substringAfter("://").substringBefore('#').substringBefore('?')
    }
}
