// packaging/windows/wallpaper-helper/src/attach.rs
// WorkerW probing and attach/detach of the Folia window into the desktop icon layer.
//
// Derived from Seelen UI (AGPL-3.0) src/background/widgets/wallpaper_manager/{mod,handlers}.rs
//   Copyright (c) Seelen-Inc — dual-probe (classic + raised desktop), the 0x052C
//   re-send loop trap fix, and the style normalization are taken from there.
// Probe criteria cross-checked against Lively Wallpaper (GPL-3.0) DesktopUtil.cs.
//   Copyright (c) rocksdanister.
// This file is distributed with Folia under AGPL-3.0.

use windows::core::s;
use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, ScreenToClient, HMONITOR, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowA, FindWindowExA, GetAncestor, GetWindow, GetWindowLongPtrW, GetWindowRect,
    IsWindow, SendMessageTimeoutW, SetParent, SetWindowLongPtrW, SetWindowPos, GA_PARENT, GW_CHILD,
    GWL_EXSTYLE, GWL_STYLE, HWND_TOP, SMTO_NORMAL, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE,
    SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SWP_SHOWWINDOW, WINDOW_EX_STYLE, WINDOW_STYLE,
    WS_CHILDWINDOW, WS_CLIPSIBLINGS, WS_EX_ACCEPTFILES, WS_EX_APPWINDOW, WS_EX_WINDOWEDGE,
};

// Progman's private "spawn a WorkerW below the icon layer" message (0xD/0x1 params, as used by
// Lively, Seelen UI and electron-as-wallpaper). See the trap note on `attach_window` before
// ever sending it.
const PROGMAN_SPAWN_WORKERW: u32 = 0x052C;
// Raised-desktop probing is asynchronous on Explorer's side (Seelen uses 100ms × 10 retries).
const PROBE_RETRY_COUNT: u32 = 10;
const PROBE_RETRY_DELAY_MS: u64 = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttachMode {
    /// Win 10 / early Win 11: WorkerW is a top-level sibling of the window holding DefView.
    Classic,
    /// Win 11 24H2+ raised desktop: WorkerW is a direct child of Progman next to DefView.
    Raised,
}

impl AttachMode {
    pub fn as_str(self) -> &'static str {
        match self {
            AttachMode::Classic => "classic",
            AttachMode::Raised => "raised",
        }
    }
}

unsafe fn find_progman() -> Option<HWND> {
    FindWindowA(s!("Progman"), None).ok()
}

/// Classic architecture probe: enumerate top-level windows, find the one that owns a
/// `SHELLDLL_DefView` child (usually Progman, but shell-tweak tools may move it under a
/// WorkerW), and take the next WorkerW sibling in Z order.
///
/// Z-order sketch (from Seelen's comments):
/// ```text
/// 0x00010190 "" WorkerW
///   0x000100EE "" SHELLDLL_DefView
///     0x000100F0 "FolderView" SysListView32
/// 0x00100B8A "" WorkerW       ← this is the one we want
/// 0x000100EC "Program Manager" Progman
/// ```
unsafe extern "system" fn enum_window(window: HWND, result: LPARAM) -> BOOL {
    unsafe {
        if let Ok(defview) = FindWindowExA(Some(window), None, s!("SHELLDLL_DefView"), None) {
            let _ = defview;
            if let Ok(worker_w) = FindWindowExA(None, Some(window), s!("WorkerW"), None) {
                *(result.0 as *mut Option<HWND>) = Some(worker_w);
                return BOOL(0); // stop enumeration
            }
        }
        BOOL(1) // keep enumerating
    }
}

unsafe fn probe_classic_worker_w() -> Option<HWND> {
    let mut worker_w: Option<HWND> = None;
    // windows-rs maps the raw BOOL return to Result, and EnumWindows returns FALSE exactly when
    // the callback stops enumeration — which is how enum_window signals a match. So the Result
    // is not an error signal: Err means "found and stopped early", Ok means "no match"; the
    // probed handle lives in `worker_w` either way.
    let _ = EnumWindows(Some(enum_window), LPARAM(&mut worker_w as *mut Option<HWND> as isize));
    worker_w
}

