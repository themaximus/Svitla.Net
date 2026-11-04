package ua.svitik.widget

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate

/** The chosen region and group, and the last loaded schedule (the widgets draw from it, also offline). */
class Store(context: Context) {
    private val prefs = context.getSharedPreferences("svitik", Context.MODE_PRIVATE)

    var regionId: String
        get() = prefs.getString("region", REGIONS.first().id)!!
        set(value) = prefs.edit().putString("region", value).apply()

    var group: String?
        get() = prefs.getString("group", null)
        set(value) = prefs.edit().putString("group", value).apply()

    val region: Region get() = regionById(regionId)

    /** The schedule of the current region, or null if none was loaded (or it belongs to another region). */
    var schedule: Schedule?
        get() {
            if (prefs.getString("scheduleRegion", null) != regionId) return null
            return prefs.getString("schedule", null)?.let { runCatching { decode(JSONObject(it)) }.getOrNull() }
        }
        set(value) {
            prefs.edit()
                .putString("schedule", value?.let { encode(it).toString() })
                .putString("scheduleRegion", regionId)
                .putLong("loadedAt", System.currentTimeMillis())
                .apply()
        }

    val loadedAt: Long get() = prefs.getLong("loadedAt", 0)

    /** True at most once per interval: three widgets update together but need one download. */
    fun claimDownload(intervalMs: Long): Boolean {
        val now = System.currentTimeMillis()
        if (now - prefs.getLong("downloadClaimedAt", 0) < intervalMs) return false
        prefs.edit().putLong("downloadClaimedAt", now).commit()
        return true
    }

    var lastError: String?
        get() = prefs.getString("error", null)
        set(value) = prefs.edit().putString("error", value).apply()

    private fun encode(schedule: Schedule) = JSONObject().apply {
        put("updated", schedule.updated)
        put("savedOn", LocalDate.now(KYIV).toString())
        put("emergencyToday", schedule.emergencyToday)
        put("emergencyTomorrow", schedule.emergencyTomorrow)
        put("today", encodeDays(schedule.today))
        put("tomorrow", encodeDays(schedule.tomorrow))
    }

    private fun encodeDays(days: Map<String, DaySchedule>) = JSONObject().apply {
        for ((group, day) in days) {
            put(group, JSONObject().put("date", day.date.toString()).put("halves", JSONArray(day.halves.map { it.ordinal })))
        }
    }

    // Sorted again by date: after midnight yesterday's "tomorrow" is today, and yesterday is dropped
    private fun decode(json: JSONObject): Schedule {
        val days = decodeDays(json.getJSONObject("today")) + decodeDays(json.getJSONObject("tomorrow"))
        val now = LocalDate.now(KYIV)
        // After midnight yesterday's "tomorrow" is today; an older mark says nothing any more
        val savedOn = runCatching { LocalDate.parse(json.optString("savedOn")) }.getOrNull()
        val emergencyToday = if (savedOn == now) json.optBoolean("emergencyToday") else savedOn == now.minusDays(1) && json.optBoolean("emergencyTomorrow")
        return Schedule(
            days.filter { it.second.date == now }.toMap(),
            days.filter { it.second.date == now.plusDays(1) }.toMap(),
            json.optString("updated").takeIf { it.isNotEmpty() && it != "null" },
            emergencyToday,
            savedOn == now && json.optBoolean("emergencyTomorrow"),
        )
    }

    private fun decodeDays(json: JSONObject): List<Pair<String, DaySchedule>> = json.keys().asSequence().map { group ->
        val day = json.getJSONObject(group)
        val halves = day.getJSONArray("halves")
        group to DaySchedule(LocalDate.parse(day.getString("date")), List(halves.length()) { Power.entries[halves.getInt(it)] })
    }.toList()
}
