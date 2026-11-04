package ua.svitik.widget

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import java.time.ZonedDateTime
import java.util.concurrent.Executors

/** The app, one page per tab: the status now, the day's schedule, the widgets and the settings. */
class MainActivity : Activity() {
    private lateinit var store: Store
    private val background = Executors.newSingleThreadExecutor()
    private var showTomorrow = false
    private var groups: List<String> = emptyList()

    // Tab button -> its page
    private val tabs = listOf(
        R.id.tab_now to R.id.page_now,
        R.id.tab_schedule to R.id.page_schedule,
        R.id.tab_widgets to R.id.page_widgets,
        R.id.tab_settings to R.id.page_settings,
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        store = Store(this)

        for ((tab, _) in tabs) findViewById<View>(tab).setOnClickListener { selectTab(tab) }
        selectTab(savedInstanceState?.getInt(STATE_TAB) ?: R.id.tab_now)

        val regions = findViewById<Spinner>(R.id.region)
        regions.adapter = ArrayAdapter(this, R.layout.spinner_item, REGIONS.map { it.name }).apply {
            setDropDownViewResource(R.layout.spinner_dropdown_item)
        }
        regions.setSelection(REGIONS.indexOf(store.region))
        regions.onItemSelectedListener = onSelected { position ->
            val region = REGIONS[position]
            if (region.id != store.regionId) {
                store.regionId = region.id
                render()
                refresh()
            }
        }

        findViewById<Spinner>(R.id.group).onItemSelectedListener = onSelected { position ->
            val group = groups.getOrNull(position) ?: return@onSelected
            if (group != store.group) {
                store.group = group
                render()
                Refresher.redraw(this)
            }
        }

        findViewById<Button>(R.id.refresh).setOnClickListener { refresh() }
        findViewById<Button>(R.id.today).setOnClickListener { showTomorrow = false; render() }
        findViewById<Button>(R.id.tomorrow).setOnClickListener { showTomorrow = true; render() }
        findViewById<Button>(R.id.add_small).setOnClickListener { pinWidget(SmallWidget::class.java) }
        findViewById<Button>(R.id.add_strip).setOnClickListener { pinWidget(StripWidget::class.java) }
        findViewById<Button>(R.id.add_day).setOnClickListener { pinWidget(DayWidget::class.java) }
        findViewById<Button>(R.id.open_battery).setOnClickListener { openAppSettings() }
        findViewById<Button>(R.id.open_battery_settings).setOnClickListener { openAppSettings() }

        Refresher.schedule(this)
    }

    override fun onResume() {
        super.onResume()
        render()
        refresh()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        tabs.firstOrNull { findViewById<View>(it.first).isSelected }?.let { outState.putInt(STATE_TAB, it.first) }
    }

    override fun onDestroy() {
        background.shutdown()
        super.onDestroy()
    }

    private fun selectTab(selected: Int) {
        for ((tab, page) in tabs) {
            findViewById<View>(tab).isSelected = tab == selected
            findViewById<View>(page).visibility = if (tab == selected) View.VISIBLE else View.GONE
        }
    }

    private fun refresh() {
        findViewById<View>(R.id.progress).visibility = View.VISIBLE
        background.execute {
            val ok = Refresher.download(this)
            runOnUiThread {
                if (isDestroyed) return@runOnUiThread
                findViewById<View>(R.id.progress).visibility = View.GONE
                if (!ok) Toast.makeText(this, R.string.load_failed, Toast.LENGTH_SHORT).show()
                render()
            }
        }
    }

    private fun render() {
        val schedule = store.schedule
        val group = store.group
        val now = ZonedDateTime.now(KYIV)
        val power = powerNow(schedule, group, now)
        renderNow(schedule, group, power, now)
        renderSchedule(schedule, group, power, now)
        renderSettings(schedule, group)
    }

