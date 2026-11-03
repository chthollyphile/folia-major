// packaging/windows/wallpaper-helper/src/mouse_forward.rs
// Raw Input → JSONL mouse events so the wallpaper window (which sits *below* the icon layer and
// never receives real mouse input) still gets desktop mouse interaction. The helper only
// *reports* input: the Electron main process injects it via `webContents.sendInputEvent`.
// Posting WM_MOUSEMOVE/WM_LBUTTONDOWN directly to the Chromium window does not work — Chromium
// arms TrackMouseEvent on the first processed WM_MOUSEMOVE, but the real cursor physically sits
// on the icon layer above us, so the system instantly answers WM_MOUSELEAVE and hover is torn
// down between every pair of moves (measured: 300–500 enter/leave pairs per second).
//
// Behaviour baseline is Lively Wallpaper (GPL-3.0) RawInputMsgWindow.xaml.cs +
// WinDesktopCore.cs ForwardMouseToWallpapers / IsDesktop():
//   Copyright (c) rocksdanister.
// The Rust mechanical skeleton (message window, raw-input registration and readout) is adapted
// from electron-as-wallpaper (MIT) src/input.rs. Forwarding covers mouse *move*, the *primary
// button* (with IsMouseButtonsSwapped handling) and the *scroll wheels* (vertical + horizontal);
// keyboard / right / middle / side buttons are not forwarded. No upstream wallpaper project
// ships working wheel forwarding (Lively's raw-input wheel path is commented out,
// electron-as-wallpaper swallows RI_MOUSE_HWHEEL) — the wheel reporting here is Folia's own.
// This file is distributed with Folia under AGPL-3.0.

use std::sync::atomic::{AtomicBool, AtomicI32, AtomicIsize, AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::Instant;

use windows::core::s;
use windows::Win32::Devices::HumanInterfaceDevice::{
    HID_USAGE_GENERIC_MOUSE, HID_USAGE_PAGE_GENERIC,
};
use windows::Win32::Foundation::{HWND, LPARAM, POINT};
use windows::Win32::UI::Input::{
    GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER,
    RIDEV_INPUTSINK, RID_INPUT, RIM_TYPEMOUSE,
};
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowExA, GetAncestor, GetCursorPos, GetForegroundWindow, GetSystemMetrics,
    WindowFromPoint, GA_ROOT, RI_MOUSE_BUTTON_1_DOWN, RI_MOUSE_BUTTON_1_UP,
    RI_MOUSE_BUTTON_2_DOWN, RI_MOUSE_BUTTON_2_UP, RI_MOUSE_HWHEEL, RI_MOUSE_WHEEL, SM_SWAPBUTTON,
};

use crate::events::Event;

// Moves are reported straight from WM_INPUT, at the rate raw input reaches the helper (measured on
// Windows 11: 125 Hz for a background RIDEV_INPUTSINK listener, whatever the mouse polls at). The
// minimum spacing only caps unthrottled 1000+ Hz gaming mice (~250 reports a second) to keep the
// JSONL/IPC volume bounded. A fixed WM_TIMER cadence cannot do this job: the system tick quantizes
// a 16 ms timer to ~31 ms, which left drags at ~26 updates a second.
const MOUSE_MOVE_MIN_INTERVAL_US: u64 = 4_000;
// Trailing flush for positions held back by the spacing or the foreground filter, so the last
// position of a gesture (or the one waiting for the desktop to come back) still goes out.
const MOUSE_MOVE_TIMER_MS: u32 = 16;
// Sentinel meaning "nothing emitted yet" for the last-reported position.
const POSITION_UNKNOWN: i32 = i32::MIN;

