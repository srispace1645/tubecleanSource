package com.srinath.tubeclean

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.util.AttributeSet
import android.util.TypedValue
import android.view.View
import kotlin.math.ceil
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.pow

/** 30-day trend: bars for ads blocked per day, a line for the average ads per video (right-hand scale). */
class TrendChartView @JvmOverloads constructor(context: Context, attrs: AttributeSet? = null) : View(context, attrs) {
    private var days: List<StatsStore.Day> = emptyList()

    private val barPaint = fill(BAR_COLOR)
    private val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = LINE_COLOR; style = Paint.Style.STROKE; strokeWidth = dp(2.5f); strokeJoin = Paint.Join.ROUND
    }
    private val dotPaint = fill(LINE_COLOR)
    private val gridPaint = Paint().apply { color = GRID_COLOR; strokeWidth = dp(1f) }
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = TEXT_COLOR; textSize = sp(13f) }
    private val path = Path()

    fun setDays(list: List<StatsStore.Day>) {
        days = list
        val total = list.sumOf { it.adsBlocked }
        contentDescription = "Ads blocked over the last ${list.size} days: $total in total"
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        if (days.isEmpty()) return
        val left = dp(52f)
        val right = width - dp(52f)
        val maxAds = niceCeil(max(1, days.maxOf { it.adsBlocked }).toFloat())
        val maxAvg = niceCeil(max(1f, days.maxOf { it.avgPerVideo }))

        // Legend: one row on a TV, two on a narrow phone screen
        canvas.drawRect(left, dp(8f), left + dp(14f), dp(22f), barPaint)
        textPaint.textAlign = Paint.Align.LEFT
        canvas.drawText(LEGEND_ADS, left + dp(20f), dp(20f), textPaint)
        var legend2 = left + dp(20f) + textPaint.measureText(LEGEND_ADS) + dp(28f)
        var legend2Y = 0f
        if (legend2 + dp(24f) + textPaint.measureText(LEGEND_AVG) > width) {
            legend2 = left
            legend2Y = dp(22f)
        }
        canvas.drawLine(legend2, dp(15f) + legend2Y, legend2 + dp(18f), dp(15f) + legend2Y, linePaint)
        canvas.drawText(LEGEND_AVG, legend2 + dp(24f), dp(20f) + legend2Y, textPaint)

        val top = dp(40f) + legend2Y
        val bottom = height - dp(28f)
        val h = bottom - top

        // Grid with left (ads) and right (avg per video) scales
        for (i in 0..2) {
            val y = bottom - h * i / 2f
            canvas.drawLine(left, y, right, y, gridPaint)
            textPaint.textAlign = Paint.Align.RIGHT
            canvas.drawText(fmt(maxAds * i / 2f), left - dp(8f), y + dp(4f), textPaint)
            textPaint.textAlign = Paint.Align.LEFT
            canvas.drawText(fmt(maxAvg * i / 2f), right + dp(8f), y + dp(4f), textPaint)
        }

        val slot = (right - left) / days.size
        val barW = slot * 0.62f
        path.reset()
        var started = false
        textPaint.textAlign = Paint.Align.CENTER
        days.forEachIndexed { i, d ->
            val cx = left + slot * (i + 0.5f)
            val barH = h * d.adsBlocked / maxAds
            if (barH > 0) canvas.drawRect(cx - barW / 2, bottom - barH, cx + barW / 2, bottom, barPaint)

            if (d.videos > 0) {
                val y = bottom - h * d.avgPerVideo / maxAvg
                if (started) path.lineTo(cx, y) else { path.moveTo(cx, y); started = true }
                canvas.drawCircle(cx, y, dp(3.5f), dotPaint)
            }

            val last = i == days.lastIndex
            if (last || (days.lastIndex - i) % 7 == 0) {
                val label = if (last) "Today" else StatsStore.dayLabel(d.day)
                canvas.drawText(label, cx, bottom + dp(20f), textPaint)
            }
        }
        canvas.drawPath(path, linePaint)
    }

    private fun fmt(v: Float) = if (v == v.toInt().toFloat()) v.toInt().toString() else "%.1f".format(v)

    /** Rounds up to 1, 2 or 5 × 10ⁿ so the axis labels are tidy. */
    private fun niceCeil(v: Float): Float {
        val mag = 10f.pow(ceil(log10(v)) - 1)
        return listOf(1f, 2f, 5f, 10f).map { it * mag }.first { it >= v }
    }

    private fun fill(c: Int) = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = c; style = Paint.Style.FILL }
    private fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics)
    private fun sp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, v, resources.displayMetrics)

    private companion object {
        const val LEGEND_ADS = "Ads blocked per day"
        const val LEGEND_AVG = "Avg ads per video"
        const val BAR_COLOR = 0xFF4DB6AC.toInt()
        const val LINE_COLOR = 0xFFFFCA28.toInt()
        const val GRID_COLOR = 0x33FFFFFF
        const val TEXT_COLOR = 0xFFBDBDBD.toInt()
    }
}