    private fun renderNow(schedule: Schedule?, group: String?, power: PowerNow, now: ZonedDateTime) {
        findViewById<ImageView>(R.id.bolt).setImageResource(Widgets.boltIcon(power))
        findViewById<View>(R.id.card).setBackgroundResource(Widgets.cardBackground(power))
        findViewById<TextView>(R.id.status).setText(Widgets.statusText(power))
        findViewById<TextView>(R.id.next).text = Widgets.nextText(this, schedule, group, power, now)
        findViewById<TextView>(R.id.label).text = if (group == null) getString(R.string.choose_group) else "${store.region.short} · ${getString(R.string.group_n, group)}"
        findViewById<ImageView>(R.id.day_bar).setImageBitmap(Widgets.dayBar(schedule?.today?.get(group), now))
        findViewById<TextView>(R.id.updated).text = schedule?.updated?.let { getString(R.string.updated_at, it) } ?: ""
        findViewById<TextView>(R.id.error).apply {
            text = store.lastError?.let { getString(R.string.load_failed) } ?: ""
            visibility = if (store.lastError == null) View.GONE else View.VISIBLE
        }
        findViewById<View>(R.id.restricted_card).visibility = if (Refresher.isBackgroundRestricted(this)) View.VISIBLE else View.GONE
    }

    private fun renderSchedule(schedule: Schedule?, group: String?, power: PowerNow, now: ZonedDateTime) {
        findViewById<Button>(R.id.today).isSelected = !showTomorrow
        findViewById<Button>(R.id.tomorrow).isSelected = showTomorrow
        val emergency = if (showTomorrow) schedule?.emergencyTomorrow == true else power.emergency
        val day = if (showTomorrow) schedule?.tomorrow?.get(group) else schedule?.today?.get(group)
        val left = findViewById<LinearLayout>(R.id.column_left)
        val right = findViewById<LinearLayout>(R.id.column_right)
        left.removeAllViews()
        right.removeAllViews()
        findViewById<TextView>(R.id.no_schedule).apply {
            visibility = if (day == null) View.VISIBLE else View.GONE
            setText(if (emergency) R.string.emergency_text else if (showTomorrow) R.string.not_published_tomorrow else R.string.not_published_today)
        }
        if (day == null) return
        for (h in 0 until 24) {
            val isNow = !showTomorrow && h == now.hour
            val column = if (h < 12) left else right
            val row = layoutInflater.inflate(if (isNow) R.layout.widget_hour_now else R.layout.widget_hour, column, false)
            // In the widget the rows share the column's height; here the column grows with them
            row.layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(36)).apply { setMargins(0, dp(3), 0, dp(3)) }
            row.findViewById<TextView>(R.id.hour).apply { text = "%02d-%02d".format(h, h + 1); textSize = 13f }
            val (a, b) = day.halves[h * 2] to day.halves[h * 2 + 1]
            row.findViewById<ImageView>(R.id.indicator).setImageResource(when {
                a == Power.OFF && b == Power.OFF -> R.drawable.ind_off
                a == Power.OFF -> R.drawable.ind_first
                b == Power.OFF -> R.drawable.ind_second
                a == Power.MAYBE || b == Power.MAYBE -> R.drawable.ind_maybe
                else -> R.drawable.ind_on
            })
            column.addView(row)
        }
    }

    private fun renderSettings(schedule: Schedule?, group: String?) {
        val selectable = selectableGroups(schedule, group)
        if (selectable != groups) {
            groups = selectable
            findViewById<Spinner>(R.id.group).adapter = ArrayAdapter(this, R.layout.spinner_item, groups.map { getString(R.string.group_n, it) }).apply {
                setDropDownViewResource(R.layout.spinner_dropdown_item)
            }
        }
        groups.indexOf(group).takeIf { it >= 0 }?.let { findViewById<Spinner>(R.id.group).setSelection(it) }
        findViewById<TextView>(R.id.background_state).setText(
            if (Refresher.isBackgroundRestricted(this)) R.string.background_restricted else R.string.background_ok
        )
    }

    /** Android has no direct link to the app's battery page; it is one step from the app's settings. */
    private fun openAppSettings() {
        startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
    }

    /** Asks the launcher to place the widget (Android 8+, where the launcher supports it). */
    private fun pinWidget(provider: Class<out BaseWidget>) {
        val manager = getSystemService(AppWidgetManager::class.java)
        if (manager.isRequestPinAppWidgetSupported) {
            manager.requestPinAppWidget(ComponentName(this, provider), null, null)
        } else {
            Toast.makeText(this, R.string.pin_unsupported, Toast.LENGTH_LONG).show()
        }
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private fun onSelected(block: (Int) -> Unit) = object : AdapterView.OnItemSelectedListener {
        override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) = block(position)
        override fun onNothingSelected(parent: AdapterView<*>?) = Unit
    }

    private companion object {
        const val STATE_TAB = "tab"
    }
}
