// packaging/windows/wallpaper-helper/src/monitor.rs
// Resident-side resilience: explorer-restart / WorkerW-destroyed re-attach, the low-frequency
// z-order re-assertion against other wallpaper software, and the heartbeat the Electron main
// process' watchdog consumes.
//
// The TaskbarCreated + Shell_TrayWnd PID comparison is translated from Lively Wallpaper
// (GPL-3.0) WinDesktopCore.cs WndProc_TaskbarCreated.   Copyright (c) rocksdanister.
// This file is distributed with Folia under AGPL-3.0.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use windows::core::s;
use windows::Win32::Foundation::HWND;
// windows-rs 0.62: SetWinEventHook lives in Accessibility, but the EVENT_OBJECT_* / WINEVENT_*
// constants stay in WindowsAndMessaging.
use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowA, GetWindowThreadProcessId, IsWindow, SetTimer, EVENT_OBJECT_DESTROY,
    EVENT_OBJECT_REORDER, OBJID_WINDOW, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
};

use crate::events::Event;

// The z-order re-assert is additionally time-throttled beyond the 10s timer: EVENT_OBJECT_REORDER
// fires extremely often globally, and the guard's purpose is to win against a wallpaper app that
// re-asserts itself, not to enter an adjustment storm with it.
const ZORDER_REASSERT_MIN_INTERVAL: Duration = Duration::from_millis(10_000);
// Heartbeat cadence; the main-process watchdog times out at 3× this.
const HEARTBEAT_TIMER_MS: u32 = 5000;
const HEARTBEAT_TIMER_ID: usize = 1;
// Re-attach retry budget: explorer restarts rebuild the desktop asynchronously
// (Seelen uses 100ms × 10; we allow a longer total window since we are already detached).
const REATTACH_MAX_ATTEMPTS: u32 = 10;
const REATTACH_RETRY_DELAY: Duration = Duration::from_millis(500);

pub struct AppState {
    pub folia_hwnd: isize,
    pub worker_w: isize,
    pub zguard: bool,
    pub explorer_pid: u32,
    pub last_zassert: Option<Instant>,
}

static APP_STATE: Mutex<Option<AppState>> = Mutex::new(None);
static REATTACHING: AtomicBool = AtomicBool::new(false);

fn with_state<T>(f: impl FnOnce(&mut AppState) -> T) -> Option<T> {
    APP_STATE.lock().ok().and_then(|mut guard| {
        guard.as_mut().map(|state| f(state))
    })
}

/// The Folia hwnd currently being watched (None before `start`).
pub fn resident_folia_hwnd() -> Option<isize> {
    with_state(|state| state.folia_hwnd)
}

/// The WorkerW the Folia window is currently parented into (None before `start`).
pub fn resident_worker_w() -> Option<isize> {
    with_state(|state| state.worker_w)
}

pub fn emit(event: &Event) {
    crate::events::emit(event);
}

/// Initializes resident monitoring for an attached window. Installs the WinEvent hooks
/// (must be called from the thread that later pumps messages) and starts the heartbeat timer.
pub unsafe fn start(hwnd: HWND, worker_w: HWND, zguard: bool) -> Result<(), String> {
    let explorer_pid = current_explorer_pid();
    *APP_STATE
        .lock()
        .map_err(|_| "monitor state poisoned".to_string())? = Some(AppState {
        folia_hwnd: hwnd.0 as isize,
        worker_w: worker_w.0 as isize,
        zguard,
        explorer_pid,
        last_zassert: None,
    });

    install_win_event_hooks()?;
    let message_window = crate::message_window::hwnd()
        .ok_or_else(|| "message window not created".to_string())?;
    if SetTimer(Some(message_window), HEARTBEAT_TIMER_ID, HEARTBEAT_TIMER_MS, None) == 0 {
        return Err("SetTimer failed".to_string());
    }
    Ok(())
}

unsafe fn install_win_event_hooks() -> Result<(), String> {
    let destroy_hook = SetWinEventHook(
        EVENT_OBJECT_DESTROY,
        EVENT_OBJECT_DESTROY,
        None,
        Some(win_event_proc),
        0,
        0,
        WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
    );
    if destroy_hook.is_invalid() {
        return Err("SetWinEventHook(EVENT_OBJECT_DESTROY) failed".to_string());
    }
    let reorder_hook = SetWinEventHook(
        EVENT_OBJECT_REORDER,
        EVENT_OBJECT_REORDER,
        None,
        Some(win_event_proc),
        0,
        0,
        WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
    );
    if reorder_hook.is_invalid() {
        return Err("SetWinEventHook(EVENT_OBJECT_REORDER) failed".to_string());
    }
    Ok(())
}

unsafe extern "system" fn win_event_proc(
    _hook: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    id_object: i32,
    _id_child: i32,
    _thread: u32,
    _time: u32,
) {
    if id_object != OBJID_WINDOW.0 {
        return;
    }
    // Snapshot the interesting fields, then run the (possibly sleeping) handlers without
    // holding the state lock.
    let snapshot = with_state(|state| {
        (
            hwnd.0 as isize == state.worker_w,
            hwnd.0 as isize == state.folia_hwnd,
            state.zguard,
            state.folia_hwnd,
        )
    });
    let Some((is_workerw, is_folia, zguard, folia)) = snapshot else {
        return;
    };

    match event {
        EVENT_OBJECT_DESTROY if is_workerw || is_folia => {
            on_workerw_lost(folia);
        }
        EVENT_OBJECT_REORDER if zguard => {
            maybe_reassert_z_order();
        }
        _ => {}
    }
}

