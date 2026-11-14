# electron/spotify/scripts/mediaSession.ps1
# Windows' media session, read and steered through the system's own WinRT projection. One PowerShell
# is kept running for a whole run of Folia: it reads one JSON command a line on its standard input and
# answers one JSON line, so a status read costs no process start.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$type) { $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    $command = $line | ConvertFrom-Json
    $session = $manager.GetSessions() | Where-Object { $_.SourceAppUserModelId -match 'Spotify' } | Select-Object -First 1
    if (-not $session) { [Console]::Out.WriteLine((@{ id = $command.id; ok = $false; error = 'no-session' } | ConvertTo-Json -Compress)); continue }
    $data = $null
    switch ($command.op) {
      'status' {
        $info = $session.GetPlaybackInfo(); $timeline = $session.GetTimelineProperties()
        $position = $timeline.Position.TotalMilliseconds
        if ($info.PlaybackStatus -eq 'Playing') { $position += ([DateTimeOffset]::Now - $timeline.LastUpdatedTime).TotalMilliseconds }
        $repeat = if ($null -ne $info.AutoRepeatMode) { [int]$info.AutoRepeatMode } else { -1 }
        $title = ''; $artist = ''
        try {
          $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
          if ($props) { $title = [string]$props.Title; $artist = [string]$props.Artist }
        } catch { }
        $data = @{ isPaused = ($info.PlaybackStatus -ne 'Playing'); positionMs = [Math]::Max(0, [Math]::Round($position)); durationMs = [Math]::Round($timeline.EndTime.TotalMilliseconds); repeat = $repeat; title = $title; artist = $artist }
      }
      'pause' { $data = Await ($session.TryPauseAsync()) ([bool]) }
      'resume' { $data = Await ($session.TryPlayAsync()) ([bool]) }
      'seek' { $data = Await ($session.TryChangePlaybackPositionAsync([long]($command.ms * 10000))) ([bool]) }
    }
    [Console]::Out.WriteLine((@{ id = $command.id; ok = $true; data = $data } | ConvertTo-Json -Compress))
  } catch {
    [Console]::Out.WriteLine((@{ id = $command.id; ok = $false; error = "$_" } | ConvertTo-Json -Compress))
  }
}
