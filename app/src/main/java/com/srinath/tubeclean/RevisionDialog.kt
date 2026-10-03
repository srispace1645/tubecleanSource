package com.srinath.tubeclean

import android.app.Activity
import android.app.AlertDialog

/** The "Blocker needs revision" prompt and its details view, shared by the player and the Stats screen. */
object RevisionDialog {
    fun prompt(activity: Activity, health: HealthMonitor, onClosed: () -> Unit = {}) {
        val codes = health.issues().joinToString(", ") { it.code }
        AlertDialog.Builder(activity)
            .setTitle(R.string.revision_title)
            .setMessage(activity.getString(R.string.revision_message, codes))
            .setPositiveButton(R.string.revision_details) { _, _ -> details(activity, health) }
            .setNegativeButton(R.string.revision_later, null)
            .setOnDismissListener {
                health.snooze()
                onClosed()
            }
            .show()
    }

    fun details(activity: Activity, health: HealthMonitor) {
        AlertDialog.Builder(activity)
            .setTitle(R.string.revision_details_title)
            .setMessage(health.describe())
            .setPositiveButton(android.R.string.ok, null)
            .show()
    }
}
