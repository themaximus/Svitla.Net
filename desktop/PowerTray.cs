// Tray icon of the DTEK widget: a green lightning bolt while there is power, a grey crossed-out one
// while there is none. Its menu says what happens next ("power off at 17:00, in 1:23:45") and counts
// down to it; it also shows or hides the widget and exits the app.
//
// The page sends the selected group's schedule as the points where the power state changes
// (see postPowerTimeline in main.js); the countdown runs here, on the computer's clock.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Windows.Forms;

sealed class PowerTray : IDisposable
{
    static readonly Color Green = Color.FromArgb(0, 255, 136);
    static readonly Color Grey = Color.FromArgb(150, 156, 166);

    readonly NotifyIcon notifyIcon = new NotifyIcon();
    readonly ContextMenuStrip menu = new ContextMenuStrip();
    readonly ToolStripMenuItem headline = new ToolStripMenuItem();
    readonly ToolStripMenuItem detail = new ToolStripMenuItem();
    readonly ToolStripMenuItem toggle = new ToolStripMenuItem();
    readonly ToolStripMenuItem exit = new ToolStripMenuItem();
    readonly Timer clock = new Timer { Interval = 1000 };
    readonly Icon appIcon, powerOnIcon, powerOffIcon;

    // Points where the power state changes: (unix ms, power off), sorted; the schedule ends at timelineEnd
    readonly List<KeyValuePair<long, bool>> timeline = new List<KeyValuePair<long, bool>>();
    long timelineEnd;
    enum Schedule { Loading, Unavailable, Received, Emergency }
    Schedule schedule = Schedule.Loading;
    bool english, widgetVisible = true;
    Icon shownIcon;

    public PowerTray(Icon appIcon, Action toggleWidget, Action showWidget, Action exitApp)
    {
        this.appIcon = appIcon;
        int size = SystemInformation.SmallIconSize.Width;
        powerOnIcon = DrawBolt(size, Green, false);
        powerOffIcon = DrawBolt(size, Grey, true);

        headline.Font = new Font(menu.Font, FontStyle.Bold);
        headline.Click += (s, e) => showWidget();
        detail.Click += (s, e) => showWidget();
        toggle.Click += (s, e) => toggleWidget();
        exit.Click += (s, e) => exitApp();
        menu.Items.AddRange(new ToolStripItem[] { headline, detail, new ToolStripSeparator(), toggle, new ToolStripSeparator(), exit });
        menu.Opening += (s, e) => Refresh();

        notifyIcon.ContextMenuStrip = menu;
        notifyIcon.MouseClick += (s, e) => { if (e.Button == MouseButtons.Left) toggleWidget(); };
        notifyIcon.Icon = shownIcon = appIcon;
        notifyIcon.Text = Program.AppName;
        notifyIcon.Visible = true;

        clock.Tick += (s, e) => Refresh();
        clock.Start();
        Refresh();
    }

    public bool English { set { english = value; Refresh(); } }

    public bool WidgetVisible { set { widgetVisible = value; Refresh(); } }

