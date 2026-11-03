param(
    [Parameter(Mandatory = $true)][string]$Action,
    [int]$RootPid = 0,
    [int]$TargetPid = 0,
    [string]$Pids = '',
    [string]$Mask = '',
    [string]$Cores = '',
    [int]$RunnerPid = 0,
    [string]$ShellPath = ''
)

# dev/perf/win.ps1
# The parts of the perf rig that only Windows itself can answer. dev/perf/rig.mjs calls it; every
# action prints JSON on standard output and nothing else.
#
#   -Action topology                     the efficiency class and the affinity mask of every core
#                                        (which logical processors are the slow "E" cores)
#   -Action tree -RootPid <pid>          a process and everything it started: pid, kind, affinity mask
#   -Action memory -RootPid <pid>        the same list with each process's private bytes and peak
#                                        working set, and its dedicated and shared video memory (one
#                                        reading of the "GPU Process Memory" counters). Used by
#                                        dev/perf/app, which measures the whole app.
#   -Action sample [-Pids <a,b,c>] [-Cores <16,17>] [-Mask <hex>] [-RunnerPid <pid>]
#                                        one line a second until it is stopped: the 3D-engine use and
#                                        the dedicated video memory of those processes (Windows' own
#                                        "GPU Engine" and "GPU Process Memory" counters) and of all
#                                        other processes together, the listed processes' working sets
#                                        and CPU use, the whole machine's CPU use and the use of the
#                                        listed processors. -Mask holds the sampler itself to those
#                                        processors, so it stays off the ones being measured. Without
#                                        -Pids everything counts as "other" (the check before a baseline).
#                                        With -RunnerPid it ends by itself once that process is gone.
#   -Action strays -ShellPath <file>     stops every electron.exe whose command line names that main
#                                        script (the engines an earlier, killed run left behind) and
#                                        prints the process ids it stopped
#   -Action awake -RunnerPid <pid>       tells Windows every two seconds that the screen and the PC
#                                        are in use, until that process is gone; prints one line
#                                        after the first time. It turns on a screen that had gone
#                                        off and keeps it from going off.
#
# The affinity masks are 64 bits wide: a PC with more than 64 logical processors (more than one
# processor group) is not supported.
#
# The counter names are the English ones. On a Windows whose display language is not English they
# may not resolve; the sampler then gives no lines and the runner says so.

$ErrorActionPreference = 'Stop'

function Write-Line([object]$value) {
    [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 6))
    [Console]::Out.Flush()
}

function Get-Kind([string]$commandLine) {
    if ($commandLine -match '--utility-sub-type=([\w.]+)') { return $Matches[1] }
    if ($commandLine -match '--type=([\w-]+)') { return $Matches[1] }
    return 'browser'
}

if ($Action -eq 'topology') {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class PerfCpuTopology {
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetLogicalProcessorInformationEx(int relationship, IntPtr buffer, ref uint length);
    // One "efficiencyClass:hexMask;" per physical core (RelationProcessorCore = 0).
    public static string Cores() {
        uint length = 0;
        GetLogicalProcessorInformationEx(0, IntPtr.Zero, ref length);
        IntPtr buffer = Marshal.AllocHGlobal((int)length);
        try {
            if (!GetLogicalProcessorInformationEx(0, buffer, ref length)) return "";
            StringBuilder text = new StringBuilder();
            int offset = 0;
            while (offset < length) {
                int size = Marshal.ReadInt32(buffer, offset + 4);
                byte efficiencyClass = Marshal.ReadByte(buffer, offset + 9);
                long mask = Marshal.ReadInt64(buffer, offset + 32);
                text.Append(efficiencyClass).Append(':').Append(mask.ToString("X")).Append(';');
                offset += size;
            }
            return text.ToString();
        } finally {
            Marshal.FreeHGlobal(buffer);
        }
    }
}
'@
    $coreList = @()
    foreach ($part in ([PerfCpuTopology]::Cores()).Split(';')) {
        if (-not $part) { continue }
        $pair = $part.Split(':')
        $coreList += [pscustomobject]@{ efficiencyClass = [int]$pair[0]; mask = $pair[1] }
    }
    $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
    $memory = Get-CimInstance Win32_ComputerSystem
    $video = Get-CimInstance Win32_VideoController | Select-Object -First 1
    Write-Line ([pscustomobject]@{
        name = $cpu.Name.Trim()
        logicalProcessors = [Environment]::ProcessorCount
        memoryGb = [math]::Round($memory.TotalPhysicalMemory / 1GB)
        videoCard = $video.Name
        screen = "$($video.CurrentHorizontalResolution)x$($video.CurrentVerticalResolution) @ $($video.CurrentRefreshRate) Hz"
        refreshRate = [int]$video.CurrentRefreshRate
        cores = @($coreList)
    })
    exit 0
}

