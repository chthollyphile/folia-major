// packaging/windows/spout-sender/src/main.rs
// Folia Spout sender helper: publishes Electron offscreen-render shared textures as a Spout2
// sender so OBS (obs-spout2-plugin "Spout2 Capture") can capture Folia's overlay page as a GPU
// texture with alpha. Reproduces what a Spout 2.007 DirectX sender does (sender-name list,
// per-sender info map, active-sender map, texture access mutex) without linking the SDK.
// Protocol: JSONL commands on stdin, JSONL events on stdout, logs on stderr (see protocol.rs),
// driven by the Electron main process.
// Lifetime: exits 0 (after unregistering the sender) on stdin EOF, `{"type":"stop"}` or death of
// the --parent-pid process.

// Pure-logic modules are only exercised by the tests on non-Windows hosts.
#![cfg_attr(not(windows), allow(dead_code))]

mod cli;
mod protocol;
mod sender_names;
mod shared_info;

#[cfg(windows)]
mod frame_sync;
#[cfg(windows)]
mod gpu;
#[cfg(windows)]
mod runtime;
#[cfg(windows)]
mod sender;
#[cfg(windows)]
mod shared_memory;
#[cfg(windows)]
mod spout_registry;

use protocol::{emit, Event, FatalCode};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let parsed = match cli::parse(&args) {
        Ok(parsed) => parsed,
        Err(message) => {
            eprintln!("usage: folia-spout-sender --name <sender name> --parent-pid <pid>");
            eprintln!("error: {message}");
            let _ = emit(&Event::Fatal { code: FatalCode::BadArgs, message });
            std::process::exit(2);
        }
    };
    run(parsed);
}

fn run(args: cli::Args) {
    // Built only on/for Windows; the guard keeps `cargo test` working on other hosts.
    #[cfg(not(windows))]
    {
        let _ = args;
        eprintln!("folia-spout-sender only runs on Windows");
        std::process::exit(2);
    }

    #[cfg(windows)]
    std::process::exit(runtime::run(args));
}