/// Raised-desktop probe (Win 11 24H2+): WorkerW is a direct child of Progman next to DefView.
/// The desktop "raising" happens asynchronously on Explorer's side, hence the retries.
unsafe fn probe_raised_worker_w() -> Option<HWND> {
    let progman = find_progman()?;
    let has_defview = FindWindowExA(Some(progman), None, s!("SHELLDLL_DefView"), None).is_ok();
    if !has_defview {
        return None;
    }
    let mut attempts = 0;
    loop {
        if let Ok(worker_w) = FindWindowExA(Some(progman), None, s!("WorkerW"), None) {
            return Some(worker_w);
        }
        if attempts >= PROBE_RETRY_COUNT {
            return None;
        }
        attempts += 1;
        std::thread::sleep(std::time::Duration::from_millis(PROBE_RETRY_DELAY_MS));
    }
}

/// Probes both architectures in order (classic first, raised second).
pub unsafe fn detect_worker_w() -> Option<(HWND, AttachMode)> {
    if let Some(worker_w) = probe_classic_worker_w() {
        return Some((worker_w, AttachMode::Classic));
    }
    if let Some(worker_w) = probe_raised_worker_w() {
        return Some((worker_w, AttachMode::Raised));
    }
    None
}

/// Applies the child-friendly style set Seelen uses: mark as child window (required by
/// SetParent semantics) and drop styles that interfere with a wallpaper window.
unsafe fn normalize_styles(hwnd: HWND) {
    let style = WINDOW_STYLE(GetWindowLongPtrW(hwnd, GWL_STYLE) as u32);
    let style = (style | WS_CHILDWINDOW) & !WS_CLIPSIBLINGS;
    SetWindowLongPtrW(hwnd, GWL_STYLE, style.0 as isize);

    let ex_style = WINDOW_EX_STYLE(GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32);
    let ex_style = ex_style & !WS_EX_ACCEPTFILES & !WS_EX_APPWINDOW & !WS_EX_WINDOWEDGE;
    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex_style.0 as isize);
}

/// Restores the style bits the normalize step touched so the window behaves as a normal
/// top-level window again after detach.
unsafe fn restore_styles(hwnd: HWND) {
    let style = WINDOW_STYLE(GetWindowLongPtrW(hwnd, GWL_STYLE) as u32);
    // tao (Electron) frameless windows are WS_POPUP based; WS_CHILDWINDOW must go.
    let ws_popup = WINDOW_STYLE(0x8000_0000);
    let style = (style & !WS_CHILDWINDOW) | ws_popup;
    SetWindowLongPtrW(hwnd, GWL_STYLE, style.0 as isize);

    let ex_style = WINDOW_EX_STYLE(GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32);
    let ex_style = ex_style | WS_EX_APPWINDOW | WS_EX_WINDOWEDGE;
    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex_style.0 as isize);
}

/// A WorkerW window that can host the wallpaper, with the architecture it belongs to.
type WorkerCandidate = (HWND, AttachMode);

// Enumeration payload: the candidates found so far plus the architecture the current pass is
// scanning (top-level = classic, Progman children = raised).
struct WorkerScan {
    collected: Vec<WorkerCandidate>,
    mode: AttachMode,
}

/// True when `window` is a WorkerW and not the icon layer. The icon layer (a WorkerW hosting
/// `SHELLDLL_DefView`) must stay *above* the wallpaper, so it is never a host candidate.
unsafe fn is_wallpaper_worker(window: HWND) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::GetClassNameW;

    let mut class = [0u16; 32];
    let length = GetClassNameW(window, &mut class);
    if length == 0 || String::from_utf16_lossy(&class[..length as usize]) != "WorkerW" {
        return false;
    }
    FindWindowExA(Some(window), None, s!("SHELLDLL_DefView"), None).is_err()
}

