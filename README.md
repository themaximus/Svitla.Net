# DTEK Outage Schedule Widget

Standalone web port of the DTEK outage schedule widget. 

## Features
- Fetches real-time schedules from DTEK servers.
- Bypasses CORS limitations using a local Express proxy.
- Multilingual support (Ukrainian & English).
- Persisted configuration (region, group, and visual appearance).
- Transparency toggle.

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the server:
   ```bash
   npm start
   ```

3. Open your browser and navigate to:
   ```
   http://localhost:3001
   ```

## Windows installer

`desktop\build.ps1` builds `build\DTEK-Widget-Setup-<version>.exe`. It needs Node.js
(its `node.exe` is bundled, so users do not need Node) and Inno Setup 6
(`winget install JRSoftware.InnoSetup`):

```bash
powershell -ExecutionPolicy Bypass -File desktop\build.ps1
```

The installed app (`%LOCALAPPDATA%\Programs\DTEK Widget`, no admin rights needed) runs the server
on `127.0.0.1:47381` without a console and shows the widget on the desktop as a frameless,
transparent window through WebView2, the browser engine built into Windows. Drag the widget to move
it; its settings can switch off transparency; the pin in its top bar locks its position.
Its settings can also find the outage group by address: the button opens the region's DTEK page,
the address is looked up in the site's own form and the group from the site's answer is filled in
(Kyiv city does not show group numbers anywhere else). The `–` button hides it to the tray, `✕` closes the app; the tray icon shows, hides or exits it.
Browser data, the window position and the server log live in `%LOCALAPPDATA%\DTEK Widget`.
Setup offers a desktop shortcut and, optionally, start with Windows.
The uninstaller removes the install folder, the data folder, shortcuts and the autostart entry.

## Author
Maksym Herashchenko
