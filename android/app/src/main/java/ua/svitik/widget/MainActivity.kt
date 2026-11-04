package ua.svitik.widget

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.os.Bundle
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

/** Region and group, today's / tomorrow's schedule, and buttons that put the widgets on the home screen. */
class MainActivity : Activity() {
    private lateinit var store: Store
    private val background = Executors.newSingleThreadExecutor()
    private var showTomorrow = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        store = Store(this)

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
            val groups = store.schedule?.groups ?: return@onSelected
            if (groups.getOrNull(position) != store.group) {
                store.group = groups[position]
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

        Refresher.schedule(this)
    }

    override fun onResume() {
        super.onResume()
        render()
        refresh()
    }

    override fun onDestroy() {
        background.shutdown()
        super.onDestroy()
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

        val groups = schedule?.groups.orEmpty()
        val groupSpinner = findViewById<Spinner>(R.id.group)
        groupSpinner.adapter = ArrayAdapter(this, R.layout.spinner_item, groups.map { getString(R.string.group_n, it) }).apply {
            setDropDownViewResource(R.layout.spinner_dropdown_item)
        }
        groups.indexOf(group).takeIf { it >= 0 }?.let { groupSpinner.setSelection(it) }

        findViewById<ImageView>(R.id.bolt).setImageResource(if (power.off) R.drawable.ic_bolt_off else R.drawable.ic_bolt_on)
        findViewById<View>(R.id.card).setBackgroundResource(if (power.off) R.drawable.widget_bg_off else R.drawable.widget_bg_on)
        findViewById<TextView>(R.id.status).setText(if (power.off) R.string.power_off else R.string.power_on)
        findViewById<TextView>(R.id.next).text = Widgets.nextText(this, schedule, group, power, now)
        findViewById<TextView>(R.id.updated).text = schedule?.updated?.let { getString(R.string.updated_at, it) } ?: ""
        findViewById<TextView>(R.id.error).apply {
            text = store.lastError?.let { getString(R.string.load_failed) } ?: ""
            visibility = if (store.lastError == null) View.GONE else View.VISIBLE
        }

        findViewById<Button>(R.id.today).isSelected = !showTomorrow
        findViewById<Button>(R.id.tomorrow).isSelected = showTomorrow
        val day = if (showTomorrow) schedule?.tomorrow?.get(group) else schedule?.today?.get(group)
        val left = findViewById<LinearLayout>(R.id.column_left)
        val right = findViewById<LinearLayout>(R.id.column_right)
        left.removeAllViews()
        right.removeAllViews()
        findViewById<TextView>(R.id.no_schedule).apply {
            visibility = if (day == null) View.VISIBLE else View.GONE
            setText(if (showTomorrow) R.string.not_published_tomorrow else R.string.not_published_today)
        }
        if (day == null) return
        for (h in 0 until 24) {
            val isNow = !showTomorrow && h == now.hour
            val row = layoutInflater.inflate(if (isNow) R.layout.widget_hour_now else R.layout.widget_hour, if (h < 12) left else right, false)
            // In the widget the rows share the column's height; here the column grows with them
            row.layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(34)).apply { setMargins(0, dp(3), 0, dp(3)) }
            row.findViewById<TextView>(R.id.hour).apply { text = "%02d-%02d".format(h, h + 1); textSize = 13f }
            val (a, b) = day.halves[h * 2] to day.halves[h * 2 + 1]
            row.findViewById<ImageView>(R.id.indicator).setImageResource(when {
                a == Power.OFF && b == Power.OFF -> R.drawable.ind_off
                a == Power.OFF -> R.drawable.ind_first
                b == Power.OFF -> R.drawable.ind_second
                a == Power.MAYBE || b == Power.MAYBE -> R.drawable.ind_maybe
                else -> R.drawable.ind_on
            })
            (if (h < 12) left else right).addView(row)
        }
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
}