unsafe extern "system" fn collect_worker(window: HWND, data: LPARAM) -> BOOL {
    unsafe {
        if is_wallpaper_worker(window) {
            let scan = &mut *(data.0 as *mut WorkerScan);
            scan.collected.push((window, scan.mode));
        }
    }
    BOOL(1) // keep enumerating
}

/// Every WorkerW the wallpaper could be parented into, with the architecture it belongs to:
/// top-level ones (classic: the sibling layer behind the icons) and Progman's children (raised
/// desktop, Windows 11 24H2+).
unsafe fn collect_wallpaper_workers() -> Vec<WorkerCandidate> {
    use windows::Win32::UI::WindowsAndMessaging::EnumChildWindows;

    let mut scan = WorkerScan {
        collected: Vec::new(),
        mode: AttachMode::Classic,
    };
    let data = LPARAM(&mut scan as *mut WorkerScan as isize);
    let _ = EnumWindows(Some(collect_worker), data);
    if let Some(progman) = find_progman() {
        scan.mode = AttachMode::Raised;
        let _ = EnumChildWindows(Some(progman), Some(collect_worker), data);
    }
    scan.collected
}

fn overlap_area(a: RECT, b: RECT) -> i64 {
    let width = (a.right.min(b.right) - a.left.max(b.left)) as i64;
    let height = (a.bottom.min(b.bottom) - a.top.max(b.top)) as i64;
    if width <= 0 || height <= 0 {
        0
    } else {
        width * height
    }
}

/// The WorkerW that hosts the wallpaper of `monitor`, if the shell keeps one per monitor.
///
/// On Windows 11 24H2+ the desktop is "raised": Progman holds one WorkerW per display. Parenting
/// the window into the wrong one puts the wallpaper on *that* display — SetParent keeps the child's
/// parent-client coordinates, so the window visually jumps to its host's monitor, and any geometry
/// pass that afterwards asks where the window is follows the host instead of the target.
unsafe fn worker_for_monitor(monitor: HMONITOR) -> Option<WorkerCandidate> {
    if monitor.is_invalid() {
        return None;
    }
    let mut info = MONITORINFO::default();
    info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
    if !GetMonitorInfoW(monitor, &mut info).as_bool() {
        return None;
    }

    let monitor_rect = info.rcMonitor;
    let monitor_area =
        (monitor_rect.right - monitor_rect.left) as i64 * (monitor_rect.bottom - monitor_rect.top) as i64;
    let mut best: Option<(WorkerCandidate, i64)> = None;
    for candidate in collect_wallpaper_workers() {
        let mut rect = RECT::default();
        if GetWindowRect(candidate.0, &mut rect).is_err() {
            continue;
        }
        let overlap = overlap_area(rect, monitor_rect);
        // A host that does not essentially cover this monitor is not its wallpaper layer.
        if overlap * 10 < monitor_area * 8 {
            continue;
        }
        if best.map_or(true, |(_, best_overlap)| overlap > best_overlap) {
            best = Some((candidate, overlap));
        }
    }
    best.map(|(candidate, _)| candidate)
}

/// The WorkerW to parent into for a window sitting on `monitor`: its per-monitor host when the
/// shell has one, otherwise the legacy single-WorkerW detection (the classic WorkerW spans the
/// whole virtual screen, so one host serves every monitor).
unsafe fn detect_worker_for_monitor(monitor: HMONITOR) -> Option<WorkerCandidate> {
    match worker_for_monitor(monitor) {
        Some(worker) => Some(worker),
        None => detect_worker_w(),
    }
}

