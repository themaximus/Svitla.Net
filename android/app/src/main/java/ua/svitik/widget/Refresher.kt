package ua.svitik.widget

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.time.ZonedDateTime
import java.util.concurrent.TimeUnit

/**
 * Keeps the schedule fresh and the widgets current:
 * - the schedule is downloaded every 30 minutes (WorkManager, only with a network) and on demand;
 * - the widgets are redrawn from the stored schedule at the next power change and every half hour,
 *   so the status and the "now" mark move without a download (an inexact alarm, no special permission).
 */
object Refresher {
    private const val PERIODIC = "refresh-periodic"
    private const val NOW = "refresh-now"

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

    /** Redraws the widgets and sets the alarm for the next redraw. */
    fun redraw(context: Context) {
        Widgets.updateAll(context)
        val store = Store(context)
        val now = ZonedDateTime.now(KYIV)
        val nextHalfHour = now.withSecond(0).withNano(0).plusMinutes(30L - now.minute % 30)
        val change = powerNow(store.schedule, store.group, now).changeAt
        val at = if (change != null && change.isBefore(nextHalfHour)) change else nextHalfHour
        val alarms = context.getSystemService(AlarmManager::class.java)
        alarms.setAndAllowWhileIdle(AlarmManager.RTC, at.toInstant().toEpochMilli() + 5_000, tickIntent(context))
    }

    private fun tickIntent(context: Context): PendingIntent = PendingIntent.getBroadcast(
        context, 0, Intent(context, TickReceiver::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
}

class RefreshWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result = if (Refresher.download(applicationContext)) Result.success() else Result.retry()
}

/** The alarm of Refresher.redraw: no download, just the widgets for the new time. */
class TickReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Refresher.redraw(context)
    }
}