if ($Action -eq 'tree' -or $Action -eq 'memory') {
    $all = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, CommandLine
    $children = @{}
    foreach ($process in $all) {
        $parent = [int]$process.ParentProcessId
        if (-not $children.ContainsKey($parent)) { $children[$parent] = New-Object System.Collections.ArrayList }
        [void]$children[$parent].Add($process)
    }
    $found = New-Object System.Collections.ArrayList
    $queue = New-Object System.Collections.Queue
    $root = $all | Where-Object { $_.ProcessId -eq $RootPid } | Select-Object -First 1
    if ($root) { $queue.Enqueue($root) }
    while ($queue.Count -gt 0) {
        $process = $queue.Dequeue()
        $live = Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
        if ($live) {
            $entry = [pscustomobject]@{
                pid = [int]$process.ProcessId
                parent = [int]$process.ParentProcessId
                name = $process.Name
                kind = Get-Kind ([string]$process.CommandLine)
                affinity = $live.ProcessorAffinity.ToInt64().ToString('X')
                workingSetMb = [math]::Round($live.WorkingSet64 / 1MB, 1)
            }
            if ($Action -eq 'memory') {
                $entry | Add-Member -NotePropertyName privateMb -NotePropertyValue ([math]::Round($live.PrivateMemorySize64 / 1MB, 1))
                $entry | Add-Member -NotePropertyName peakWorkingSetMb -NotePropertyValue ([math]::Round($live.PeakWorkingSet64 / 1MB, 1))
                # Empty until the counters below have answered: a read that fails leaves no number, not 0 MB.
                $entry | Add-Member -NotePropertyName videoMemoryMb -NotePropertyValue $null
                $entry | Add-Member -NotePropertyName sharedVideoMemoryMb -NotePropertyValue $null
            }
            [void]$found.Add($entry)
        }
        if ($children.ContainsKey([int]$process.ProcessId)) {
            foreach ($child in $children[[int]$process.ProcessId]) { $queue.Enqueue($child) }
        }
    }
    if ($Action -eq 'memory' -and $found.Count -gt 0) {
        $byPid = @{}
        foreach ($entry in $found) { $byPid[[string]$entry.pid] = $entry }
        $read = Get-Counter -Counter @('\GPU Process Memory(*)\Dedicated Usage', '\GPU Process Memory(*)\Shared Usage') -ErrorAction SilentlyContinue
        if ($read -and $read.CounterSamples) {
            # The counters answered: a process they do not list holds no video memory.
            foreach ($entry in $found) { $entry.videoMemoryMb = 0.0; $entry.sharedVideoMemoryMb = 0.0 }
        }
        foreach ($sample in $read.CounterSamples) {
            if ($sample.Path -match 'gpu process memory\(pid_(\d+)_.*\\(dedicated|shared) usage') {
                $entry = $byPid[$Matches[1]]
                if ($entry) {
                    if ($Matches[2] -eq 'dedicated') { $entry.videoMemoryMb = [math]::Round($entry.videoMemoryMb + $sample.CookedValue / 1MB, 1) }
                    else { $entry.sharedVideoMemoryMb = [math]::Round($entry.sharedVideoMemoryMb + $sample.CookedValue / 1MB, 1) }
                }
            }
        }
    }
    Write-Line @($found)
    exit 0
}

if ($Action -eq 'strays') {
    $wanted = $ShellPath.ToLowerInvariant()
    $stopped = New-Object System.Collections.ArrayList
    if ($wanted) {
        $all = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, CommandLine
        # The browser process is the one started with the main script; its children go with it.
        $engines = @($all | Where-Object { $_.Name -eq 'electron.exe' -and $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($wanted) })
        foreach ($engine in $engines) {
            foreach ($child in ($all | Where-Object { $_.ParentProcessId -eq $engine.ProcessId -and $_.Name -eq 'electron.exe' })) {
                Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue
            }
            Stop-Process -Id $engine.ProcessId -Force -ErrorAction SilentlyContinue
            [void]$stopped.Add([int]$engine.ProcessId)
        }
    }
    Write-Line ([pscustomobject]@{ stopped = @($stopped) })
    exit 0
}