/// Attaches `hwnd` below the desktop icons, returning the WorkerW it was parented into and the
/// desktop architecture. The window itself decides which monitor is filled: the main process
/// creates it on the display the app window was on (see electron/wallpaper/windowsWallpaperTarget.cjs).
/// 0x052C is sent **only when no WorkerW exists**: re-sending while a raised WorkerW is alive
/// makes Explorer tear down and rebuild the whole hierarchy, destroying our attached window
/// and looping forever (Seelen UI trap fix).
pub unsafe fn attach_window(hwnd: HWND) -> Result<(HWND, AttachMode), String> {
    if !IsWindow(Some(hwnd)).as_bool() {
        return Err("folia window no longer exists".to_string());
    }

    // The monitor the window is on *before* the re-parent is the target: SetParent preserves the
    // child's parent-client coordinates, so the window visually jumps to the host's monitor and
    // asking afterwards would only report where the host lives.
    let target_monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);

    let mut worker_w = detect_worker_for_monitor(target_monitor);
    if worker_w.is_none() {
        let progman = find_progman().ok_or_else(|| "Progman not found".to_string())?;
        // Returns LRESULT (no Result) in windows-rs 0.62; a failed spawn is caught by the
        // re-probe below instead.
        SendMessageTimeoutW(
            progman,
            PROGMAN_SPAWN_WORKERW,
            WPARAM(0xD),
            LPARAM(0x1),
            SMTO_NORMAL,
            1000,
            None,
        );
        // The spawn is asynchronous on Explorer's side (the WorkerW pair may not exist yet on a
        // fresh desktop), so probe with the same retry budget the raised-desktop probe uses
        // instead of a single immediate re-probe that races the creation.
        let mut attempts = 0;
        loop {
            worker_w = detect_worker_for_monitor(target_monitor);
            if worker_w.is_some() || attempts >= PROBE_RETRY_COUNT {
                break;
            }
            attempts += 1;
            std::thread::sleep(std::time::Duration::from_millis(PROBE_RETRY_DELAY_MS));
        }
    }
    let (worker_w, mode) = worker_w.ok_or_else(|| "WorkerW not found after spawn".to_string())?;

    normalize_styles(hwnd);
    SetParent(hwnd, Some(worker_w)).map_err(|err| format!("SetParent failed: {err}"))?;
    reassert_geometry_on_monitor(hwnd, target_monitor);
    reassert_z_order_top(hwnd);
    Ok((worker_w, mode))
}

/// Un-parents the window from WorkerW and restores normal styles.
pub unsafe fn detach_window(hwnd: HWND) -> Result<(), String> {
    if !IsWindow(Some(hwnd)).as_bool() {
        return Err("folia window no longer exists".to_string());
    }
    SetParent(hwnd, None).map_err(|err| format!("SetParent(NULL) failed: {err}"))?;
    restore_styles(hwnd);
    Ok(())
}
pub unsafe fn refresh_desktop_wallpaper() -> Result<(), String> {
    use windows::Win32::UI::WindowsAndMessaging::{
        SystemParametersInfoW, SPI_SETDESKWALLPAPER, SPIF_UPDATEINIFILE,
    };
    let ok = SystemParametersInfoW(
        SPI_SETDESKWALLPAPER,
        0,
        None,
        SPIF_UPDATEINIFILE,
    );
    ok.map_err(|err| format!("SPI_SETDESKWALLPAPER refresh failed: {err}"))
}

/// Forces a full repaint of `hwnd`. Called on the WorkerW after our window leaves it: a window
/// destroyed while still parented (app exit racing the detach) otherwise leaves its last frame
/// stuck on the desktop layer until something else happens to invalidate that region.
pub unsafe fn invalidate_window(hwnd: HWND) {
    use windows::Win32::Graphics::Gdi::{InvalidateRect, UpdateWindow};
    if !IsWindow(Some(hwnd)).as_bool() {
        return;
    }
    let _ = InvalidateRect(Some(hwnd), None, true);
    let _ = UpdateWindow(hwnd);
}

