# electron/spotify/scripts/windowWatch.ps1
# The window of a Spotify this run starts is never on the screen, and only that window is touched.
#
# Spotify shows its window by itself, from its own process, a moment after it starts: measured
# 2026-11-07 on the Microsoft Store build (1.306.1921.0, Windows 11), the CEF window exists hidden
# about 0.9 s after the alias is run and Spotify shows it about 0.1 s later. Nothing Folia can put on
# the start talks it out of that: STARTUPINFO's SW_HIDE (Node's windowsHide) and the app's own
# --minimized are both ignored, and the packaged exe cannot be started at all outside the alias
# (measured: EPERM, and the WindowsApps folder cannot even be listed). So the hide is Folia's to
# make, in the same frame: the window is caught by a WinEvent hook the moment it is shown and hidden
# with ShowWindow, which waits for Spotify's own thread to take it. Measured: one sample at 5 ms
# against 1.4 s before, i.e. under one frame - the taskbar button never has the time to appear.
#
# SkipPids names the PIDs that were already running, comma separated: a Spotify the listener opened
# is not Folia's to tuck away. LifetimeMs is the watcher's own backstop for a start that never ends.
param(
    [string] $SkipPids = '',
    [int] $LifetimeMs = 60000
)
$ErrorActionPreference = 'Stop'
$skip = @($SkipPids -split ',' | Where-Object { $_ -ne '' } | ForEach-Object { [int] $_ })
Add-Type @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public class FoliaSpotifyWindow
{
    delegate void WinEventDelegate(IntPtr hook, uint eventType, IntPtr window, int idObject, int idChild, uint thread, uint time);
    public delegate bool EnumWindowsDelegate(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module, WinEventDelegate callback, uint process, uint thread, uint flags);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsDelegate callback, IntPtr parameter);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder name, int max);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread, uint id, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern int GetMessage(out Message message, IntPtr window, uint min, uint max);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref Message message);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref Message message);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [StructLayout(LayoutKind.Sequential)] struct Message { public IntPtr window; public uint id; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }

    const uint EVENT_OBJECT_SHOW = 0x8002;
    const uint WM_QUIT = 0x0012;
    const uint GW_OWNER = 4;
    const int SW_HIDE = 0;

    // The PIDs that were running before this start: theirs is the listener's window, and it stays.
    public static int[] Skip = new int[0];
    static readonly object Decision = new object();
    // Whether a window belongs to the Spotify this start made never changes for a PID, and the sweep
    // looks at every window of the desktop: what it decided once, it keeps (a start lasts seconds).
    static readonly HashSet<int> Ours = new HashSet<int>();
    static readonly HashSet<int> Theirs = new HashSet<int>();
    static WinEventDelegate _callback;
    static uint _pumpThread;
    static volatile bool _stop;
    static int _hidden;

    static bool IsOurs(uint pid)
    {
        int id = (int)pid;
        lock (Decision) {
            if (Ours.Contains(id)) return true;
            if (Theirs.Contains(id)) return false;
        }
        foreach (int skip in Skip) { if (skip == id) return false; }
        bool ours;
        try { using (Process process = Process.GetProcessById(id)) { ours = process.ProcessName.StartsWith("Spotify", StringComparison.OrdinalIgnoreCase); } }
        catch { ours = false; }
        lock (Decision) { (ours ? Ours : Theirs).Add(id); }
        return ours;
    }

    // The song window and nothing else: CEF's own top-level window of a Spotify this start created,
    // once it is visible. ShowWindow waits for Spotify's thread to take the hide, which is what keeps
    // the window off the screen rather than off it one frame late.
    static void Hide(IntPtr window)
    {
        if (window == IntPtr.Zero) return;
        if (GetWindow(window, GW_OWNER) != IntPtr.Zero) return;
        StringBuilder name = new StringBuilder(256);
        GetClassName(window, name, 256);
        if (!name.ToString().StartsWith("Chrome_WidgetWin_1", StringComparison.Ordinal)) return;
        uint pid;
        GetWindowThreadProcessId(window, out pid);
        if (!IsOurs(pid)) return;
        if (!IsWindowVisible(window)) return;
        ShowWindow(window, SW_HIDE);
        Interlocked.Increment(ref _hidden);
        Console.Out.WriteLine("HIDDEN " + window.ToInt64() + " " + pid);
        Console.Out.Flush();
    }

    // The hook runs on the thread that shows the window, so it takes no lock the sweep could be holding:
    // waiting for a sweep to walk the desktop would be the frame this hide exists to win.
    static void OnShow(IntPtr hook, uint eventType, IntPtr window, int idObject, int idChild, uint thread, uint time)
    {
        if (idObject != 0) return;
        Hide(window);
    }

    // The hook covers the show itself; this covers a window that is created visible, which sends no
    // show of its own.
    static void Sweep()
    {
        while (!_stop)
        {
            EnumWindows(delegate(IntPtr window, IntPtr parameter) { Hide(window); return true; }, IntPtr.Zero);
            Thread.Sleep(20);
        }
    }

    static void Expire(int milliseconds)
    {
        Thread.Sleep(milliseconds);
        _stop = true;
        PostThreadMessage(_pumpThread, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
    }

    public static void Run(int lifetimeMs)
    {
        _pumpThread = GetCurrentThreadId();
        Thread sweep = new Thread(delegate() { Sweep(); });
        sweep.IsBackground = true;
        sweep.Start();
        Thread expiry = new Thread(delegate() { Expire(lifetimeMs); });
        expiry.IsBackground = true;
        expiry.Start();
        _callback = new WinEventDelegate(OnShow);
        SetWinEventHook(EVENT_OBJECT_SHOW, EVENT_OBJECT_SHOW, IntPtr.Zero, _callback, 0, 0, 0);
        Console.Out.WriteLine("ARMED");
        Console.Out.Flush();
        Message message;
        while (!_stop && GetMessage(out message, IntPtr.Zero, 0, 0) > 0)
        {
            TranslateMessage(ref message);
            DispatchMessage(ref message);
        }
    }
}
"@
[FoliaSpotifyWindow]::Skip = $skip
[FoliaSpotifyWindow]::Run($LifetimeMs)
