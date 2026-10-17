; Inno Setup script for the DTEK widget. Built by desktop\build.ps1, which passes
; AppVersion, StageDir (prepared app, node runtime and launcher) and IconFile.
;
; Per-user install into %LOCALAPPDATA%\Programs\DTEK Widget, no administrator rights needed.
; The uninstaller removes exactly what this app puts on the machine: the install folder,
; its data folder %LOCALAPPDATA%\DTEK Widget (WebView2 browser data, server log), its shortcuts,
; its autostart value and its own uninstall entry.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef StageDir
  #define StageDir "..\build\stage"
#endif
#ifndef IconFile
  #define IconFile "..\build\app.ico"
#endif

#define AppName "DTEK Widget"
#define AppExe "DTEK Widget.exe"

[Setup]
AppId={{5E2567F6-BD90-4525-8016-2407BEEFE04A}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Maksym Herashchenko
AppPublisherURL=https://github.com/themaximus/DTEK-Wiget
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
; The launcher holds this mutex while it runs, so setup and uninstall ask to close the widget first
AppMutex=DTEKWidgetLauncher
OutputBaseFilename=DTEK-Widget-Setup-{#AppVersion}
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "ukrainian"; MessagesFile: "compiler:Languages\Ukrainian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[CustomMessages]
ukrainian.AutoStart=Запускати разом з Windows
english.AutoStart=Start with Windows
russian.AutoStart=Запускать вместе с Windows

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "autostart"; Description: "{cm:AutoStart}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Registry]
; Only our own value under Run; removed on uninstall, the key itself is left alone
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "{#AppName}"; \
  ValueData: """{app}\{#AppExe}"""; Tasks: autostart; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: none; ValueName: "{#AppName}"; \
  Tasks: not autostart; Flags: deletevalue

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[InstallDelete]
; Leftovers of a previous version's dependencies must not mix with the new ones
Type: filesandordirs; Name: "{app}\app\node_modules"

[UninstallDelete]
; Created at run time by the app and its WebView2 window, not by setup
Type: filesandordirs; Name: "{localappdata}\{#AppName}"
Type: dirifempty; Name: "{app}"

[Code]
const
  ShellKey = 'Software\Microsoft\Windows\CurrentVersion';
  TileStore = ShellKey + '\CloudStore\Store\DefaultAccount\';
  TileList = '\{302ebfff-2240-4552-9bf8-e4e61f5f4ac2}$windows.data.apps.appleveltileinfo$appleveltilelist' +
    '\windows.data.apps.appleveltileinfo$w~';

{ Explorer keeps Start menu and jump list bookkeeping for every launched program, keyed by the
  exe path. Only the entries named after our own exe are removed; Windows rebuilds them on demand. }
procedure RemoveShellTraces;
var
  Exe, TileId: String;
begin
  Exe := ExpandConstant('{app}\{#AppExe}');
  RegDeleteValue(HKEY_CURRENT_USER, ShellKey + '\Search\JumplistData', Exe);
  RegDeleteKeyIncludingSubkeys(HKEY_CURRENT_USER, ShellKey + '\Start\TileProperties\W~' + ExpandConstant('{app}'));

  TileId := Lowercase(Exe);
  StringChangeEx(TileId, ':', '', True);
  StringChangeEx(TileId, '\', '', True);
  { The local copy and its cloud-sync mirror }
  RegDeleteKeyIncludingSubkeys(HKEY_CURRENT_USER, TileStore + 'Current' + TileList + TileId);
  RegDeleteKeyIncludingSubkeys(HKEY_CURRENT_USER, TileStore + 'Cloud' + TileList + TileId);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
    RemoveShellTraces;
end;