/// Runs `f` with the calling thread switched to per-monitor-DPI-aware context and restores
/// the previous context afterwards. The process already runs PMv2 (see main.rs) — this wrapper is
/// the belt-and-braces re-assertion for the geometry work, which must express the window rect in
/// physical pixels: from a virtualized (DPI-unaware) context a scaled display leaves the wallpaper
/// inset by a few pixels (measured ~9 px at 150% scaling).
fn with_physical_dpi<T>(f: impl FnOnce() -> T) -> T {
    use windows::Win32::UI::HiDpi::{
        SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
    };
    unsafe {
        let previous = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        let result = f();
        if !previous.is_invalid() {
            SetThreadDpiAwarenessContext(previous);
        }
        result
    }
}

/// Re-asserts per-monitor-v2 DPI awareness for the calling thread *without* restoring it: the
/// message-loop thread reads cursor positions for the mouse reports (mouse_forward.rs) and must
/// keep reporting physical pixels for the process lifetime. The process-level switch happens in
/// main.rs before any window exists; this only covers the platform refusing that call.
pub(crate) fn ensure_thread_dpi_awareness() {
    use windows::Win32::UI::HiDpi::{
        SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
    };
    unsafe {
        SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
}

/// Sizes the window to fill the monitor it currently sits on, expressed in WorkerW client
/// coordinates (the classic WorkerW spans the whole virtual screen, so the client origin can
/// be offset — Seelen handlers.rs does the same conversion from the virtual screen rect).
/// Which monitor that is follows from where the main process placed the window; the helper has no
/// say in it (multi-display targeting lives in electron/wallpaper/windowsWallpaperTarget.cjs).
pub unsafe fn reassert_geometry(hwnd: HWND) {
    let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
    reassert_geometry_on_monitor(hwnd, monitor);
}

/// Fills `monitor` with the window, converting the monitor rect into the parent's client space.
/// Callers that have just re-parented the window must pass the monitor the window was on *before*
/// the re-parent (see attach_window): the window's own position is already that of its host.
unsafe fn reassert_geometry_on_monitor(hwnd: HWND, monitor: HMONITOR) {
    if monitor.is_invalid() {
        return;
    }
    with_physical_dpi(|| {
        let mut info = MONITORINFO::default();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return;
        }
        let rect: RECT = info.rcMonitor;
        // SetWindowPos positions a child window relative to its PARENT's client area, so the
        // monitor origin must be converted in that space; converting against `hwnd` itself only
        // agrees while the window sits at the parent's (0,0). A not-yet-attached top-level window
        // has no parent and already takes screen coordinates.
        let parent = GetAncestor(hwnd, GA_PARENT);
        let mut origin = POINT { x: rect.left, y: rect.top };
        if !parent.0.is_null() {
            let _ = ScreenToClient(parent, &mut origin);
        }
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        let _ = SetWindowPos(
            hwnd,
            None,
            origin.x,
            origin.y,
            width,
            height,
            SWP_ASYNCWINDOWPOS | SWP_NOACTIVATE | SWP_NOZORDER | SWP_SHOWWINDOW,
        );
    });
}

/// Re-inserts the window at the top of the WorkerW child stack (co-existence with other
/// wallpaper software: the last mover wins).
pub unsafe fn reassert_z_order_top(hwnd: HWND) -> bool {
    SetWindowPos(
        hwnd,
        Some(HWND_TOP),
        0,
        0,
        0,
        0,
        SWP_ASYNCWINDOWPOS | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
    )
    .is_ok()
}

/// True when `hwnd` is the topmost child of `worker_w` (z-order guard condition).
pub unsafe fn is_topmost_child_of_worker_w(hwnd: HWND, worker_w: HWND) -> bool {
    match GetWindow(worker_w, GW_CHILD) {
        Ok(top) => top == hwnd,
        Err(_) => false,
    }
}

/// True when `hwnd` is still parented into `worker_w`.
pub unsafe fn is_parented_into(hwnd: HWND, worker_w: HWND) -> bool {
    GetAncestor(hwnd, GA_PARENT) == worker_w
}
