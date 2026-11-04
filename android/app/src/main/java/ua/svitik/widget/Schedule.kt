package ua.svitik.widget

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

/**
 * Outage schedules of the DTEK regions, read straight from DTEK's own sources (no server in between):
 * YASNO's public API (DTEK's supplier for Kyiv and Dnipro, incl. ЦЕК) and outage-data-ua, a copy of
 * the schedule the DTEK region pages publish. Same rules as the desktop widget's schedules.js:
 * the first source with today's schedule wins, and only today and tomorrow (Kyiv time) are kept.
 */

val KYIV: ZoneId = ZoneId.of("Europe/Kiev")

/** State of a half hour. */
enum class Power { ON, OFF, MAYBE }

/** One day of one group: 48 half hours from Kyiv midnight. */
class DaySchedule(val date: LocalDate, val halves: List<Power>)

class Schedule(
    val today: Map<String, DaySchedule>,      // group ("3.1") -> today
    val tomorrow: Map<String, DaySchedule>,   // only once published
    val updated: String?,                     // DTEK's own update time, e.g. "23.10.2026 03:00"
    val emergencyToday: Boolean = false,      // emergency outages: no schedule applies
    val emergencyTomorrow: Boolean = false,
    val emergencyMessage: String? = null,     // DTEK's own words, when they come from its page
) {
    val groups: List<String> = (today.keys + tomorrow.keys).toSortedSet(compareBy<String>({ it.substringBefore('.').toInt() }, { it })).toList()

    /** Emergency outages today, as DTEK's page says: its schedule for today does not apply. */
    fun withEmergency(message: String) = Schedule(emptyMap(), tomorrow, updated, true, emergencyTomorrow, message)
}

/** page: the DTEK page whose pop-up announces emergency outages. */
class Region(val id: String, val name: String, val short: String, val page: String, val sources: List<Source>)

fun interface Source {
    fun load(): Schedule
}

private const val OUTAGE_DATA_UA = "https://raw.githubusercontent.com/Baskerville42/outage-data-ua/main/data/"
private fun yasnoUrl(region: Int, dso: Int) =
    "https://app.yasno.ua/api/blackout-service/public/shutdowns/regions/$region/dsos/$dso/planned-outages"

// The DTEK Dnipro page and its copy also carry ЦЕК's groups, as GPV1001.1 ... GPV1006.2
private val CEK_GROUP = Regex("""^100(\d+\.\d+)$""")
private val dniproOnly: (String) -> String? = { if (CEK_GROUP.matches(it)) null else it }
private val cekOnly: (String) -> String? = { CEK_GROUP.find(it)?.groupValues?.get(1) }

/** Donetsk is published only on the DTEK page itself, which keeps apps out with its bot protection. */
val REGIONS = listOf(
    Region("dnem", "Дніпро та область (ДТЕК)", "Дніпро", dtekPage("dnem"),
        listOf(yasno(3, 301), dtekCopy("dnipro.json", dniproOnly))),
    Region("cek", "Дніпро та область (ЦЕК)", "ЦЕК", dtekPage("dnem"),
        listOf(yasno(3, 303), dtekCopy("dnipro.json", cekOnly))),
    Region("kem", "Київ (місто, ДТЕК)", "Київ", dtekPage("kem"),
        listOf(yasno(25, 902), dtekCopy("kyiv.json"))),
    Region("krem", "Київська обл. (ДТЕК)", "Київ обл.", dtekPage("krem"), listOf(dtekCopy("kyiv-region.json"))),
    Region("oem", "Одеська обл. (ДТЕК)", "Одеса", dtekPage("oem"), listOf(dtekCopy("odesa.json"))),
)

private fun dtekPage(id: String) = "https://www.dtek-$id.com.ua/ua/shutdowns"

/** Groups to choose from: those in the schedule, or the usual ones while nothing is published. */
fun selectableGroups(schedule: Schedule?, current: String?): List<String> {
    val groups = schedule?.groups.orEmpty().ifEmpty { (1..6).flatMap { listOf("$it.1", "$it.2") } }
    return if (current != null && current !in groups) listOf(current) + groups else groups
}

fun regionById(id: String?): Region = REGIONS.firstOrNull { it.id == id } ?: REGIONS.first()

