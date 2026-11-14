# electron/ytm/scripts/listProcesses.ps1
# The processes whose command line names the browser profile folder Folia made for a sign-in, one a
# line as "<id> <command line>". The folder is read from FOLIA_SIGN_IN_FOLDER rather than from a
# parameter: a folder that holds a space then needs no quoting anywhere, and no part of a path is
# ever part of a command line.
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:FOLIA_SIGN_IN_FOLDER) } | ForEach-Object { [string]$_.ProcessId + [char]32 + $_.CommandLine }