// Foreground-window filter (Lively IsDesktop): report input only while the user is actually on
// the desktop — otherwise input typed/clicked inside normal applications would leak into the
// wallpaper page. The WorkerW handle is refreshed on every (re-)attach because explorer rebuilds
// it. On the classic (Win10) desktop the icon layer (SHELLDLL_DefView) lives in its own WorkerW
// and covers the whole screen, so a desktop click makes THAT WorkerW the foreground window — the
// wallpaper WorkerW below it can never be clicked directly (Lively compares against the icon
// WorkerW too, see DesktopUtil.GetDesktopWorkerW). On the raised (Win11 24H2) desktop the icons
// stay under Progman, so Progman is the accepted foreground there.
static WORKERW_HWND: AtomicIsize = AtomicIsize::new(0);
static ICON_WORKERW_HWND: AtomicIsize = AtomicIsize::new(0);
// Latest raw cursor position and whether it changed since the last report.
static LATEST_X: AtomicI32 = AtomicI32::new(POSITION_UNKNOWN);
static LATEST_Y: AtomicI32 = AtomicI32::new(POSITION_UNKNOWN);
static POSITION_DIRTY: AtomicBool = AtomicBool::new(false);
// Last position actually reported to the main process (dedupes identical reports), and when.
static LAST_SENT_X: AtomicI32 = AtomicI32::new(POSITION_UNKNOWN);
static LAST_SENT_Y: AtomicI32 = AtomicI32::new(POSITION_UNKNOWN);
static LAST_MOVE_SENT_US: AtomicU64 = AtomicU64::new(0);
// Whether the primary button is currently tracked as held. While held, the final button-up is
// reported regardless of the foreground filter — a drag that leaves the desktop (or an alt-tab
// mid-drag) must not leave the renderer stuck in a pressed state. Moves are not exempt: they
// always need the desktop in the foreground, so a drag inside another app never pans the wall.
static PRIMARY_DOWN: AtomicBool = AtomicBool::new(false);

static CLOCK_ORIGIN: OnceLock<Instant> = OnceLock::new();

// Monotonic microseconds since the first call (QueryPerformanceCounter under std's Instant; the
// tick-based GetTickCount64 is as coarse as the timer this spacing replaces).
fn now_us() -> u64 {
    CLOCK_ORIGIN.get_or_init(Instant::now).elapsed().as_micros() as u64
}

/// Whether a move arriving at `now_us` may be reported right away, given when the previous
/// move report went out.
fn move_report_due(now_us: u64, last_sent_us: u64) -> bool {
    now_us.saturating_sub(last_sent_us) >= MOUSE_MOVE_MIN_INTERVAL_US
}

// Whether `hwnd` is one of the desktop's own top-level windows (wallpaper WorkerW, icon WorkerW
// or Progman).
unsafe fn is_desktop_window(hwnd: HWND) -> bool {
    if hwnd.0.is_null() {
        return false;
    }
    let worker_w = WORKERW_HWND.load(Ordering::Relaxed);
    let icon_worker_w = ICON_WORKERW_HWND.load(Ordering::Relaxed);
    hwnd.0 as isize == worker_w
        || (icon_worker_w != 0 && hwnd.0 as isize == icon_worker_w)
        || Some(hwnd) == find_progman_hwnd()
}

unsafe fn is_desktop_foreground() -> bool {
    is_desktop_window(GetForegroundWindow())
}

// Whether a click or wheel at `point` lands on the desktop. Raw input reaches the helper before
// the click activates its target window, so a click from the desktop into an app window still
// sees the desktop as foreground; and wheel input scrolls the window under the cursor even when
// it is inactive. The top-level window under the cursor is what the input actually hits.
unsafe fn is_desktop_under(point: POINT) -> bool {
    let hit = WindowFromPoint(point);
    !hit.0.is_null() && is_desktop_window(GetAncestor(hit, GA_ROOT))
}

// Current cursor position (physical pixels: the thread is per-monitor DPI aware).
unsafe fn cursor_pos() -> Option<POINT> {
    let mut point = POINT::default();
    GetCursorPos(&mut point).ok().map(|_| point)
}

// The WorkerW hosting SHELLDLL_DefView (the clickable desktop icon layer). None on the raised
// desktop where DefView lives under Progman (that case is covered by the Progman check).
// Mirrors Lively DesktopUtil.GetDesktopWorkerW.
unsafe fn find_icon_worker_w() -> Option<HWND> {
    let progman = find_progman_hwnd()?;
    if FindWindowExA(Some(progman), None, s!("SHELLDLL_DefView"), None).is_ok() {
        return None;
    }
    let mut after = HWND::default();
    loop {
        let worker = FindWindowExA(None, Some(after), s!("WorkerW"), None).ok()?;
        if FindWindowExA(Some(worker), None, s!("SHELLDLL_DefView"), None).is_ok() {
            return Some(worker);
        }
        after = worker;
    }
}