/** The first source with today's schedule; failing that, the first one that answered at all. */
fun loadSchedule(region: Region): Schedule {
    var answered: Schedule? = null
    var error: Exception? = null
    for (source in region.sources) {
        try {
            val schedule = source.load()
            if (schedule.today.isNotEmpty() || schedule.emergencyToday) return schedule
            if (answered == null) answered = schedule
        } catch (e: Exception) {
            if (error == null) error = e
        }
    }
    return answered ?: throw error ?: IllegalStateException("No source")
}

// ── YASNO: { "1.1": { today: { slots: [{ start, end, type }], date, status }, tomorrow: {...}, updatedOn } }
// slots in minutes since midnight; type "Definite" = no power; status "WaitingForSchedule" = not published yet,
// "EmergencyShutdowns" = emergency outages ordered by Ukrenergo, schedules do not apply

private fun yasno(regionId: Int, dsoId: Int) = Source {
    val answer = JSONObject(httpGet(yasnoUrl(regionId, dsoId)))
    val today = mutableMapOf<String, DaySchedule>()
    val tomorrow = mutableMapOf<String, DaySchedule>()
    var updated: Instant? = null
    var emergencyToday = false
    var emergencyTomorrow = false
    val nowDate = LocalDate.now(KYIV)
    for (group in answer.keys()) {
        if (!Regex("""^\d+\.\d+$""").matches(group)) continue
        val entry = answer.optJSONObject(group) ?: continue
        entry.optString("updatedOn").takeIf { it.isNotEmpty() }?.let {
            runCatching { Instant.parse(it.replace("+00:00", "Z")) }.getOrNull()?.let { t -> if (updated == null || t > updated) updated = t }
        }
        for (key in listOf("today", "tomorrow")) {
            val day = entry.optJSONObject(key) ?: continue
            if (day.optString("status") == "WaitingForSchedule") continue
            val date = runCatching { LocalDate.parse(day.optString("date").take(10)) }.getOrNull() ?: continue
            if (day.optString("status") == "EmergencyShutdowns") {
                if (date == nowDate) emergencyToday = true
                if (date == nowDate.plusDays(1)) emergencyTomorrow = true
                continue
            }
            val slots = day.optJSONArray("slots")
            val halves = List(48) { i ->
                val minute = i * 30 + 15
                var state = Power.ON
                for (s in 0 until (slots?.length() ?: 0)) {
                    val slot = slots!!.getJSONObject(s)
                    if (slot.optInt("start") <= minute && minute < slot.optInt("end")) {
                        state = when (slot.optString("type")) {
                            "Definite" -> Power.OFF
                            "NotPlanned" -> Power.ON
                            else -> Power.MAYBE
                        }
                    }
                }
                state
            }
            place(DaySchedule(date, halves), group, today, tomorrow)
        }
    }
    Schedule(today, tomorrow, updated?.let { formatKyiv(it) }, emergencyToday, emergencyTomorrow)
}

// ── The DTEK pages' DisconSchedule.fact, copied by outage-data-ua:
// { fact: { data: { <unix s of a day>: { "GPV1.1": { "1".."24": "yes" | "no" | "first" | "second" | "mfirst" | "msecond" | "maybe" } } }, update } }

private fun dtekCopy(file: String, groups: (String) -> String? = { it }) = Source {
    val fact = JSONObject(httpGet(OUTAGE_DATA_UA + file)).getJSONObject("fact")
    val data = fact.optJSONObject("data") ?: JSONObject() // an empty day list comes as [] instead of {}
    val today = mutableMapOf<String, DaySchedule>()
    val tomorrow = mutableMapOf<String, DaySchedule>()
    for (key in data.keys()) {
        // Some copies key the day by UTC midnight: read the date a few hours later
        val date = Instant.ofEpochSecond(key.toLong()).plusSeconds(6 * 3600).atZone(KYIV).toLocalDate()
        val day = data.optJSONObject(key) ?: continue
        for (gpv in day.keys()) {
            val group = groups(gpv.removePrefix("GPV")) ?: continue
            val hours = day.optJSONObject(gpv) ?: continue
            val halves = ArrayList<Power>(48)
            for (h in 1..24) {
                val (first, second) = when (hours.optString(h.toString())) {
                    "no" -> Power.OFF to Power.OFF
                    "first" -> Power.OFF to Power.ON
                    "second" -> Power.ON to Power.OFF
                    "mfirst" -> Power.MAYBE to Power.ON
                    "msecond" -> Power.ON to Power.MAYBE
                    "maybe" -> Power.MAYBE to Power.MAYBE
                    else -> Power.ON to Power.ON
                }
                halves += first
                halves += second
            }
            place(DaySchedule(date, halves), group, today, tomorrow)
        }
    }
    Schedule(today, tomorrow, fact.optString("update").takeIf { it.isNotEmpty() })
}

