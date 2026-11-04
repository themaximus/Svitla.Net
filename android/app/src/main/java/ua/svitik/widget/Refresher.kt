package ua.svitik.widget

import android.app.ActivityManager
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.time.LocalDate
import java.time.ZonedDateTime
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * Keeps the schedule fresh and the widgets current, by three independent routes:
 * - the launcher's own widget update every 30 minutes (updatePeriodMillis). It is the only route that
 *   still works when Android has the app's battery use set to "Restricted": that setting holds back
 *   the app's jobs and alarms until it is opened, but not this system broadcast;
 * - WorkManager downloads the schedule every 30 minutes;
 * - an alarm redraws the widgets at the next power change and every half hour (no download).
 */
object Refresher {
    private const val PERIODIC = "refresh-periodic"
    private const val NOW = "refresh-now"
    private const val STALE_MS = 25 * 60_000L
    private const val EMERGENCY_CHANNEL = "emergency"
    private const val EMERGENCY_NOTIFICATION = 1

    fun schedule(context: Context) {
        val request = PeriodicWorkRequestBuilder<RefreshWorker>(30, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    fun refreshNow(context: Context) {
        val request = OneTimeWorkRequestBuilder<RefreshWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(NOW, ExistingWorkPolicy.REPLACE, request)
    }

    /** Downloads the region's schedule into the store; false when no source answered. */
    fun download(context: Context): Boolean {
        val store = Store(context)
        return try {
            val schedule = loadSchedule(store.region)
            store.schedule = schedule
            checkDtekPage(store.region, store)
            if (store.group == null || store.group !in schedule.groups) store.group = schedule.groups.firstOrNull() ?: store.group
            store.lastError = null
            true
        } catch (e: Exception) {
            store.lastError = e.message ?: e.javaClass.simpleName
            false
        } finally {
            redraw(context)
        }
    }

    /** The launcher's update of a widget: redraw at once, download if the schedule is old, re-arm the alarm. */
    fun onSystemUpdate(context: Context, pending: BroadcastReceiver.PendingResult) {
        redraw(context)
        if (!Store(context).claimDownload(STALE_MS)) {
            pending.finish()
            return
        }
        thread {
            try {
                download(context)
            } finally {
                pending.finish()
            }
        }
    }

    /** Redraws the widgets and sets the alarm for the next redraw. */
    fun redraw(context: Context) {
        Widgets.updateAll(context)
        val store = Store(context)
        notifyEmergency(context, store)
        val now = ZonedDateTime.now(KYIV)
        val nextHalfHour = now.withSecond(0).withNano(0).plusMinutes(30L - now.minute % 30)
        val change = powerNow(store.schedule, store.group, now).changeAt
        val at = if (change != null && change.isBefore(nextHalfHour)) change else nextHalfHour
        val alarms = context.getSystemService(AlarmManager::class.java)
        alarms.setAndAllowWhileIdle(AlarmManager.RTC, at.toInstant().toEpochMilli() + 5_000, tickIntent(context))
    }

    /** One notification per day of emergency outages, gone once they are over. */
    private fun notifyEmergency(context: Context, store: Store) {
        val manager = context.getSystemService(NotificationManager::class.java)
        val schedule = store.schedule
        if (schedule?.emergencyToday != true) {
            manager.cancel(EMERGENCY_NOTIFICATION)
            store.notifiedEmergency = null
            return
        }
        val today = LocalDate.now(KYIV).toString()
        if (store.notifiedEmergency == today || !manager.areNotificationsEnabled()) return
        val title = context.getString(R.string.emergency)
        manager.createNotificationChannel(NotificationChannel(EMERGENCY_CHANNEL, title, NotificationManager.IMPORTANCE_HIGH))
        val text = schedule.emergencyMessage ?: context.getString(R.string.emergency_text)
        val open = PendingIntent.getActivity(
            context, 0, Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        manager.notify(EMERGENCY_NOTIFICATION, Notification.Builder(context, EMERGENCY_CHANNEL)
            .setSmallIcon(R.drawable.ic_bolt_warn)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build())
        store.notifiedEmergency = today
    }

    /** Android's "Restricted" battery setting for this app: its jobs and alarms wait until it is opened. */
    fun isBackgroundRestricted(context: Context): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
            context.getSystemService(ActivityManager::class.java).isBackgroundRestricted

    private fun tickIntent(context: Context): PendingIntent = PendingIntent.getBroadcast(
        context, 0, Intent(context, TickReceiver::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
}

class RefreshWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result = if (Refresher.download(applicationContext)) Result.success() else Result.retry()
}

/** The alarm of Refresher.redraw, a restart, an app update or a clock change: redraw and re-arm, no download. */
class TickReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Refresher.redraw(context)
    }
}
