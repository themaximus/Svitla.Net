// "Find my group by address": opens the DTEK region's own shutdowns page in a normal window of the
// app. The user looks their address up in the site's form, as on the site; the site answers that
// lookup (method getHomeNum) with the house's outage group in "sub_type_reason", e.g. "GPV27.1".
// A small script in the page reads that answer and hands the group to the widget.
//
// Kyiv city publishes groups 1.1 ... 60.1 and shows them nowhere, so this is how its residents
// learn their group. The window shows the site as it is, bot checks included.

using System;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

sealed class AddressLookupForm : Form
{
    // Runs in every page of the window; reports {street, house, groups} once a house is chosen
    const string CaptureScript = @"(function () {
  if (!/^(www\.)?dtek-[a-z]+\.com\.ua$/.test(location.hostname) || !window.chrome || !window.chrome.webview) return;
  var houses = null; // the latest getHomeNum answer: house -> { sub_type_reason: [...] }

  function groupsOf(reason) {
    var found = [];
    (Array.isArray(reason) ? reason : String(reason || '').split(/[,;\s]+/)).forEach(function (item) {
      var m = String(item).match(/(\d+\.\d+)/);
      if (m && found.indexOf('GPV' + m[1]) < 0) found.push('GPV' + m[1]);
    });
    return found;
  }

  function report() {
    var house = document.getElementById('house_num'), street = document.getElementById('street');
    if (!houses || !house || !house.value || !houses[house.value]) return;
    var groups = groupsOf(houses[house.value].sub_type_reason);
    if (groups.length) window.chrome.webview.postMessage(JSON.stringify({ street: street ? street.value : '', house: house.value, groups: groups }));
  }

  var send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    if (typeof body === 'string' && body.indexOf('getHomeNum') >= 0) {
      this.addEventListener('load', function () {
        try { var answer = JSON.parse(this.responseText); if (answer && answer.data) { houses = answer.data; setTimeout(report, 300); } } catch (e) {}
      });
    }
    return send.apply(this, arguments);
  };
  document.addEventListener('change', function (e) { if (e.target && e.target.id === 'house_num') setTimeout(report, 300); }, true);
  document.addEventListener('click', function () { setTimeout(report, 500); }, true);
})();";

    readonly CoreWebView2Environment environment;
    readonly string regionUrl;
    readonly Action<string> onFound;
    readonly WebView2 webView = new WebView2();

    /// <param name="onFound">Gets the JSON {street, house, groups} for the chosen house.</param>
    public AddressLookupForm(CoreWebView2Environment environment, string regionUrl, Icon icon, float dpiScale, bool english,
                             Action<string> onFound)
    {
        this.environment = environment;
        this.regionUrl = regionUrl;
        this.onFound = onFound;

        Text = english ? "Find your group by address - DTEK" : "Пошук черги за адресою - ДТЕК";
        Icon = icon;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size((int)(1000 * dpiScale), (int)(820 * dpiScale));
        Rectangle screen = Screen.PrimaryScreen.WorkingArea;
        if (Height > screen.Height) Height = screen.Height;
        if (Width > screen.Width) Width = screen.Width;

        webView.Dock = DockStyle.Fill;
        Controls.Add(webView);
    }

    /// <summary>Only the DTEK regional sites the widget knows; the server checks the same list.</summary>
    public static bool IsDtekPage(string url)
    {
        Uri uri;
        return Uri.TryCreate(url, UriKind.Absolute, out uri) && uri.Scheme == Uri.UriSchemeHttps &&
               System.Text.RegularExpressions.Regex.IsMatch(uri.Host, @"^(www\.)?dtek-[a-z]+\.com\.ua$");
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        await webView.EnsureCoreWebView2Async(environment);
        CoreWebView2 core = webView.CoreWebView2;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;

        // Stay on the DTEK site; anything else (social links, apps) opens in the user's browser
        core.NewWindowRequested += (s, a) => { a.Handled = true; OpenExternal(a.Uri); };
        core.NavigationStarting += (s, a) =>
        {
            if (!IsDtekPage(a.Uri)) { a.Cancel = true; OpenExternal(a.Uri); }
        };
        core.WebMessageReceived += (s, a) =>
        {
            string message;
            try { message = a.TryGetWebMessageAsString(); }
            catch (ArgumentException) { return; }
            onFound(message);
            Close();
        };

        await core.AddScriptToExecuteOnDocumentCreatedAsync(CaptureScript);
        core.Navigate(regionUrl);
    }

    static void OpenExternal(string uri)
    {
        if (uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ||
            uri.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
        {
            Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true });
        }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        webView.Dispose();
        base.OnFormClosed(e);
    }
}