// ── The DTEK pages' pop-up (m-attention): "За наказом НЕК Укренерго введені екстрені відключення ... Графіки ... не діють".
// During emergency outages the page keeps the last schedule and says there that it does not apply.

/** The pop-up's text if it announces emergency outages. */
fun emergencyNotice(popup: String): String? {
    val text = popup.replace(Regex("""\s+"""), " ").trim()
    val lower = text.lowercase()
    return text.takeIf { "екстрен" in lower && Regex("""не\s+ді""").containsMatchIn(lower) }
}

/**
 * Reads the region's page without a browser and notes what its pop-up says. Usually the bot protection answers
 * instead: then nothing is known and the last note stays (the app also reads the page, in a hidden WebView).
 */
fun checkDtekPage(region: Region, store: Store) {
    val html = runCatching { httpGet(region.page, "text/html") }.getOrNull() ?: return
    if ("DisconSchedule.fact" !in html) return
    val popup = Regex("""class="m-attention__text"[^>]*>([\s\S]*?)</div>""").find(html)?.groupValues?.get(1).orEmpty()
    store.setPageNotice(region.page, emergencyNotice(popup.replace(Regex("<[^>]+>"), " ").replace("&nbsp;", " ")))
}

private fun place(day: DaySchedule, group: String, today: MutableMap<String, DaySchedule>, tomorrow: MutableMap<String, DaySchedule>) {
    val now = LocalDate.now(KYIV)
    when (day.date) {
        now -> today[group] = day
        now.plusDays(1) -> tomorrow[group] = day
        else -> Unit // an old or far day: not shown
    }
}

private fun httpGet(url: String, accept: String = "application/json"): String {
    val connection = URL(url).openConnection() as HttpURLConnection
    connection.connectTimeout = 10_000
    connection.readTimeout = 10_000
    connection.setRequestProperty("Accept", accept)
    connection.setRequestProperty("User-Agent", "SvitikWidget/1.0 (Android)")
    try {
        if (connection.responseCode !in 200..299) throw IllegalStateException("HTTP ${connection.responseCode}")
        return connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
    } finally {
        connection.disconnect()
    }
}

private val KYIV_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm")
private fun formatKyiv(instant: Instant): String = KYIV_FORMAT.format(instant.atZone(KYIV))

// ── Where the power is now and when that changes ──

class PowerNow(
    val known: Boolean,          // there is a schedule for today
    val off: Boolean,
    val changeAt: ZonedDateTime?, // null: no change in the published schedule
    val emergency: Boolean = false, // emergency outages: whether there is power is not known
)

/** State of the group now and the next change, over today and (if published) tomorrow. */
fun powerNow(schedule: Schedule?, group: String?, now: ZonedDateTime = ZonedDateTime.now(KYIV)): PowerNow {
    if (schedule?.emergencyToday == true) return PowerNow(false, false, null, emergency = true)
    val today = schedule?.today?.get(group) ?: return PowerNow(false, false, null)
    val days = listOfNotNull(today, schedule.tomorrow[group])
    val start = now.toLocalDate().atStartOfDay(KYIV)
    val index = ((now.toEpochSecond() - start.toEpochSecond()) / 1800).toInt().coerceIn(0, 47)
    val off = today.halves[index] == Power.OFF
    var i = index + 1
    while (i < days.size * 48) {
        val state = days[i / 48].halves[i % 48]
        if ((state == Power.OFF) != off) return PowerNow(true, off, start.plusMinutes(30L * i))
        i++
    }
    return PowerNow(true, off, null)
}
