package ua.svitik.widget

import android.Manifest
import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.View
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import org.json.JSONTokener
import java.time.ZonedDateTime
import java.util.concurrent.Executors

/** The app is the day's schedule; the bell opens the technical notifications, the gear the settings and widgets. */
class MainActivity : Activity() {
    private lateinit var store: Store
    private val background = Executors.newSingleThreadExecutor()
    private var showTomorrow = false
    private var groups: List<String> = emptyList()
    private var page = R.id.page_schedule
    private val handler = Handler(Looper.getMainLooper())
    private var pageReader: WebView? = null
    private var checkedPage: String? = null
    private var checkedAt = 0L

    // Page -> its title
    private val pages = mapOf(
        R.id.page_schedule to R.string.schedule_title,
        R.id.page_alerts to R.string.alerts_title,
        R.id.page_settings to R.string.settings_title,
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        store = Store(this)

        // A second tap on the icon returns to the schedule, as does the back button
        findViewById<View>(R.id.open_alerts).setOnClickListener { togglePage(R.id.page_alerts) }
        findViewById<View>(R.id.open_settings).setOnClickListener { togglePage(R.id.page_settings) }
        showPage(savedInstanceState?.getInt(STATE_PAGE)?.takeIf { it in pages } ?: R.id.page_schedule)

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

        Refresher.schedule(this)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && savedInstanceState == null &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }

    // Emergency outages may already be under way when the notifications get allowed
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        Refresher.redraw(this)
    }

    override fun onResume() {
        super.onResume()
        render()
        refresh()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putInt(STATE_PAGE, page)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (page == R.id.page_schedule) super.onBackPressed() else showPage(R.id.page_schedule)
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        closePageReader()
        background.shutdown()
        super.onDestroy()
    }

    private fun togglePage(target: Int) = showPage(if (page == target) R.id.page_schedule else target)

    private fun showPage(selected: Int) {
        page = selected
        for (id in pages.keys) findViewById<View>(id).visibility = if (id == selected) View.VISIBLE else View.GONE
        findViewById<TextView>(R.id.title).setText(pages.getValue(selected))
        findViewById<View>(R.id.open_alerts).isSelected = selected == R.id.page_alerts
        findViewById<View>(R.id.open_settings).isSelected = selected == R.id.page_settings
    }

    /**
     * The DTEK page's pop-up announces emergency outages, but its bot protection keeps plain requests out.
     * As on the desktop, the page is read in a browser nobody sees: a WebView attached to no window.
     */
    private fun checkPageNotice() {
        val page = store.region.page
        val now = System.currentTimeMillis()
        if (pageReader != null || (page == checkedPage && now - checkedAt < PAGE_CHECK_MS)) return
        val reader = WebView(this)
        pageReader = reader
        val finish = Runnable { closePageReader() }
        reader.settings.javaScriptEnabled = true
        reader.settings.domStorageEnabled = true
        reader.settings.blockNetworkImage = true
        reader.webViewClient = object : WebViewClient() {
            // The bot protection's page finishes too, then reloads the real one
            override fun onPageFinished(view: WebView, url: String) {
                view.evaluateJavascript(READ_POPUP) { answer ->
                    if (pageReader !== reader) return@evaluateJavascript
                    val popup = runCatching { JSONObject(JSONTokener(answer).nextValue() as String) }.getOrNull() ?: return@evaluateJavascript
                    if (!popup.optBoolean("ready")) return@evaluateJavascript
                    handler.removeCallbacks(finish)
                    checkedPage = page
                    checkedAt = System.currentTimeMillis()
                    store.setPageNotice(page, emergencyNotice(popup.optString("text")))
                    Log.i("Svitik", "DTEK page read, emergency: ${store.schedule?.emergencyToday}")
                    Refresher.redraw(this@MainActivity)
                    render()
                    handler.post(finish)
                }
            }
        }
        handler.postDelayed(finish, PAGE_TIMEOUT_MS)
        reader.loadUrl(page)
    }

    private fun closePageReader() {
        pageReader?.destroy()
        pageReader = null
    }

    private fun refresh() {
        checkPageNotice()
        findViewById<View>(R.id.progress).visibility = View.VISIBLE
        background.execute {
            Refresher.download(this)
            runOnUiThread {
                if (isDestroyed) return@runOnUiThread
                findViewById<View>(R.id.progress).visibility = View.GONE
                render()
            }
        }
    }

    private fun render() {
        val schedule = store.schedule
        val group = store.group
        val now = ZonedDateTime.now(KYIV)
        val power = powerNow(schedule, group, now)
        renderAlerts(schedule)
        renderSchedule(schedule, group, power, now)
        renderSettings(schedule, group)
    }

    // The technical notices live behind the bell; a dot on it says one of them needs attention
    private fun renderAlerts(schedule: Schedule?) {
        val failed = store.lastError != null
        val restricted = Refresher.isBackgroundRestricted(this)
        findViewById<TextView>(R.id.updated).text = schedule?.updated?.let { getString(R.string.updated_at, it) } ?: ""
        findViewById<View>(R.id.error).visibility = if (failed) View.VISIBLE else View.GONE
        findViewById<View>(R.id.background_state).visibility = if (restricted) View.GONE else View.VISIBLE
        findViewById<View>(R.id.restricted_card).visibility = if (restricted) View.VISIBLE else View.GONE
        findViewById<View>(R.id.alerts_dot).visibility = if (failed || restricted) View.VISIBLE else View.GONE
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
        // The day of emergency outages: DTEK's own words instead of the hours
        findViewById<View>(R.id.emergency_card).visibility = if (emergency) View.VISIBLE else View.GONE
        findViewById<TextView>(R.id.emergency_message).text = schedule?.emergencyMessage ?: getString(R.string.emergency_text)
        findViewById<TextView>(R.id.no_schedule).apply {
            visibility = if (day == null && !emergency) View.VISIBLE else View.GONE
            setText(if (showTomorrow) R.string.not_published_tomorrow else R.string.not_published_today)
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
        const val STATE_PAGE = "page"
        const val PAGE_CHECK_MS = 10 * 60_000L
        const val PAGE_TIMEOUT_MS = 30_000L
        const val READ_POPUP = "JSON.stringify({ready: document.documentElement.outerHTML.includes('DisconSchedule.fact'), text: (document.querySelector('.m-attention__text') || {}).textContent || ''})"
    }
}
