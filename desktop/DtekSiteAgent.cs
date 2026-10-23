// Group lookup by address, entirely inside the widget: the region's DTEK shutdowns page is loaded
// in an invisible WebView2 hosted by the widget window, and a small script on that page answers the
// widget's questions with the site's own lookups (getStreets, getHomeNum - what the site's address
// form uses). The answer for a house names its outage group in "sub_type_reason", e.g. "GPV19.1".
//
// Kyiv city publishes groups 1.1 ... 60.1 and shows them nowhere, so this is how its residents
// learn their group. No browser window is ever shown; if the site does not let the page load
// (bot protection), the lookup just reports an error.
//
// Protocol (JSON, relayed by the app; "id" pairs answers with requests):
//   widget -> site  {id, op: "streets"}                         -> {id, ok, cities: bool}
//                   {id, op: "suggest", kind: "city"|"street", city, query} -> {id, ok, items: [...]}
//                   {id, op: "houses", city, street}           -> {id, ok, houses: {"36": ["GPV19.1"]}}
//                   {id, op: "house", city, street, house}     -> {id, ok, found, groups, updated,
//                                                                  outage: {type, reason, start, end} | null}
//   errors: {id, ok: false, error: "unavailable"|"failed"}

using System;
using System.Drawing;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

sealed class DtekSiteAgent : IDisposable
{
    const string AgentScript = @"(function () {
  if (!/^(www\.)?dtek-[a-z]+\.com\.ua$/.test(location.hostname) || !window.chrome || !window.chrome.webview) return;
  var streets = null; // promise of [street] for a city region, {city: [street]} for an oblast

  function reply(message) { window.chrome.webview.postMessage(JSON.stringify(message)); }

  // The page is usable once jQuery and the site's ajax URL are there (not on a bot check page)
  function ready() {
    return new Promise(function (resolve, reject) {
      var started = Date.now();
      (function check() {
        if (window.jQuery && document.querySelector('meta[name=ajaxUrl]')) resolve();
        else if (Date.now() - started > 20000) reject('unavailable');
        else setTimeout(check, 200);
      })();
    });
  }

  function post(body) {
    return new Promise(function (resolve, reject) {
      jQuery.post(document.querySelector('meta[name=ajaxUrl]').content, body, function (answer) {
        answer && answer.result ? resolve(answer) : reject('failed');
      }, 'JSON').fail(function () { reject('failed'); });
    });
  }

  // One shared request; the site's very first answer after a fresh load sometimes fails, so it is
  // tried a second time a moment later
  function loadStreets() {
    if (!streets) {
      var get = function () { return post({ method: 'getStreets' }); };
      streets = get().catch(function () {
        return new Promise(function (resolve) { setTimeout(resolve, 1500); }).then(get);
      }).then(function (a) { return a.streets; }, function (error) { streets = null; throw error; });
    }
    return streets;
  }

  // Best matches first, at most 30: the name itself starts with the typed text ('вул. Хрещатик'
  // for 'хрещ'), then a word in it does ('Набережно-Хрещатицька'), then it just contains it
  function suggest(list, query) {
    var q = String(query || '').trim().toLowerCase(), ranked = [[], [], []];
    list.forEach(function (name) {
      var lower = name.toLowerCase(), at = lower.indexOf(q);
      if (at < 0) return;
      var bare = lower.replace(/^(\S+\.\s+)+/, ''); // without 'вул. ', 'м. ', 'с. ' ...
      ranked[bare.indexOf(q) === 0 ? 0 : at === 0 || /[\s.\-']/.test(lower.charAt(at - 1)) ? 1 : 2].push(name);
    });
    return ranked[0].concat(ranked[1], ranked[2]).slice(0, 30);
  }

  function groupsOf(reason) {
    var found = [];
    (Array.isArray(reason) ? reason : String(reason || '').split(/[,;\s]+/)).forEach(function (item) {
      var m = String(item).match(/(\d+\.\d+)/);
      if (m && found.indexOf('GPV' + m[1]) < 0) found.push('GPV' + m[1]);
    });
    return found;
  }

  // All houses of a street with their groups and current outages, as the site's form asks for them
  function streetHouses(request) {
    var data = [];
    if (request.city) data.push({ name: 'city', value: request.city });
    data.push({ name: 'street', value: request.street }, { name: 'house_num', value: '' });
    return post({ method: 'getHomeNum', data: data });
  }

  function handle(request) {
    if (request.op === 'streets') {
      return loadStreets().then(function (s) { return { cities: !Array.isArray(s) }; });
    }
    if (request.op === 'suggest') {
      return loadStreets().then(function (s) {
        var list = request.kind === 'city' ? (Array.isArray(s) ? [] : Object.keys(s))
                 : Array.isArray(s) ? s : (s[request.city] || []);
        return { items: suggest(list, request.query) };
      });
    }
    if (request.op === 'houses') {
      return streetHouses(request).then(function (a) {
        var houses = {};
        Object.keys(a.data || {}).forEach(function (house) { houses[house] = groupsOf(a.data[house] && a.data[house].sub_type_reason); });
        return { houses: houses };
      });
    }
    if (request.op === 'house') {
      // What the site's yellow box says: no power now (type '1' planned repairs, '2' reason in
      // sub_type), since start_date, estimated until end_date ('17:12 17.10.2026')
      return streetHouses(request).then(function (a) {
        var entry = a.data && a.data[request.house];
        if (!entry) return { found: false, outage: null };
        var out = entry.sub_type || entry.start_date || entry.end_date;
        return {
          found: true, groups: groupsOf(entry.sub_type_reason), updated: a.updateTimestamp || null,
          outage: out ? { type: String(entry.type || ''), reason: entry.sub_type || '', start: entry.start_date || '', end: entry.end_date || '' } : null,
        };
      });
    }
    return Promise.reject('failed');
  }

  window.chrome.webview.addEventListener('message', function (e) {
    var request;
    try { request = JSON.parse(e.data); } catch (err) { return; }
    ready().then(function () { return handle(request); }).then(function (result) {
      result.id = request.id; result.ok = true; reply(result);
    }, function (error) {
      reply({ id: request.id, ok: false, error: typeof error === 'string' ? error : 'failed' });
    });
  });
})();";