unsafe fn find_progman_hwnd() -> Option<HWND> {
    windows::Win32::UI::WindowsAndMessaging::FindWindowA(s!("Progman"), None).ok()
}

/// Registers raw input on the message window (RIDEV_INPUTSINK keeps the helper background
/// while receiving WM_INPUT) and starts the trailing-flush timer for moves.
pub unsafe fn register(worker_w: HWND) -> Result<(), String> {
    super::attach::ensure_thread_dpi_awareness();
    // Start the spacing clock now, so the very first move is not held back as "too recent".
    CLOCK_ORIGIN.get_or_init(Instant::now);
    WORKERW_HWND.store(worker_w.0 as isize, Ordering::Relaxed);
    ICON_WORKERW_HWND.store(
        find_icon_worker_w().map_or(0, |hwnd| hwnd.0 as isize),
        Ordering::Relaxed,
    );

    let raw_input_window = super::message_window::hwnd()
        .ok_or_else(|| "message window not created".to_string())?;

    let devices: [RAWINPUTDEVICE; 1] = [RAWINPUTDEVICE {
        usUsagePage: HID_USAGE_PAGE_GENERIC,
        usUsage: HID_USAGE_GENERIC_MOUSE,
        dwFlags: RIDEV_INPUTSINK,
        hwndTarget: raw_input_window,
    }];
    RegisterRawInputDevices(&devices, std::mem::size_of::<RAWINPUTDEVICE>() as u32)
        .map_err(|err| format!("RegisterRawInputDevices failed: {err}"))?;

    if super::message_window::set_timer(
        super::message_window::MOUSE_MOVE_TIMER_ID,
        MOUSE_MOVE_TIMER_MS,
    ) == 0
    {
        return Err("SetTimer(mouse move) failed".to_string());
    }
    Ok(())
}

/// WM_INPUT handler, called from the message window wndproc.
pub unsafe fn handle_raw_input(l_param: LPARAM) {
    let mut raw_data = RAWINPUT::default();
    let mut raw_data_size = std::mem::size_of::<RAWINPUT>() as u32;
    let header_size = std::mem::size_of::<RAWINPUTHEADER>() as u32;

    let read = GetRawInputData(
        HRAWINPUT(l_param.0 as _),
        RID_INPUT,
        Some(&mut raw_data as *mut _ as *mut _),
        &mut raw_data_size,
        header_size,
    );
    if read == u32::MAX {
        return;
    }
    if raw_data.header.dwType != RIM_TYPEMOUSE.0 {
        return;
    }

    let mouse = raw_data.data.mouse;
    let button_flags = unsafe { mouse.Anonymous.Anonymous.usButtonFlags } as u32;

    // Buttons are swapped, the *physical* right button is the user's primary button
    // (Lively IsMouseButtonsSwapped handling).
    let swapped = GetSystemMetrics(SM_SWAPBUTTON) != 0;
    let primary_down = if swapped {
        button_flags & RI_MOUSE_BUTTON_2_DOWN != 0
    } else {
        button_flags & RI_MOUSE_BUTTON_1_DOWN != 0
    };
    let primary_up = if swapped {
        button_flags & RI_MOUSE_BUTTON_2_UP != 0
    } else {
        button_flags & RI_MOUSE_BUTTON_1_UP != 0
    };

    // A press counts only when it lands on the desktop while the desktop is foreground. One packet
    // can carry both transitions (a fast click), so the down is handled first and the up is not
    // skipped — skipping it would leave the press tracked as held for good.
    if primary_down && !PRIMARY_DOWN.load(Ordering::SeqCst) && is_desktop_foreground() {
        if let Some(point) = cursor_pos() {
            if is_desktop_under(point) {
                PRIMARY_DOWN.store(true, Ordering::SeqCst);
                super::events::emit(&Event::MouseButtonDown { x: point.x, y: point.y });
            }
        }
    }
    if primary_up {
        // Only swallow the up if we never reported the down; always clear our tracking.
        if PRIMARY_DOWN.swap(false, Ordering::SeqCst) {
            if let Some(point) = cursor_pos() {
                super::events::emit(&Event::MouseButtonUp { x: point.x, y: point.y });
            }
        }
    }
    if primary_down || primary_up {
        return;
    }

    // Wheel packets carry their delta in usButtonData as multiples of WHEEL_DELTA (semantics
    // documented on Event::MouseWheel). They are discrete, low-rate events — reported
    // immediately instead of being spaced out, gated like a press: the desktop must be
    // foreground and under the cursor (no drag exemption).
    let wheel_delta = mouse.Anonymous.Anonymous.usButtonData as i16;
    if button_flags & RI_MOUSE_WHEEL != 0 {
        report_wheel(0, wheel_delta);
        return;
    }
    if button_flags & RI_MOUSE_HWHEEL != 0 {
        report_wheel(wheel_delta, 0);
        return;
    }

    // Any other button flags (right / middle / side) are intentionally dropped; plain
    // move events (no flags) refresh the position and report it unless the last report was
    // too recent — the trailing timer picks up what the spacing held back.
    if button_flags == 0 {
        if let Some(point) = cursor_pos() {
            LATEST_X.store(point.x, Ordering::Relaxed);
            LATEST_Y.store(point.y, Ordering::Relaxed);
            POSITION_DIRTY.store(true, Ordering::Relaxed);
            if move_report_due(now_us(), LAST_MOVE_SENT_US.load(Ordering::Relaxed)) {
                flush_move();
            }
        }
    }
}

