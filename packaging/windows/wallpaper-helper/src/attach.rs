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
    GetMonitorInfoW, MonitorFromWindow, ScreenToClient, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowA, FindWindowExA, GetAncestor, GetWindow, GetWindowLongPtrW, IsWindow,
    SendMessageTimeoutW, SetParent, SetWindowLongPtrW, SetWindowPos, GA_PARENT, GW_CHILD,
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

/// Attaches `hwnd` below the desktop icons, returning the WorkerW it was parented into.
/// 0x052C is sent **only when no WorkerW exists**: re-sending while a raised WorkerW is alive
/// makes Explorer tear down and rebuild the whole hierarchy, destroying our attached window
/// and looping forever (Seelen UI trap fix).
pub unsafe fn attach_window(hwnd: HWND) -> Result<(HWND, AttachMode), String> {
    if !IsWindow(Some(hwnd)).as_bool() {
        return Err("folia window no longer exists".to_string());
    }

    let mut worker_w = detect_worker_w();
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
            worker_w = detect_worker_w();
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
    reassert_geometry(hwnd);
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
/// the previous context afterwards. The helper is DPI-unaware overall (GetCursorPos must stay
/// in the 96-DPI space matching Electron DIPs, see mouse_forward.rs), but window geometry
/// needs physical pixels — from the unaware context a scaled display leaves the wallpaper
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

/// Sizes the window to fill the monitor it currently sits on, expressed in WorkerW client
/// coordinates (the classic WorkerW spans the whole virtual screen, so the client origin can
/// be offset — Seelen handlers.rs does the same conversion from the virtual screen rect).
pub unsafe fn reassert_geometry(hwnd: HWND) {
    with_physical_dpi(|| reassert_geometry_physical(hwnd));
}

unsafe fn reassert_geometry_physical(hwnd: HWND) {
    let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
    if monitor.is_invalid() {
        return;
    }
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
