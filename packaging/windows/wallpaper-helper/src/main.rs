// packaging/windows/wallpaper-helper/src/main.rs
// Folia Windows desktop-wallpaper helper: parents the Electron main window into the WorkerW
// layer below the desktop icons, forwards desktop mouse input (move + left button) via Raw
// Input, and keeps the session alive across explorer restarts. Protocol: JSONL events on
// stdout, one-line commands on stdin (`detach`), consumed by
// electron/windowsWallpaperController.cjs. Implementation provenance per module is noted in
// each file header; overall licensing is AGPL-3.0 (same as Folia).

mod cli;
mod events;

#[cfg(windows)]
mod attach;
#[cfg(windows)]
mod message_window;
#[cfg(windows)]
mod monitor;
#[cfg(windows)]
mod mouse_forward;

use cli::Command;
use events::Event;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match cli::parse(&args) {
        Ok(command) => run(command),
        Err(message) => {
            eprintln!("usage: folia-wallpaper-helper attach --hwnd <n> [--forward-mouse] [--zguard]");
            eprintln!("       folia-wallpaper-helper move --hwnd <n>");
            eprintln!("       folia-wallpaper-helper detach --hwnd <n>");
            eprintln!("error: {message}");
            std::process::exit(2);
        }
    }
}

fn run(command: Command) {
    // Built only on/for Windows; the guard keeps `cargo test` working on other hosts.
    #[cfg(not(windows))]
    {
        let _ = command;
        events::emit(&Event::Error {
            message: "this helper only runs on Windows".to_string(),
            kind: None,
        });
        std::process::exit(2);
    }

    #[cfg(windows)]
    run_windows(command);
}

#[cfg(windows)]
use windows::Win32::Foundation::HWND;

#[cfg(windows)]
pub(crate) static DETACH_REQUESTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg(windows)]
fn run_windows(command: Command) {
    unsafe {
        match command {
            Command::Move { hwnd } => {
                attach::reassert_geometry(HWND(hwnd as _));
                events::emit(&Event::Moved { hwnd });
            }
            Command::Detach { hwnd } => {
                detach_and_report(hwnd);
            }
            Command::Attach {
                hwnd,
                forward_mouse,
                zguard,
            } => {
                attach_resident(hwnd, forward_mouse, zguard);
            }
        }
    }
}

/// One-shot detach (`detach` subcommand): un-parent and restore styles, then exit.
#[cfg(windows)]
unsafe fn detach_and_report(hwnd: isize) {
    match attach::detach_window(HWND(hwnd as _)) {
        Ok(()) => events::emit(&Event::Detached { hwnd }),
        Err(message) => {
            events::emit(&Event::Error { message, kind: None });
            std::process::exit(1);
        }
    }
}

/// Resident attach: mount into WorkerW, install monitoring (+ optional mouse forwarding),
/// pump messages until a `detach` line arrives on stdin.
#[cfg(windows)]
unsafe fn attach_resident(hwnd: isize, forward_mouse: bool, zguard: bool) {
    if let Err(err) = message_window::create() {
        events::emit(&Event::Error { message: err, kind: None });
        std::process::exit(1);
    }

    let hwnd = HWND(hwnd as _);
    let (worker_w, mode) = match attach::attach_window(hwnd) {
        Ok(result) => result,
        Err(message) => {
            events::emit(&Event::Error { message, kind: None });
            std::process::exit(1);
        }
    };

    if let Err(err) = monitor::start(hwnd, worker_w, zguard) {
        events::emit(&Event::Error { message: err, kind: None });
        std::process::exit(1);
    }
    if forward_mouse {
        // Fatal, by contract with the main process (a pre-`attached` error counts as a failed
        // session): the wallpaper window sits below the icon layer and never receives real OS
        // input, and keyboard is not forwarded either — without mouse reporting the page is
        // unreachable, so staying resident would leave an uninteractable desktop. Exiting lets
        // the main process' crash-loop breaker degrade wallpaper mode instead.
        if let Err(err) = mouse_forward::register(worker_w) {
            events::emit(&Event::Error {
                message: format!("mouse forwarding unavailable: {err}"),
                kind: None,
            });
            std::process::exit(1);
        }
    }

    events::emit(&Event::Attached {
        hwnd: hwnd.0 as isize,
        workerw: worker_w.0 as isize,
        mode: mode.as_str(),
    });

    // stdin reader: a single `detach` line triggers the WM_CLOSE path on the message thread
    // (window restore happens on the thread that owns the message window). EOF on stdin
    // (the main process died without killing us) detaches as well, so the window never stays
    // welded to a WorkerW nobody is watching.
    std::thread::spawn(|| {
        use std::io::BufRead;
        let stdin = std::io::stdin();
        for line in stdin.lock().lines() {
            match line.as_deref().map(str::trim) {
                Ok("detach") => {
                    post_detach_to_message_thread();
                    return;
                }
                Ok(_) => {} // unknown command: ignore
                Err(_) => {
                    post_detach_to_message_thread();
                    return;
                }
            }
        }
        post_detach_to_message_thread();
    });

    message_window::run_message_loop();
}

/// WM_CLOSE handler on the message thread: un-parent the Folia window, then let the loop end.
#[cfg(windows)]
pub fn handle_detach_request() {
    if DETACH_REQUESTED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return; // already detached
    }
    unsafe {
        if let Some(hwnd) = monitor::resident_folia_hwnd() {
            match attach::detach_window(HWND(hwnd as _)) {
                Ok(()) => events::emit(&Event::Detached { hwnd }),
                Err(message) => events::emit(&Event::Error { message, kind: None }),
            }
        }
        // Repaint the WorkerW whether or not the window was still alive: an app-exit race can
        // destroy an attached window before this runs, and its last frame would otherwise stay
        // welded onto the desktop layer.
        if let Some(worker_w) = monitor::resident_worker_w() {
            attach::invalidate_window(HWND(worker_w as _));
        }
    }
}

#[cfg(windows)]
fn post_detach_to_message_thread() {
    if let Some(target) = message_window::hwnd() {
        use windows::Win32::Foundation::{LPARAM, WPARAM};
        use windows::Win32::UI::WindowsAndMessaging::{PostMessageW, WM_CLOSE};
        unsafe {
            let _ = PostMessageW(Some(target), WM_CLOSE, WPARAM::default(), LPARAM::default());
        }
    }
}
