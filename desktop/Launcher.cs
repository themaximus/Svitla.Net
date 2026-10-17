// Desktop app for the DTEK widget (Windows).
//
// Starts the bundled node.exe with server.js on the loopback interface, without a console window,
// and shows the page in the app's own window through WebView2, the browser engine that is part of
// Windows. Browser data lives in %LOCALAPPDATA%\DTEK Widget, separate from the user's browsers.
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
    const int PageWidth = 420, PageHeight = 890;
    float dpiScale = 1;

    readonly string appDir = AppDomain.CurrentDomain.BaseDirectory;
    readonly string dataDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Program.AppName);

    readonly EventWaitHandle showEvent;
    readonly RegisteredWaitHandle showWait;
    readonly KillOnCloseJob job = new KillOnCloseJob();
    readonly WebView2 webView = new WebView2();
    StreamWriter log;
    Process server;
    bool closing;

    public int ExitCode { get; private set; }

    public WidgetForm(EventWaitHandle showEvent)
    {
        Text = Program.AppName;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        BackColor = Color.FromArgb(13, 31, 24); // the widget's background, shown until the page paints
        FitToPage();
        StartPosition = FormStartPosition.CenterScreen;

        webView.Dock = DockStyle.Fill;
        webView.DefaultBackgroundColor = BackColor;
        Controls.Add(webView);

        this.showEvent = showEvent;
        showWait = ThreadPool.RegisterWaitForSingleObject(showEvent,
            (state, timedOut) => BeginInvoke(new Action(RestoreAndActivate)), null, Timeout.Infinite, false);
    }

    // The whole page (header, widget, footer) is 420 x 885 CSS pixels
    void FitToPage()
    {
        using (var g = CreateGraphics()) dpiScale = g.DpiX / 96f;
        ClientSize = new Size((int)(PageWidth * dpiScale), (int)(PageHeight * dpiScale));
        MinimumSize = new Size((int)(320 * dpiScale), (int)(400 * dpiScale));
        Rectangle screen = Screen.FromControl(this).WorkingArea;
        if (Height > screen.Height) Height = screen.Height;
    }

    // A window shorter than the page (small screen, user resize) shows the page scaled down, not cut off
    void ZoomToFit()
    {
        if (webView.CoreWebView2 == null) return;
        double fit = Math.Min(ClientSize.Width / (PageWidth * dpiScale), ClientSize.Height / (PageHeight * dpiScale));
        webView.ZoomFactor = Math.Max(0.5, Math.Min(1.0, fit));
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        if (WindowState != FormWindowState.Minimized) ZoomToFit();
    }

    void RestoreAndActivate()
    {
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
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
        webView.CoreWebView2.Navigate(Url);
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