/// WM_TIMER tick: reports a position the minimum spacing or the foreground filter held back.
pub unsafe fn on_move_timer() {
    flush_move();
}

// Reports the latest position when it changed and the desktop is foreground. A position held back
// by the foreground filter stays pending, so a quick poke into another app and back does not lose
// the trailing position: it goes out on the first tick with the desktop in front again.
unsafe fn flush_move() {
    if !POSITION_DIRTY.load(Ordering::Relaxed) || !is_desktop_foreground() {
        return;
    }
    POSITION_DIRTY.store(false, Ordering::Relaxed);
    let x = LATEST_X.load(Ordering::Relaxed);
    let y = LATEST_Y.load(Ordering::Relaxed);
    if x == POSITION_UNKNOWN
        || (x == LAST_SENT_X.load(Ordering::Relaxed) && y == LAST_SENT_Y.load(Ordering::Relaxed))
    {
        return;
    }
    LAST_SENT_X.store(x, Ordering::Relaxed);
    LAST_SENT_Y.store(y, Ordering::Relaxed);
    LAST_MOVE_SENT_US.store(now_us(), Ordering::Relaxed);
    super::events::emit(&Event::MouseMove { x, y });
}

/// Reports one wheel packet at the current cursor position when it lands on the desktop.
unsafe fn report_wheel(delta_x: i16, delta_y: i16) {
    let Some(point) = cursor_pos() else {
        return;
    };
    if !is_desktop_foreground() || !is_desktop_under(point) {
        return;
    }
    super::events::emit(&Event::MouseWheel {
        x: point.x,
        y: point.y,
        delta_x,
        delta_y,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_move_after_a_quiet_spell_goes_out_immediately() {
        assert!(move_report_due(2_000_000, 1_000_000));
    }

    #[test]
    fn moves_closer_than_the_spacing_wait_for_the_trailing_flush() {
        // A 1000 Hz mouse: packets 1 ms apart go out every 4th packet.
        let sent = 10_000;
        assert!(!move_report_due(sent + 1_000, sent));
        assert!(!move_report_due(sent + 3_999, sent));
        assert!(move_report_due(sent + 4_000, sent));
    }

    #[test]
    fn a_125_hz_mouse_is_never_held_back() {
        let sent = 10_000;
        assert!(move_report_due(sent + 8_000, sent));
    }
}
