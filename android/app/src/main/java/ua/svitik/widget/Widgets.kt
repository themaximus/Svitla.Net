package ua.svitik.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

/** Small 2×1: the bolt, power on / off and the next change. */
class SmallWidget : BaseWidget(R.layout.widget_small)

/** Strip 4×1: the same with the day as a 24-hour bar. */
class StripWidget : BaseWidget(R.layout.widget_strip)

/** Day 4×3: the status and all 24 hours of today, like the desktop widget. */
class DayWidget : BaseWidget(R.layout.widget_day)

abstract class BaseWidget(val layout: Int) : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        Widgets.update(context, this::class.java, ids)
        Refresher.schedule(context)
        Refresher.onSystemUpdate(context, goAsync())
    }

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
        Widgets.update(context, this::class.java, intArrayOf(id))
    }

    override fun onEnabled(context: Context) {
        Refresher.schedule(context)
        Refresher.refreshNow(context)
    }
}

object Widgets {
    private val TIME = DateTimeFormatter.ofPattern("HH:mm")
    private val providers = listOf(SmallWidget::class.java, StripWidget::class.java, DayWidget::class.java)

    /** Redraws every placed widget from the stored schedule. */
    fun updateAll(context: Context) {
        val manager = AppWidgetManager.getInstance(context)
        for (provider in providers) {
            update(context, provider, manager.getAppWidgetIds(ComponentName(context, provider)))
        }
    }

    fun update(context: Context, provider: Class<out BaseWidget>, ids: IntArray) {
        if (ids.isEmpty()) return
        val manager = AppWidgetManager.getInstance(context)
        val store = Store(context)
        val schedule = store.schedule
        val group = store.group
        val now = ZonedDateTime.now(KYIV)
        val power = powerNow(schedule, group, now)
        val layout = provider.getDeclaredConstructor().newInstance().layout

        for (id in ids) {
            val views = RemoteViews(context.packageName, layout)
            views.setOnClickPendingIntent(R.id.root, openApp(context))
            views.setInt(R.id.root, "setBackgroundResource", cardBackground(power))
            views.setImageViewResource(R.id.bolt, boltIcon(power))
            views.setTextViewText(R.id.status, context.getString(statusText(power)))
            views.setTextViewText(R.id.next, nextText(context, schedule, group, power, now))
            views.setTextViewText(R.id.label, if (group == null) context.getString(R.string.choose_group) else "${store.region.short} · $group")

            when (layout) {
                R.layout.widget_strip -> views.setImageViewBitmap(R.id.bar, dayBar(schedule?.today?.get(group), now))
                R.layout.widget_day -> fillHours(context, views, schedule?.today?.get(group), now, power)
            }
            manager.updateAppWidget(id, views)
        }
    }

    fun cardBackground(power: PowerNow) = when {
        power.emergency -> R.drawable.widget_bg_warn
        power.off -> R.drawable.widget_bg_off
        else -> R.drawable.widget_bg_on
    }

    fun boltIcon(power: PowerNow) = when {
        power.emergency -> R.drawable.ic_bolt_warn
        power.off -> R.drawable.ic_bolt_off
        else -> R.drawable.ic_bolt_on
    }

    fun statusText(power: PowerNow) = when {
        power.emergency -> R.string.emergency
        power.off -> R.string.power_off
        else -> R.string.power_on
    }

    fun nextText(context: Context, schedule: Schedule?, group: String?, power: PowerNow, now: ZonedDateTime): String = when {
        power.emergency -> context.getString(R.string.emergency_note)
        schedule == null || group == null -> context.getString(R.string.no_data)
        !power.known -> context.getString(R.string.not_published_today)
        power.changeAt == null -> context.getString(if (power.off) R.string.back_unknown else R.string.no_outages)
        else -> {
            val day = if (power.changeAt.toLocalDate() != now.toLocalDate()) context.getString(R.string.tomorrow_at) else context.getString(R.string.at)
            context.getString(if (power.off) R.string.back_on else R.string.goes_off) + " " + day + " " + TIME.format(power.changeAt)
        }
    }

    private fun openApp(context: Context): PendingIntent = PendingIntent.getActivity(
        context, 0, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    // 48 half hours as a bar: on green, off red, possible amber; a white tick at "now"
    fun dayBar(day: DaySchedule?, now: ZonedDateTime): Bitmap {
        val width = 480
        val height = 28
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        val cell = width / 48f
        for (i in 0 until 48) {
            paint.color = when (day?.halves?.get(i)) {
                Power.OFF -> Color.parseColor("#7A1414")
                Power.MAYBE -> Color.parseColor("#FF9F1A")
                Power.ON -> Color.parseColor("#00FF88")
                null -> Color.parseColor("#33FFFFFF")
            }
            canvas.drawRect(i * cell + 0.5f, 4f, (i + 1) * cell - 0.5f, height - 4f, paint)
            if (day?.halves?.get(i) == Power.OFF) {
                paint.color = Color.parseColor("#FF3B3B")
                canvas.drawLine(i * cell + 1, height - 5f, (i + 1) * cell - 1, 5f, paint.apply { strokeWidth = 2f })
            }
        }
        paint.color = Color.argb(90, 255, 255, 255)
        for (h in 1 until 24) if (h % 6 == 0) canvas.drawRect(h * 2 * cell - 0.75f, 0f, h * 2 * cell + 0.75f, height.toFloat(), paint)
        val minute = now.hour * 60 + now.minute
        paint.color = Color.WHITE
        canvas.drawRoundRect(RectF(minute / 1440f * width - 2, 0f, minute / 1440f * width + 2, height.toFloat()), 2f, 2f, paint)
        return bitmap
    }

    // Two columns of 12 rows, as on the desktop: "00-01" and the indicator of the hour
    private fun fillHours(context: Context, views: RemoteViews, day: DaySchedule?, now: ZonedDateTime, power: PowerNow) {
        views.removeAllViews(R.id.column_left)
        views.removeAllViews(R.id.column_right)
        views.setTextViewText(R.id.no_schedule, context.getString(if (power.emergency) R.string.emergency_text else R.string.not_published_today))
        views.setViewVisibility(R.id.no_schedule, if (day == null) View.VISIBLE else View.GONE)
        views.setViewVisibility(R.id.hours, if (day == null) View.GONE else View.VISIBLE)
        if (day == null) return
        for (h in 0 until 24) {
            val row = RemoteViews(context.packageName, if (h == now.hour) R.layout.widget_hour_now else R.layout.widget_hour)
            row.setTextViewText(R.id.hour, "%02d-%02d".format(h, h + 1))
            val (a, b) = day.halves[h * 2] to day.halves[h * 2 + 1]
            row.setImageViewResource(R.id.indicator, when {
                a == Power.OFF && b == Power.OFF -> R.drawable.ind_off
                a == Power.OFF -> R.drawable.ind_first
                b == Power.OFF -> R.drawable.ind_second
                a == Power.MAYBE || b == Power.MAYBE -> R.drawable.ind_maybe
                else -> R.drawable.ind_on
            })
            views.addView(if (h < 12) R.id.column_left else R.id.column_right, row)
        }
    }
}
