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

use std::sync::atomic::{AtomicBool, AtomicI32, AtomicIsize, Ordering};

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
    FindWindowExA, GetCursorPos, GetForegroundWindow, GetSystemMetrics, RI_MOUSE_BUTTON_1_DOWN,
    RI_MOUSE_BUTTON_1_UP, RI_MOUSE_BUTTON_2_DOWN, RI_MOUSE_BUTTON_2_UP, RI_MOUSE_HWHEEL,
    RI_MOUSE_WHEEL, SM_SWAPBUTTON,
};

use crate::events::Event;

// Coalescing cadence for move reports: one position per frame is enough for hover/drag
// feedback, and it keeps the JSONL/IPC volume bounded even with 1000 Hz gaming mice.
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
// Latest raw cursor position and whether it changed since the last timer tick.
static LATEST_X: AtomicI32 = AtomicI32::new(POSITION_UNKNOWN);
static LATEST_Y: AtomicI32 = AtomicI32::new(POSITION_UNKNOWN);
static POSITION_DIRTY: AtomicBool = AtomicBool::new(false);
// Last position actually reported to the main process (dedupes identical reports).
static LAST_SENT_X: AtomicI32 = AtomicI32::new(POSITION_UNKNOWN);
static LAST_SENT_Y: AtomicI32 = AtomicI32::new(POSITION_UNKNOWN);
// Whether the primary button is currently tracked as held. While held, moves and the final
// button-up are reported regardless of the foreground filter — a drag that leaves the desktop
// (or an alt-tab mid-drag) must not leave the renderer stuck in a pressed state.
static PRIMARY_DOWN: AtomicBool = AtomicBool::new(false);

unsafe fn is_desktop_foreground() -> bool {
    let foreground = GetForegroundWindow();
    if foreground.0.is_null() {
        return false;
    }
    let worker_w = WORKERW_HWND.load(Ordering::Relaxed);
    let icon_worker_w = ICON_WORKERW_HWND.load(Ordering::Relaxed);
    let progman = find_progman_hwnd();
    foreground.0 as isize == worker_w
        || (icon_worker_w != 0 && foreground.0 as isize == icon_worker_w)
        || Some(foreground) == progman
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
/// while receiving WM_INPUT) and starts the move-coalescing timer (~60 Hz).
pub unsafe fn register(worker_w: HWND) -> Result<(), String> {
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

    if primary_down && is_desktop_foreground() && !PRIMARY_DOWN.swap(true, Ordering::SeqCst) {
        report_button(true);
        return;
    }
    if primary_up {
        // Only swallow the up if we never reported the down; always clear our tracking.
        if PRIMARY_DOWN.swap(false, Ordering::SeqCst) {
            report_button(false);
        }
        return;
    }

    // Wheel packets carry their delta in usButtonData as multiples of WHEEL_DELTA (semantics
    // documented on Event::MouseWheel). They are discrete, low-rate events — reported
    // immediately instead of being coalesced, gated by the foreground filter (no drag
    // exemption).
    let wheel_delta = mouse.Anonymous.Anonymous.usButtonData as i16;
    if button_flags & RI_MOUSE_WHEEL != 0 {
        if is_desktop_foreground() {
            report_wheel(0, wheel_delta);
        }
        return;
    }
    if button_flags & RI_MOUSE_HWHEEL != 0 {
        if is_desktop_foreground() {
            report_wheel(wheel_delta, 0);
        }
        return;
    }

    // Any other button flags (right / middle / side) are intentionally dropped; plain
    // move events (no flags) just refresh the coalesced position for the timer tick.
    if button_flags == 0 {
        let mut point = POINT::default();
        if GetCursorPos(&mut point).is_ok() {
            LATEST_X.store(point.x, Ordering::Relaxed);
            LATEST_Y.store(point.y, Ordering::Relaxed);
            POSITION_DIRTY.store(true, Ordering::Relaxed);
        }
    }
}

/// WM_TIMER tick for the move coalescer: reports the latest position once per frame when it
/// changed. The foreground filter runs here (not in the WM_INPUT handler) so a quick poke
/// into another app and back does not lose the trailing position.
pub unsafe fn on_move_timer() {
    if !POSITION_DIRTY.swap(false, Ordering::Relaxed) {
        return;
    }
    if !PRIMARY_DOWN.load(Ordering::SeqCst) && !is_desktop_foreground() {
        return;
    }
    let x = LATEST_X.load(Ordering::Relaxed);
    let y = LATEST_Y.load(Ordering::Relaxed);
    if x == POSITION_UNKNOWN
        || (x == LAST_SENT_X.load(Ordering::Relaxed) && y == LAST_SENT_Y.load(Ordering::Relaxed))
    {
        return;
    }
    LAST_SENT_X.store(x, Ordering::Relaxed);
    LAST_SENT_Y.store(y, Ordering::Relaxed);
    super::events::emit(&Event::MouseMove { x, y });
}

unsafe fn report_button(is_down: bool) {
    let mut point = POINT::default();
    if GetCursorPos(&mut point).is_err() {
        return;
    }
    let event = if is_down {
        Event::MouseButtonDown { x: point.x, y: point.y }
    } else {
        Event::MouseButtonUp { x: point.x, y: point.y }
    };
    super::events::emit(&event);
}

/// Reports one wheel packet at the current cursor position.
unsafe fn report_wheel(delta_x: i16, delta_y: i16) {
    let mut point = POINT::default();
    if GetCursorPos(&mut point).is_err() {
        return;
    }
    super::events::emit(&Event::MouseWheel {
        x: point.x,
        y: point.y,
        delta_x,
        delta_y,
    });
}
