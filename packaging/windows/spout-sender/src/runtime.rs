// packaging/windows/spout-sender/src/runtime.rs
// Windows-only process runtime: start the sender, then serve commands until told to stop.
// Two helper threads feed one channel — the stdin reader (commands, EOF = stop) and a
// parent-process watcher (parent died = stop) — and the main thread consumes it, so every
// `frame` is processed and answered strictly in order and all D3D / Spout state stays on a
// single thread.

use std::io::BufRead;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::mpsc;
use windows::Win32::Foundation::HANDLE;
use windows::Win32::System::Threading::{
    OpenProcess, WaitForSingleObject, INFINITE, PROCESS_DUP_HANDLE, PROCESS_SYNCHRONIZE,
};

use crate::cli::Args;
use crate::protocol::{emit, parse_command, Command, Event, FatalCode};
use crate::sender::{ParentProcess, SpoutSender};

/// Runs the helper and returns its exit code.
pub fn run(args: Args) -> i32 {
    // Frame handles are duplicated out of the parent, and its exit must stop us.
    let parent = match unsafe { OpenProcess(PROCESS_DUP_HANDLE | PROCESS_SYNCHRONIZE, false, args.parent_pid) } {
        Ok(handle) => ParentProcess { handle },
        Err(error) => {
            return fatal(FatalCode::BadArgs, format!("cannot open --parent-pid {}: {error}", args.parent_pid));
        }
    };

    let mut sender = match SpoutSender::start(&args.name, &parent) {
        Ok(sender) => sender,
        Err(error) => return fatal(error.code, error.message),
    };
    if emit(&Event::Ready { sender_name: args.name.clone() }).is_err() {
        return 0;
    }

    let (tx, rx) = mpsc::channel::<Command>();
    spawn_stdin_reader(tx.clone());
    spawn_parent_watcher(parent.handle.0 as isize, tx);

    for command in rx {
        match command {
            Command::Stop => break,
            Command::Frame(frame) => {
                // A panic must not skip unregistering the sender, so contain it per frame.
                let outcome = catch_unwind(AssertUnwindSafe(|| sender.handle_frame(&frame)))
                    .unwrap_or_else(|_| Err("internal error while copying the frame".to_string()));
                let event = match outcome {
                    Ok(()) => Event::Done { id: frame.id },
                    Err(message) => Event::FrameError { id: frame.id, message },
                };
                if emit(&event).is_err() {
                    break; // stdout closed: the parent is gone
                }
            }
            Command::Invalid { frame_id: Some(id), reason } => {
                if emit(&Event::FrameError { id, message: reason }).is_err() {
                    break;
                }
            }
            Command::Invalid { frame_id: None, reason } => eprintln!("[spout-sender] ignoring command: {reason}"),
        }
    }

    // Unregister the sender (Drop order in SpoutSender) before exiting. The parent handle stays
    // open: the watcher thread is still waiting on it and the OS reclaims it at process exit.
    drop(sender);
    0
}

fn fatal(code: FatalCode, message: String) -> i32 {
    eprintln!("[spout-sender] fatal: {message}");
    let _ = emit(&Event::Fatal { code, message });
    1
}

/// Forwards stdin lines as commands; EOF or a read error becomes `Stop`.
fn spawn_stdin_reader(tx: mpsc::Sender<Command>) {
    std::thread::spawn(move || {
        let stdin = std::io::stdin();
        for line in stdin.lock().lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            if tx.send(parse_command(&line)).is_err() {
                return;
            }
        }
        let _ = tx.send(Command::Stop);
    });
}

/// Sends `Stop` once the parent process terminates (its handle becomes signalled).
fn spawn_parent_watcher(parent_handle: isize, tx: mpsc::Sender<Command>) {
    std::thread::spawn(move || {
        let handle = HANDLE(parent_handle as *mut std::ffi::c_void);
        unsafe { WaitForSingleObject(handle, INFINITE) };
        let _ = tx.send(Command::Stop);
    });
}