    /// <summary>
    /// "end|time,off;time,off;..." from the page; "0|" when nothing is published for the group,
    /// "" when the schedule could not be loaded, "emergency" during emergency outages (no schedule applies).
    /// </summary>
    public void SetTimeline(string message)
    {
        timeline.Clear();
        timelineEnd = 0;
        schedule = message.Length == 0 ? Schedule.Unavailable : message == "emergency" ? Schedule.Emergency : Schedule.Received;
        if (schedule != Schedule.Received) { Refresh(); return; }
        try
        {
            string[] parts = message.Split('|');
            timelineEnd = long.Parse(parts[0], CultureInfo.InvariantCulture);
            foreach (string point in parts[1].Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries))
            {
                string[] p = point.Split(',');
                timeline.Add(new KeyValuePair<long, bool>(long.Parse(p[0], CultureInfo.InvariantCulture), p[1] == "1"));
            }
        }
        catch (Exception ex)
        {
            if (!(ex is FormatException || ex is IndexOutOfRangeException || ex is OverflowException)) throw;
            timeline.Clear();
            timelineEnd = 0;
        }
        Refresh();
    }

    void Refresh()
    {
        toggle.Text = widgetVisible ? T("Сховати віджет", "Hide widget") : T("Показати віджет", "Show widget");
        exit.Text = T("Вийти", "Exit");

        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        int current = timeline.FindLastIndex(p => p.Key <= now);
        string head, next;
        Icon icon;

        if (schedule == Schedule.Emergency)
        {
            icon = appIcon;
            head = T("Екстрені відключення", "Emergency outages");
            next = T("Графіки відключень не діють", "Outage schedules do not apply");
        }
        else if (current < 0 || now >= timelineEnd)
        {
            icon = appIcon;
            head = Program.AppName;
            next = schedule == Schedule.Loading     ? T("Графік завантажується…", "Loading the schedule…")
                 : schedule == Schedule.Unavailable ? T("Графік недоступний", "Schedule unavailable")
                 : T("Відключень немає або графік не опубліковано", "No outages, or no schedule published");
        }
        else
        {
            bool off = timeline[current].Value;
            icon = off ? powerOffIcon : powerOnIcon;
            head = off ? T("Світла немає", "Power off") : T("Світло є", "Power on");
            if (current + 1 < timeline.Count)
            {
                long at = timeline[current + 1].Key;
                next = (off ? T("Увімкнуть ", "Back on ") : T("Вимкнуть ", "Goes off ")) + When(at) +
                       T(" · через ", " · in ") + Countdown(at - now);
            }
            else
            {
                next = off ? T("Час увімкнення невідомий", "Return time unknown")
                           : T("Відключень не заплановано", "No outages planned");
            }
        }

        headline.Text = head;
        detail.Text = next;
        if (icon != shownIcon) notifyIcon.Icon = shownIcon = icon;
        string tip = head + "\n" + next;
        notifyIcon.Text = tip.Length > 63 ? tip.Substring(0, 63) : tip; // the tooltip limit
    }

    string When(long unixMs)
    {
        DateTime at = DateTimeOffset.FromUnixTimeMilliseconds(unixMs).LocalDateTime;
        string prefix = at.Date == DateTime.Today ? T("о ", "at ") : T("завтра о ", "tomorrow at ");
        return prefix + at.ToString("HH:mm", CultureInfo.InvariantCulture);
    }

    static string Countdown(long ms)
    {
        var left = TimeSpan.FromMilliseconds(Math.Max(0, ms));
        return string.Format(CultureInfo.InvariantCulture, "{0}:{1:00}:{2:00}", (int)left.TotalHours, left.Minutes, left.Seconds);
    }

    string T(string ukrainian, string englishText) { return english ? englishText : ukrainian; }

    // The bolt of the app icon; "off" adds a slash from corner to corner, cut out of the bolt
    static Icon DrawBolt(int size, Color color, bool crossedOut)
    {
        using (var bitmap = new Bitmap(size, size))
        {
            using (var g = Graphics.FromImage(bitmap))
            using (var brush = new SolidBrush(color))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                float s = size / 24f;
                g.FillPolygon(brush, new[]
                {
                    new PointF(14 * s, 1 * s), new PointF(4 * s, 13.5f * s), new PointF(10.5f * s, 13.5f * s),
                    new PointF(9 * s, 23 * s), new PointF(20 * s, 9.5f * s), new PointF(13.5f * s, 9.5f * s),
                });
                if (crossedOut)
                {
                    g.CompositingMode = CompositingMode.SourceCopy;
                    using (var gap = new Pen(Color.Transparent, 5 * s))
                        g.DrawLine(gap, 3 * s, 3 * s, 21 * s, 21 * s);
                    g.CompositingMode = CompositingMode.SourceOver;
                    using (var slash = new Pen(color, 2 * s) { StartCap = LineCap.Round, EndCap = LineCap.Round })
                        g.DrawLine(slash, 3 * s, 3 * s, 21 * s, 21 * s);
                }
            }
            // Icon.FromHandle does not own the handle; a copy that does is kept, the handle is freed
            IntPtr handle = bitmap.GetHicon();
            try
            {
                using (var borrowed = Icon.FromHandle(handle)) return (Icon)borrowed.Clone();
            }
            finally
            {
                DestroyIcon(handle);
            }
        }
    }

    public void Dispose()
    {
        clock.Dispose();
        notifyIcon.Visible = false;
        notifyIcon.Dispose();
        menu.Dispose();
        powerOnIcon.Dispose();
        powerOffIcon.Dispose();
    }

    [DllImport("user32.dll")]
    static extern bool DestroyIcon(IntPtr handle);
}
