# Світла.Нєт (Svitla.Net)

[English version below](#english)

Віджет графіків відключень світла ДТЕК. Показує, чи є світло зараз, графік вашої черги на сьогодні й завтра та екстрені відключення. Працює на робочому столі Windows, на Android і в браузері.

## Що вміє

- **Шість регіонів:** Київ (місто), Київська область, Дніпро та область (ДТЕК і ЦЕК), Одеська та Донецька області.
- **Кілька джерел даних.** Сторінки ДТЕК, публічний API YASNO та [outage-data-ua](https://github.com/Baskerville42/outage-data-ua) (копія тих самих даних зі сторінок ДТЕК) як резерв. Береться перше джерело, де є графік на сьогодні. Якщо в нього ще немає завтрашнього дня, завтра добирається з наступного джерела.
- **Лише сьогодні й завтра за київським часом.** Джерело, яке перестало оновлюватися, ніколи не видасть старий день за сьогоднішній.
- **Екстрені відключення.** Коли Укренерго вводить екстрені відключення, графіки не діють, і віджет показує повідомлення ДТЕК замість годин.
- **Черги з графіка регіону.** Список черг береться з самого графіка, тому для Києва доступні всі черги, від 1.1 до 60.1.
- **Час оновлення від ДТЕК** і підсвічена поточна година; на початку кожної години віджет оновлюється сам.

## Платформи

### Windows

Безрамкове прозоре вікно на робочому столі. Під капотом той самий веб-віджет у WebView2 (рушій браузера, вбудований у Windows) і локальний сервер на Node.js, який запускає лаунчер на C#.

- **Іконка в треї:** зелена блискавка, коли світло є, сіра закреслена, коли немає. Меню показує, що буде далі, з відліком часу («вимкнуть о 17:00, через 1:23:45»).
- **Пошук черги за адресою.** Місто, вулиця й будинок обираються з підказками просто у віджеті. Застосунок питає сайт ДТЕК, відкритий у невидимому вікні браузера, його ж формою пошуку адреси. Для Києва це єдиний спосіб дізнатися свою чергу.
- **Поточне відключення за збереженою адресою.** Якщо ДТЕК повідомляє, що там зараз немає світла, віджет і трей показують причину й орієнтовний час повернення, поверх графіка.
- Віджет можна перетягувати й закріпити на місці, вимкнути прозорість, запускати разом з Windows.
- Інсталятор не потребує прав адміністратора і не потребує встановленого Node.js. Деінсталятор прибирає все, що застосунок створив.

> Поки що Windows-версія встановлюється під старою назвою «Світик Widget» (`Svitik-Widget-Setup-<версія>.exe`).

### Android

Нативний застосунок на Kotlin. Сервер йому не потрібен: графік завантажується напряму з YASNO та outage-data-ua.

- **Три віджети для головного екрана:** «Статус» 2×1 (чи є світло і коли це зміниться), «Смуга дня» 4×1, «Графік дня» 4×3 (усі 24 години).
- **Оновлення у фоні кожні 30 хвилин,** а віджети перемальовуються в момент зміни стану. Якщо Android обмежує застосунку роботу у фоні, він підкаже, де це вимкнути.
- **Сповіщення про екстрені відключення.** Останній відомий графік показується приглушеним під плашкою «графіки не діють».
- Регіони: Київ, Київська область, Дніпро (ДТЕК і ЦЕК), Одеська область. Android 8.0 і новіші.

### Браузер

Той самий віджет як веб-сторінка, сервер на Node.js / Express. Українська та англійська мови, прозорість, налаштування зберігаються в браузері.

## Запуск

### Веб-версія

Потрібен [Node.js](https://nodejs.org/).

```bash
npm install
npm start
```

Відкрийте `http://localhost:3001`.

### Інсталятор для Windows

Потрібні Node.js (його `node.exe` вкладається в інсталятор) та Inno Setup 6 (`winget install JRSoftware.InnoSetup`). Лаунчер компілюється компілятором C# з .NET Framework 4, який уже є у Windows.

```bash
powershell -ExecutionPolicy Bypass -File desktop\build.ps1
```

Результат: `build\Svitik-Widget-Setup-<версія>.exe`. Застосунок встановлюється в `%LOCALAPPDATA%\Programs\Svitik Widget`, сервер працює на `127.0.0.1:47381` без вікна консолі, дані браузера, положення вікна й журнал сервера лежать у `%LOCALAPPDATA%\Svitik Widget`.

### Android

Відкрийте папку `android` в Android Studio і зберіть APK (`Build → Build APK(s)`). Без власного ключа release-збірка підписується debug-ключем.

## Структура

| Шлях | Що там |
|---|---|
| `server.js` | Сервер: роздає сторінку, `/api/regions` та `/api/schedule` з кешем на хвилину |
| `schedules.js` | Регіони, джерела даних і зведення їх до одного формату |
| `main.js`, `style.css`, `index.html` | Сам віджет |
| `desktop/` | Windows: лаунчер (`Launcher.cs`), трей (`PowerTray.cs`), пошук за адресою (`DtekSiteAgent.cs`), збірка й інсталятор |
| `android/` | Android-застосунок і віджети |

## Автор

Максим Геращенко · [@etojemaximus](https://t.me/etojemaximus)

---

<a name="english"></a>

# Світла.Нєт (Svitla.Net)

A DTEK power outage schedule widget. It shows whether the power is on right now, your group's schedule for today and tomorrow, and emergency outages. It runs on the Windows desktop, on Android and in the browser.

## Features

- **Six regions:** Kyiv city, Kyiv region, Dnipro and region (DTEK and CEC), Odesa and Donetsk regions.
- **Several data sources.** DTEK's own pages, YASNO's public API and [outage-data-ua](https://github.com/Baskerville42/outage-data-ua) (a copy of the same data from the DTEK pages) as a fallback. The first source with today's schedule wins; if it has no tomorrow yet, tomorrow is taken from the next source.
- **Only today and tomorrow, Kyiv time.** A source that stopped updating never passes an old day off as today.
- **Emergency outages.** When Ukrenergo orders emergency outages, the schedules do not apply, and the widget shows DTEK's notice instead of the hours.
- **Groups from the region's schedule.** The group list comes from the schedule itself, so Kyiv gets all of its groups, 1.1 to 60.1.
- **DTEK's update time** and the current hour highlighted; the widget refreshes itself on the hour.

## Platforms

### Windows

A frameless transparent window on the desktop. Inside it is the same web widget in WebView2 (the browser engine built into Windows) and a local Node.js server started by a C# launcher.

- **Tray icon:** a green lightning bolt while there is power, a grey crossed-out one while there is none. Its menu says what happens next, with a countdown ("power off at 17:00, in 1:23:45").
- **Group lookup by address.** Town, street and house are picked with suggestions right in the widget. The app asks the DTEK site, kept open in an invisible browser window, with the site's own address lookup. For Kyiv this is the only way to learn your group.
- **Current outage at the saved address.** When DTEK reports no power there right now, the widget and the tray show the reason and the expected return time, ahead of the schedule.
- The widget can be dragged and pinned in place, its transparency switched off, and it can start with Windows.
- The installer needs no admin rights and no installed Node.js. The uninstaller removes everything the app created.

> For now the Windows version installs under its former name, "Світик Widget" (`Svitik-Widget-Setup-<version>.exe`).

### Android

A native Kotlin app. It needs no server: the schedule is downloaded straight from YASNO and outage-data-ua.

- **Three home screen widgets:** "Status" 2×1 (is the power on and when that changes), "Day strip" 4×1, "Day schedule" 4×3 (all 24 hours).
- **Background updates every 30 minutes,** and the widgets redraw at the moment the power state changes. If Android restricts the app's background work, the app says where to turn that off.
- **Emergency outage notifications.** The last known schedule is shown dimmed under a "schedules do not apply" plaque.
- Regions: Kyiv city, Kyiv region, Dnipro (DTEK and CEC), Odesa region. Android 8.0 and newer.

### Browser

The same widget as a web page, with a Node.js / Express server. Ukrainian and English, transparency, settings kept in the browser.

## Running it

### Web version

Needs [Node.js](https://nodejs.org/).

```bash
npm install
npm start
```

Open `http://localhost:3001`.

### Windows installer

Needs Node.js (its `node.exe` is bundled into the installer) and Inno Setup 6 (`winget install JRSoftware.InnoSetup`). The launcher is compiled with the C# compiler of .NET Framework 4, which is part of Windows.

```bash
powershell -ExecutionPolicy Bypass -File desktop\build.ps1
```

Output: `build\Svitik-Widget-Setup-<version>.exe`. The app installs to `%LOCALAPPDATA%\Programs\Svitik Widget` and runs its server on `127.0.0.1:47381` without a console window; browser data, the window position and the server log live in `%LOCALAPPDATA%\Svitik Widget`.

### Android

Open the `android` folder in Android Studio and build an APK (`Build → Build APK(s)`). Without a release key of your own, the release build is signed with the debug key.

## Layout

| Path | What is there |
|---|---|
| `server.js` | Server: serves the page, `/api/regions` and `/api/schedule` with a one-minute cache |
| `schedules.js` | Regions, data sources and turning them into one format |
| `main.js`, `style.css`, `index.html` | The widget itself |
| `desktop/` | Windows: launcher (`Launcher.cs`), tray (`PowerTray.cs`), address lookup (`DtekSiteAgent.cs`), build and installer |
| `android/` | The Android app and widgets |

## Author

Maksym Herashchenko · [@etojemaximus](https://t.me/etojemaximus)
