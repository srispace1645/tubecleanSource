package com.srinath.tubeclean

import android.app.Activity
import android.os.Build
import android.view.WindowManager

/** The app theme hides the status bar, which suits a TV. Phones and tablets keep their clock and battery. */
object SystemBars {
    /** Call before `super.onCreate`, so the theme applies before the window is built. */
    fun show(activity: Activity) {
        activity.setTheme(R.style.Theme_TubeClean_Phone)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // Let fullscreen video use the area beside a camera cutout.
            activity.window.attributes = activity.window.attributes.apply {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
    }
}