// --- z-order guard -----------------------------------------------------------

unsafe fn maybe_reassert_z_order() {
    let Some((folia, worker_w)) = with_state(|state| (state.folia_hwnd, state.worker_w)) else {
        return;
    };
    let folia = HWND(folia as _);
    let worker_w = HWND(worker_w as _);
    if !IsWindow(Some(folia)).as_bool() {
        return;
    }
    if !crate::attach::is_parented_into(folia, worker_w) {
        return;
    }
    if crate::attach::is_topmost_child_of_worker_w(folia, worker_w) {
        return;
    }
    // Rate-limit actual re-assertions; the checks above are cheap, SetWindowPos is not.
    let recent = with_state(|state| {
        state
            .last_zassert
            .map(|at| at.elapsed() < ZORDER_REASSERT_MIN_INTERVAL)
            .unwrap_or(false)
    });
    if recent.unwrap_or(false) {
        return;
    }
    if crate::attach::reassert_z_order_top(folia) {
        with_state(|state| state.last_zassert = Some(Instant::now()));
        emit(&Event::Reasserted {
            hwnd: folia.0 as isize,
        });
    }
}

// --- heartbeat / timer -------------------------------------------------------

/// Called on WM_TIMER from the message window: emits the heartbeat and periodically re-runs
/// the z-order guard.
pub unsafe fn on_timer() {
    emit(&Event::Heartbeat);
    if with_state(|state| state.zguard).unwrap_or(false) {
        maybe_reassert_z_order();
    }
}

// --- explorer restart / workerw loss ----------------------------------------

pub unsafe fn current_explorer_pid() -> u32 {
    let mut pid: u32 = 0;
    if let Ok(tray) = FindWindowA(s!("Shell_TrayWnd"), None) {
        GetWindowThreadProcessId(tray, Some(&mut pid));
    }
    pid
}

/// Called when the TaskbarCreated broadcast message arrives on the message window.
pub unsafe fn on_taskbar_created() {
    let new_pid = current_explorer_pid();
    let old_pid = match with_state(|state| {
        let old = state.explorer_pid;
        state.explorer_pid = new_pid;
        old
    }) {
        Some(old) => old,
        None => return,
    };
    if new_pid == old_pid {
        return; // DPI change also broadcasts TaskbarCreated; only a PID change is a restart.
    }
    emit(&Event::ExplorerRestarted);
    spawn_reattach();
}

fn on_workerw_lost(folia_hwnd: isize) {
    emit(&Event::WorkerwDestroyed { hwnd: folia_hwnd });
    spawn_reattach();
}

/// Re-attach runs on its own thread: the retry loop sleeps, which must never block the
/// message loop (WinEvent callbacks and WM_TIMER share it). The REATTACHING flag dedupes the
/// near-simultaneous WorkerW-destroyed and explorer-restarted triggers.
fn spawn_reattach() {
    if REATTACHING.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(|| unsafe {
        for attempt in 0..REATTACH_MAX_ATTEMPTS {
            if crate::DETACH_REQUESTED.load(Ordering::SeqCst) {
                break;
            }
            let Some(folia) = with_state(|state| state.folia_hwnd) else {
                break;
            };
            if folia == 0 {
                break;
            }
            let hwnd = HWND(folia as _);
            if !IsWindow(Some(hwnd)).as_bool() {
                emit(&Event::Error {
                    message: "folia window was destroyed together with the WorkerW; the main process must rebuild it"
                        .to_string(),
                    kind: Some(crate::events::ERR_KIND_WINDOW_DESTROYED),
                });
                break;
            }
            match crate::attach::attach_window(hwnd) {
                Ok((worker_w, mode)) => {
                    if crate::DETACH_REQUESTED.load(Ordering::SeqCst) {
                        let _ = crate::attach::detach_window(hwnd);
                        break;
                    }
                    with_state(|state| {
                        state.worker_w = worker_w.0 as isize;
                        state.last_zassert = None;
                    });
                    emit(&Event::Attached {
                        hwnd: folia,
                        workerw: worker_w.0 as isize,
                        mode: mode.as_str(),
                    });
                    // Keep mouse reporting pointed at the (possibly new) WorkerW for the
                    // foreground filter.
                    let _ = crate::mouse_forward::register(worker_w);
                    break;
                }
                Err(err) => {
                    if attempt + 1 == REATTACH_MAX_ATTEMPTS {
                        emit(&Event::Error {
                            message: format!(
                                "re-attach failed after {} retries: {err}",
                                REATTACH_MAX_ATTEMPTS
                            ),
                            kind: None,
                        });
                    } else {
                        std::thread::sleep(REATTACH_RETRY_DELAY);
                    }
                }
            }
        }
        REATTACHING.store(false, Ordering::SeqCst);
    });
}
