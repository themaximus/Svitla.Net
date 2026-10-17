// Desktop app for the DTEK widget (Windows).
//
// Starts the bundled node.exe with server.js on the loopback interface, without a console window,
// and shows the widget through WebView2, the browser engine that is part of Windows, as a frameless
// transparent desktop widget with a tray icon (show / hide / exit). The widget is moved by dragging
// it (unless the user pinned it in its settings) and its position is remembered.
// Browser data and the position live in %LOCALAPPDATA%\DTEK Widget, separate from the user's browsers.
// The server lives exactly as long as the window: it is attached to a kill-on-close job object,
// so it never outlives the app, even if the app crashes.
//
// Built by desktop\build.ps1 with the C# compiler that ships with .NET Framework 4.

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

static class Program
{
    public const string AppName = "DTEK Widget";
    const string MutexName = "DTEKWidgetLauncher"; // also the AppMutex of the installer
    const string ShowEventName = "DTEKWidgetShow";

    [DllImport("user32.dll")]
    static extern bool SetProcessDPIAware();

    [STAThread]
    static int Main()
    {
        bool firstInstance;
        using (var mutex = new Mutex(true, MutexName, out firstInstance))
        using (var showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName))
        {
            if (!firstInstance)
            {
                showEvent.Set(); // the running instance brings its window to the front
                return 0;
            }

            // Without this Windows stretches the window as a bitmap on scaled displays and the text blurs
            SetProcessDPIAware();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (var form = new WidgetForm(showEvent))
            {
                Application.Run(form);
                return form.ExitCode;
            }
        }
    }
}

sealed class WidgetForm : Form
{
    // Fixed port: the settings are kept in localStorage, which is tied to the page origin
    const int Port = 47381;
    static readonly string Url = "http://127.0.0.1:" + Port + "/";
    // The page in widget mode: just the widget, 360 x 732 CSS pixels
    const string PageUrlQuery = "?desktop";
    const int PageWidth = 360, PageHeight = 735;
    float dpiScale = 1;