    readonly Control host;
    readonly CoreWebView2Environment environment;
    readonly Action<string> answer;
    readonly Action<string> log;
    CoreWebView2Controller controller;
    Task setup;
    Task<bool> pageLoaded;
    string loadedRegion;

    /// <param name="host">Window that hosts the invisible browser.</param>
    /// <param name="answer">Gets each JSON answer of the page, on the UI thread.</param>
    /// <param name="log">Writes a line to the app's log.</param>
    public DtekSiteAgent(Control host, CoreWebView2Environment environment, Action<string> answer, Action<string> log)
    {
        this.host = host;
        this.log = log;
        this.environment = environment;
        this.answer = answer;
    }

    /// <summary>Only the DTEK regional sites; the widget sends one of the regions it knows.</summary>
    public static bool IsDtekPage(string url)
    {
        Uri uri;
        return Uri.TryCreate(url, UriKind.Absolute, out uri) && uri.Scheme == Uri.UriSchemeHttps &&
               Regex.IsMatch(uri.Host, @"^(www\.)?dtek-[a-z]+\.com\.ua$");
    }

    /// <summary>Passes a request (JSON, see the protocol above) to the region's DTEK page.</summary>
    public async void Request(string regionUrl, string requestJson)
    {
        if (!IsDtekPage(regionUrl)) return;
        if (setup == null) setup = SetUp(); // requests can come in before the first one has set it up
        await setup;

        if (loadedRegion != regionUrl)
        {
            loadedRegion = regionUrl;
            pageLoaded = Navigate(regionUrl);
        }
        await pageLoaded;
        // The first load may go through the site's automatic browser check, which reloads the page;
        // a request posted to that interim page would be lost
        bool ready = await PageReady();
        log("[dtek] " + (ready ? "request " : "page not ready, request dropped ") + controller.CoreWebView2.Source + " " + requestJson);
        if (ready) controller.CoreWebView2.PostWebMessageAsString(requestJson);
        else answer(UnavailableAnswer(requestJson));
    }

    const string ReadyCheck = "!!(window.jQuery && document.querySelector('meta[name=ajaxUrl]'))";
    static readonly TimeSpan ReadyTimeout = TimeSpan.FromSeconds(30);

    async Task<bool> PageReady()
    {
        DateTime giveUp = DateTime.Now + ReadyTimeout;
        while (DateTime.Now < giveUp)
        {
            if (await controller.CoreWebView2.ExecuteScriptAsync(ReadyCheck) == "true") return true;
            await Task.Delay(300);
        }
        return false;
    }

    // {"id":5,...} -> {"id":5,"ok":false,"error":"unavailable"}
    static string UnavailableAnswer(string requestJson)
    {
        Match id = Regex.Match(requestJson, @"""id""\s*:\s*(\d+)");
        return "{\"id\":" + (id.Success ? id.Groups[1].Value : "0") + ",\"ok\":false,\"error\":\"unavailable\"}";
    }

    async Task SetUp()
    {
        controller = await environment.CreateCoreWebView2ControllerAsync(host.Handle);
        controller.IsVisible = false;
        controller.Bounds = Rectangle.Empty;
        CoreWebView2 core = controller.CoreWebView2;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreDefaultScriptDialogsEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.IsMuted = true;
        core.NewWindowRequested += (s, e) => e.Handled = true; // never opens anything
        core.NavigationStarting += (s, e) => { if (!IsDtekPage(e.Uri)) e.Cancel = true; };
        core.WebMessageReceived += (s, e) =>
        {
            try
            {
                string message = e.TryGetWebMessageAsString();
                log("[dtek] answer " + (message.Length > 100 ? message.Substring(0, 100) + "…" : message));
                answer(message);
            }
            catch (ArgumentException) { }
        };
        await core.AddScriptToExecuteOnDocumentCreatedAsync(AgentScript);
    }

    Task<bool> Navigate(string url)
    {
        var done = new TaskCompletionSource<bool>();
        EventHandler<CoreWebView2NavigationCompletedEventArgs> completed = null;
        completed = (s, e) =>
        {
            controller.CoreWebView2.NavigationCompleted -= completed;
            log("[dtek] loaded " + controller.CoreWebView2.Source + " " + (e.IsSuccess ? "ok" : e.WebErrorStatus.ToString()));
            done.TrySetResult(e.IsSuccess);
        };
        controller.CoreWebView2.NavigationCompleted += completed;
        controller.CoreWebView2.Navigate(url);
        return done.Task;
    }

    public void Dispose()
    {
        if (controller != null) controller.Close();
        controller = null;
    }
}
