# electron/spotify/scripts/windowSweep.ps1
# The fallback for a start whose watcher did not run: the main window of a Spotify that was not there
# before the start is hidden without activation (SW_HIDE). It leaves the taskbar, the Spotify tray
# icon restores it, and nothing is closed. A window already in the tray has no handle (MainWindowHandle
# is 0 for a hidden window) and is left alone, and so is a Spotify that was there before this start.
#
# SkipPids names the PIDs that were already running, comma separated.
param(
    [string] $SkipPids = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -Namespace Folia -Name SpotifyWin -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);'
$skip = @($SkipPids -split ',' | Where-Object { $_ -ne '' } | ForEach-Object { [int] $_ })
foreach ($p in Get-Process -Name Spotify -ErrorAction SilentlyContinue) {
  if ($skip -contains $p.Id) { continue }
  if ($p.MainWindowHandle -ne [System.IntPtr]::Zero) { [Folia.SpotifyWin]::ShowWindow($p.MainWindowHandle, 0) | Out-Null }
}
