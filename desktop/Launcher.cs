// Desktop launcher for the DTEK widget (Windows).
//
// Starts the bundled node.exe with server.js on the loopback interface, without a console window,
// and opens the widget as a standalone Microsoft Edge app window with its own profile in
// %LOCALAPPDATA%\DTEK Widget. When that window is closed, the server is stopped as well.
// The server process is attached to a kill-on-close job object, so it never outlives the launcher.
// Extra command-line arguments are passed on to Edge (for example --headless=new for a smoke test).
//
// Built by desktop\build.ps1 with the C# compiler that ships with .NET Framework 4.

using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class Launcher
{
    const string AppName = "DTEK Widget";
    const string MutexName = "DTEKWidgetLauncher"; // also the AppMutex of the installer
    // Fixed port: the settings are kept in localStorage, which is tied to the page origin
    const int Port = 47381;

    static string Url { get { return "http://127.0.0.1:" + Port + "/"; } }

    [STAThread]
    static int Main()
    {
        string appDir = AppDomain.CurrentDomain.BaseDirectory;
        string dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), AppName);
        string profileDir = Path.Combine(dataDir, "WebView");
        Directory.CreateDirectory(dataDir);

        string browser = FindEdge();
        if (browser == null)
        {
            Fail("Microsoft Edge is not installed. It is required to show the widget window.");
            return 1;
        }

        bool firstInstance;
        using (var mutex = new Mutex(true, MutexName, out firstInstance))
        {
            if (!firstInstance)
            {
                // The first launcher owns the server; an extra window just joins its Edge instance
                OpenWindow(browser, profileDir).Dispose();
                return 0;
            }

            using (var job = new KillOnCloseJob())
            using (var server = StartServer(appDir, dataDir))
            {
                if (server == null) return 1;
                job.Add(server);

                if (!WaitForServer(server))
                {
                    Fail("The widget server did not start. See " + Path.Combine(dataDir, "server.log"));
                    return 1;
                }

                using (var window = OpenWindow(browser, profileDir))
                {
                    // Edge keeps the first process of a profile alive until its last window is closed
                    window.WaitForExit();
                }

                if (!server.HasExited) server.Kill();
            }
        }
        return 0;
    }

    static Process StartServer(string appDir, string dataDir)
    {
        string node = Path.Combine(appDir, "node", "node.exe");
        string script = Path.Combine(appDir, "app", "server.js");
        if (!File.Exists(node) || !File.Exists(script))
        {
            Fail("The installation is damaged: " + (File.Exists(node) ? script : node) + " is missing.");
            return null;
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

        // Overwritten on every start, so the log cannot grow without bound
        var log = new StreamWriter(Path.Combine(dataDir, "server.log"), false) { AutoFlush = true };
        var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
        DataReceivedEventHandler write = (s, e) => { if (e.Data != null) lock (log) log.WriteLine(e.Data); };
        process.OutputDataReceived += write;
        process.ErrorDataReceived += write;
        process.Exited += (s, e) => { process.WaitForExit(); lock (log) log.Dispose(); };

        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        return process;
    }

    static bool WaitForServer(Process server)
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

    static Process OpenWindow(string browser, string profileDir)
    {
        string args = string.Join(" ", new[]
        {
            "--app=" + Url,
            "--user-data-dir=\"" + profileDir + "\"",
            "--window-size=460,820",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-mode",
        }.Concat(Environment.GetCommandLineArgs().Skip(1).Select(a => "\"" + a + "\"")));
        return Process.Start(new ProcessStartInfo(browser, args) { UseShellExecute = false });
    }

    static string FindEdge()
    {
        const string key = @"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe";
        foreach (var hive in new[] { Registry.CurrentUser, Registry.LocalMachine })
        {
            using (var k = hive.OpenSubKey(key))
            {
                var path = k == null ? null : k.GetValue(null) as string;
                if (!string.IsNullOrEmpty(path) && File.Exists(path)) return path;
            }
        }
        return null;
    }

    static void Fail(string message)
    {
        MessageBox.Show(message, AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    /// <summary>Job object that terminates its processes when the launcher exits, even if it crashes.</summary>
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
}