    readonly string appDir = AppDomain.CurrentDomain.BaseDirectory;
    readonly string dataDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Program.AppName);
    string PositionFile { get { return Path.Combine(dataDir, "window.txt"); } }

    readonly EventWaitHandle showEvent;
    readonly RegisteredWaitHandle showWait;
    readonly KillOnCloseJob job = new KillOnCloseJob();
    readonly WebView2 webView = new WebView2();
    readonly NotifyIcon tray = new NotifyIcon();
    readonly ToolStripMenuItem trayToggle = new ToolStripMenuItem();
    readonly ToolStripMenuItem trayExit = new ToolStripMenuItem();
    bool english;
    StreamWriter log;
    Process server;
    bool closing;

    public int ExitCode { get; private set; }

    public WidgetForm(EventWaitHandle showEvent)
    {
        // A frameless window that lives in the tray, not on the taskbar. Everything outside the
        // widget's rounded shape is transparent: the client area is turned into DWM "glass"
        // (see OnHandleCreated), black pixels there are see-through, and the page has no background.
        Text = Program.AppName;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        BackColor = Color.Black;
        StartPosition = FormStartPosition.Manual;
        FitToPage();
        Location = LoadPosition();

        webView.Dock = DockStyle.Fill;
        webView.DefaultBackgroundColor = Color.Transparent;
        Controls.Add(webView);

        SetUpTray();

        this.showEvent = showEvent;
        showWait = ThreadPool.RegisterWaitForSingleObject(showEvent,
            (state, timedOut) => BeginInvoke(new Action(ShowWidget)), null, Timeout.Infinite, false);
    }

    // A widget appearing (e.g. at sign-in) must not take the focus from what the user is doing
    protected override bool ShowWithoutActivation { get { return true; } }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        var glass = new MARGINS { Left = -1, Right = -1, Top = -1, Bottom = -1 };
        DwmExtendFrameIntoClientArea(Handle, ref glass);
    }

    void FitToPage()
    {
        // Screen DPI without CreateGraphics(): creating the window this early breaks its transparency
        using (var g = Graphics.FromHwnd(IntPtr.Zero)) dpiScale = g.DpiX / 96f;
        ClientSize = new Size((int)(PageWidth * dpiScale), (int)(PageHeight * dpiScale));
        Rectangle screen = Screen.PrimaryScreen.WorkingArea;
        if (Height > screen.Height) Height = screen.Height;
    }

    // On a screen shorter than the widget the page is scaled down instead of being cut off
    void ZoomToFit()
    {
        if (webView.CoreWebView2 == null) return;
        double fit = Math.Min(ClientSize.Width / (PageWidth * dpiScale), ClientSize.Height / (PageHeight * dpiScale));
        webView.ZoomFactor = Math.Max(0.5, Math.Min(1.0, fit));
    }

    // ── Position: remembered between runs, bottom-right corner of the main screen by default ──

    Point LoadPosition()
    {
        try
        {
            string[] xy = File.ReadAllText(PositionFile).Split(' ');
            var saved = new Rectangle(int.Parse(xy[0]), int.Parse(xy[1]), Width, Height);
            // Only if most of the widget is still on a connected screen
            foreach (var screen in Screen.AllScreens)
            {
                var visible = Rectangle.Intersect(screen.WorkingArea, saved);
                if (visible.Width * visible.Height * 2 > saved.Width * saved.Height) return saved.Location;
            }
        }
        catch (Exception) { } // no or unreadable file: use the default
        Rectangle area = Screen.PrimaryScreen.WorkingArea;
        int margin = (int)(16 * dpiScale);
        return new Point(area.Right - Width - margin, Math.Max(area.Top, area.Bottom - Height - margin));
    }

    void SavePosition()
    {
        try { File.WriteAllText(PositionFile, Left + " " + Top); }
        catch (IOException) { }
    }

    // Raised when a move started by the page (see "drag") ends
    protected override void OnResizeEnd(EventArgs e)
    {
        base.OnResizeEnd(e);
        SavePosition();
    }

    // ── Tray ──

    void SetUpTray()
    {
        trayToggle.Click += (s, e) => { if (Visible) Hide(); else ShowWidget(); };
        trayExit.Click += (s, e) => Close();
        var menu = new ContextMenuStrip();
        menu.Items.Add(trayToggle);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(trayExit);

        tray.Icon = Icon;
        tray.Text = Program.AppName;
        tray.ContextMenuStrip = menu;
        tray.MouseClick += (s, e) => { if (e.Button == MouseButtons.Left) { if (Visible) Hide(); else ShowWidget(); } };
        tray.Visible = true;
        UpdateTrayText();
    }

    void UpdateTrayText()
    {
        trayToggle.Text = Visible ? (english ? "Hide widget" : "Сховати віджет")
                                  : (english ? "Show widget" : "Показати віджет");
        trayExit.Text = english ? "Exit" : "Вийти";
    }

    protected override void OnVisibleChanged(EventArgs e)
    {
        base.OnVisibleChanged(e);
        UpdateTrayText();
    }

    void ShowWidget()
    {
        Show();
        Activate();
    }

    // ── Messages from the page (main.js, postToApp) ──

    void OnPageMessage(string message)
    {
        if (message == "drag")
        {
            // Hand the pressed mouse button over to Windows as a drag of the window
            ReleaseCapture();
            SendMessage(Handle, WM_NCLBUTTONDOWN, (IntPtr)HTCAPTION, IntPtr.Zero);
        }
        else if (message == "hide") Hide();
        else if (message == "close") Close();
        else if (message.StartsWith("lang:"))
        {
            english = message == "lang:en";
            UpdateTrayText();
        }
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        Directory.CreateDirectory(dataDir);
        // Overwritten on every start, so the log cannot grow without bound
        log = new StreamWriter(Path.Combine(dataDir, "server.log"), false) { AutoFlush = true };

        try
        {
            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(dataDir, "WebView2"));
            await webView.EnsureCoreWebView2Async(environment);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            Fail("Microsoft Edge WebView2 Runtime is not installed.\n" +
                 "Download it from https://go.microsoft.com/fwlink/p/?LinkId=2124703");
            return;
        }
        ConfigureBrowser(webView.CoreWebView2);
        ZoomToFit();

        if (!StartServer()) return;
        if (!await Task.Run(() => WaitForServer()))
        {
            Fail("The widget server did not start. See " + Path.Combine(dataDir, "server.log"));
            return;
        }
        webView.CoreWebView2.Navigate(Url + PageUrlQuery);
    }

    void ConfigureBrowser(CoreWebView2 core)
    {
        var settings = core.Settings;
        settings.AreDevToolsEnabled = false;
        settings.AreDefaultContextMenusEnabled = false;
        settings.IsStatusBarEnabled = false;
        settings.IsZoomControlEnabled = false;
        settings.AreBrowserAcceleratorKeysEnabled = false;
        settings.IsGeneralAutofillEnabled = false;
        settings.IsPasswordAutosaveEnabled = false;

        // The window shows only the widget; links to other sites open in the user's browser
        core.NewWindowRequested += (s, e) => { e.Handled = true; OpenExternal(e.Uri); };
        core.NavigationStarting += (s, e) =>
        {
            if (!e.Uri.StartsWith(Url, StringComparison.OrdinalIgnoreCase))
            {
                e.Cancel = true;
                OpenExternal(e.Uri);
            }
        };
        core.WebMessageReceived += (s, e) =>
        {
            string message;
            try { message = e.TryGetWebMessageAsString(); }
            catch (ArgumentException) { return; } // not a string: not one of ours
            OnPageMessage(message);
        };
        core.NavigationCompleted += (s, e) =>
            Log("[app] page loaded: " + (e.IsSuccess ? "ok" : e.WebErrorStatus.ToString()));
    }

    static void OpenExternal(string uri)
    {
        if (uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ||
            uri.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
        {
            Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true });
        }
    }

    bool StartServer()
    {
        string node = Path.Combine(appDir, "node", "node.exe");
        string script = Path.Combine(appDir, "app", "server.js");
        if (!File.Exists(node) || !File.Exists(script))
        {
            Fail("The installation is damaged: " + (File.Exists(node) ? script : node) + " is missing.");
            return false;
        }

        var psi = new ProcessStartInfo(node, "\"" + script + "\"")
        {
            WorkingDirectory = Path.GetDirectoryName(script),
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        psi.EnvironmentVariables["HOST"] = "127.0.0.1";
        psi.EnvironmentVariables["PORT"] = Port.ToString();

        server = new Process { StartInfo = psi, EnableRaisingEvents = true };
        server.OutputDataReceived += (s, e) => Log(e.Data);
        server.ErrorDataReceived += (s, e) => Log(e.Data);
        server.Exited += (s, e) =>
        {
            if (!closing) BeginInvoke(new Action(() => Fail("The widget server stopped unexpectedly. See " +
                                                            Path.Combine(dataDir, "server.log"))));
        };

        server.Start();
        job.Add(server);
        server.BeginOutputReadLine();
        server.BeginErrorReadLine();
        return true;
    }

    bool WaitForServer()
    {
        for (int i = 0; i < 100 && !server.HasExited; i++)
        {
            try
            {
                var request = (HttpWebRequest)WebRequest.Create(Url + "api/health");
                request.Timeout = 1000;
                request.Proxy = null;
                using (request.GetResponse()) return true;
            }
            catch (WebException)
            {
                Thread.Sleep(100);
            }
        }
        return false;
    }

    void Log(string line)
    {
        if (line == null) return;
        lock (this) if (log != null) log.WriteLine(line);
    }

    void Fail(string message)
    {
        if (closing) return;
        closing = true;
        ExitCode = 1;
        MessageBox.Show(this, message, Program.AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
        Close();
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        closing = true;
        SavePosition();
        tray.Visible = false;
        tray.Dispose();
        showWait.Unregister(null);
        webView.Dispose(); // shuts the WebView2 browser processes down before the app exits
        if (server != null)
        {
            if (!server.HasExited) server.Kill();
            server.WaitForExit(); // also drains the redirected output
            server.Dispose();
        }
        job.Dispose();
        lock (this) if (log != null) { log.Dispose(); log = null; }
        base.OnFormClosed(e);
    }

    [StructLayout(LayoutKind.Sequential)]
    struct MARGINS { public int Left, Right, Top, Bottom; }

    const int WM_NCLBUTTONDOWN = 0xA1, HTCAPTION = 2;

    [DllImport("dwmapi.dll")]
    static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref MARGINS margins);

    [DllImport("user32.dll")]
    static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    static extern IntPtr SendMessage(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam);
}

/// <summary>Job object that terminates its processes when the app exits, even if it crashes.</summary>
sealed class KillOnCloseJob : IDisposable
{
    const int JobObjectExtendedLimitInformation = 9;
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;

    readonly IntPtr handle = CreateJobObject(IntPtr.Zero, null);

    public KillOnCloseJob()
    {
        var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        int size = Marshal.SizeOf(info);
        IntPtr ptr = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(info, ptr, false);
            SetInformationJobObject(handle, JobObjectExtendedLimitInformation, ptr, (uint)size);
        }
        finally
        {
            Marshal.FreeHGlobal(ptr);
        }
    }

    public void Add(Process process) { AssignProcessToJobObject(handle, process.Handle); }

    public void Dispose() { CloseHandle(handle); }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);

    [DllImport("kernel32.dll")]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);

    [DllImport("kernel32.dll")]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr handle);
}