if ($Action -eq 'awake') {
    if ($RunnerPid -le 0) { throw 'awake needs -RunnerPid' }
    Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class PerfAwake {
    [DllImport("kernel32.dll")]
    public static extern uint SetThreadExecutionState(uint flags);
}
'@
    # ES_SYSTEM_REQUIRED (1) + ES_DISPLAY_REQUIRED (2), without ES_CONTINUOUS: each call starts the
    # idle times of the PC and of the screen anew, and nothing outlasts this process. The first
    # call also turns on a screen that had gone off (seen on this PC: the rig's window went from
    # 128 frames a second back to the screen's 160 with no key or mouse touched).
    $said = $false
    while (Get-Process -Id $RunnerPid -ErrorAction SilentlyContinue) {
        [void][PerfAwake]::SetThreadExecutionState(3)
        if (-not $said) {
            Write-Line ([pscustomobject]@{ awake = $true })
            $said = $true
        }
        Start-Sleep -Seconds 2
    }
    exit 0
}

if ($Action -eq 'sample') {
    if ($Mask) {
        [System.Diagnostics.Process]::GetCurrentProcess().ProcessorAffinity = [IntPtr][Convert]::ToInt64($Mask, 16)
    }
    $ids = @($Pids.Split(',') | Where-Object { $_ } | ForEach-Object { [int]$_ })
    $own = @{}
    foreach ($id in $ids) { $own[[string]$id] = $true }
    $corePaths = @($Cores.Split(',') | Where-Object { $_ } | ForEach-Object { "\Processor($_)\% Processor Time" })
    # Every process's 3D engines and video memory; the listed processes are told apart from the rest below.
    $paths = @('\Processor(_Total)\% Processor Time') + $corePaths + @('\GPU Engine(*engtype_3D)\Utilization Percentage', '\GPU Process Memory(*)\Dedicated Usage')
    Write-Line ([pscustomobject]@{ ready = $true; processors = [Environment]::ProcessorCount })

    $previousCpu = @{}
    $previousAt = $null
    Get-Counter -Counter $paths -SampleInterval 1 -Continuous -ErrorAction SilentlyContinue | ForEach-Object {
        # A runner that was killed cannot stop its sampler, and a write to its closed pipe fails silently.
        if ($RunnerPid -gt 0 -and -not (Get-Process -Id $RunnerPid -ErrorAction SilentlyContinue)) { exit 0 }
        $gpu = @{}
        $videoMemory = @{}
        $coreUse = @{}
        $total = 0.0
        $gpuOutside = 0.0
        $videoMemoryOutside = 0.0
        $ownEngines = 0
        foreach ($sample in $_.CounterSamples) {
            $path = $sample.Path
            if ($path -match 'gpu engine\(pid_(\d+)_') {
                if ($own.ContainsKey($Matches[1])) {
                    $gpu[$Matches[1]] = [double]$gpu[$Matches[1]] + $sample.CookedValue
                    $ownEngines += 1
                } else {
                    $gpuOutside += $sample.CookedValue
                }
            } elseif ($path -match 'gpu process memory\(pid_(\d+)_') {
                if ($own.ContainsKey($Matches[1])) {
                    $videoMemory[$Matches[1]] = [double]$videoMemory[$Matches[1]] + $sample.CookedValue
                } else {
                    $videoMemoryOutside += $sample.CookedValue
                }
            } elseif ($path -match 'processor\(_total\)') {
                $total = $sample.CookedValue
            } elseif ($path -match 'processor\((\d+)\)') {
                $coreUse[$Matches[1]] = $sample.CookedValue
            }
        }
        $workingSet = @{}
        $cpuSeconds = 0.0
        $now = [DateTime]::UtcNow
        if ($ids.Count -gt 0) {
            foreach ($process in (Get-Process -Id $ids -ErrorAction SilentlyContinue)) {
                $workingSet[[string]$process.Id] = $process.WorkingSet64
                $spent = $process.TotalProcessorTime.TotalSeconds
                if ($previousCpu.ContainsKey($process.Id)) { $cpuSeconds += ($spent - $previousCpu[$process.Id]) }
                $previousCpu[$process.Id] = $spent
            }
        }
        $ownCpu = $null
        if ($previousAt) { $ownCpu = $cpuSeconds / [math]::Max(0.001, ($now - $previousAt).TotalSeconds) }
        $previousAt = $now
        Write-Line ([pscustomobject]@{
            t = [DateTimeOffset]::new($_.Timestamp).ToUnixTimeMilliseconds()
            cpuTotal = [math]::Round($total, 2)
            cores = $coreUse
            ownCpu = $ownCpu
            ownEngines = $ownEngines
            gpu = $gpu
            videoMemory = $videoMemory
            gpuOutside = [math]::Round($gpuOutside, 3)
            videoMemoryOutside = $videoMemoryOutside
            workingSet = $workingSet
        })
    }
    exit 0
}

throw "unknown action: $Action"
