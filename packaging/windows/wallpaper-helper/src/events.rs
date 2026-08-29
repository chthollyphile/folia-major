// packaging/windows/wallpaper-helper/src/events.rs
// JSONL event protocol spoken on stdout between the helper and the Electron main process
// (parsed by electron/windowsWallpaperController.cjs). Pure string building — no Win32 —
// so the snapshot-style unit tests below run on any host OS.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    /// Window is now parented into a WorkerW. `mode` is "classic" (sibling WorkerW) or
    /// "raised" (Windows 11 raised-desktop: WorkerW is a direct child of Progman).
    Attached { hwnd: isize, workerw: isize, mode: &'static str },
    /// Liveness probe for the main-process watchdog (every 5s while resident).
    Heartbeat,
    /// The WorkerW we parented into was destroyed; a re-attach attempt is starting.
    WorkerwDestroyed { hwnd: isize },
    /// Explorer restarted (Shell_TrayWnd PID changed); a re-attach attempt is starting.
    ExplorerRestarted,
    /// The z-order guard re-inserted the Folia window at the top of the WorkerW children.
    Reasserted { hwnd: isize },
    /// Geometry was re-applied (`move` subcommand or after re-attach).
    Moved { hwnd: isize },
    /// Detach completed: window un-parented from WorkerW, styles restored.
    Detached { hwnd: isize },
    /// Desktop mouse position update in 96-DPI virtualized screen pixels (the helper is
    /// DPI-unaware, which is exactly Electron's DIP space), coalesced to ~60 Hz and gated by
    /// the desktop-foreground filter (see mouse_forward.rs for why injection happens in the
    /// main process rather than via posted messages).
    MouseMove { x: i32, y: i32 },
    /// Primary (left) button press at the given position. Sent immediately, not coalesced.
    MouseButtonDown { x: i32, y: i32 },
    /// Primary button release. Sent even when the desktop is no longer foreground while the
    /// button is tracked as held, so the renderer can never keep a stuck pressed state.
    MouseButtonUp { x: i32, y: i32 },
    /// Wheel rotation at the given position while the desktop is the foreground window.
    /// Deltas are raw-input notches in multiples of WHEEL_DELTA (120; hi-res wheels send
    /// smaller per-packet increments) — positive vertical means rolled up/away from the user,
    /// positive horizontal means rolled right. Exactly one axis is non-zero per packet.
    MouseWheel { x: i32, y: i32, delta_x: i16, delta_y: i16 },
    /// Anything fatal or noteworthy that the main process should log or act on. `kind` is an
    /// optional structured error class the main process can branch on — the message text is
    /// for humans and must never be parsed (see ERR_KIND_WINDOW_DESTROYED).
    Error { message: String, kind: Option<&'static str> },
}

// Error kind: the Folia window was destroyed together with its WorkerW (e.g. after an explorer
// restart). The main process must rebuild the window instead of re-attaching the stale hwnd.
pub const ERR_KIND_WINDOW_DESTROYED: &str = "window-destroyed";

// Minimal JSON string escaping (subset of chars that can appear in our messages).
fn escape_json(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            control if (control as u32) < 0x20 => {
                escaped.push_str(&format!("\\u{:04x}", control as u32));
            }
            other => escaped.push(other),
        }
    }
    escaped
}

impl Event {
    #[allow(dead_code)] // protocol self-description; consumed by tests and future callers
    pub fn kind(&self) -> &'static str {
        match self {
            Event::Attached { .. } => "attached",
            Event::Heartbeat => "heartbeat",
            Event::WorkerwDestroyed { .. } => "workerw-destroyed",
            Event::ExplorerRestarted => "explorer-restarted",
            Event::Reasserted { .. } => "reasserted",
            Event::Moved { .. } => "moved",
            Event::Detached { .. } => "detached",
            Event::MouseMove { .. } => "mousemove",
            Event::MouseButtonDown { .. } => "mousedown",
            Event::MouseButtonUp { .. } => "mouseup",
            Event::MouseWheel { .. } => "mousewheel",
            Event::Error { .. } => "error",
        }
    }

    /// Single-line JSON object (no trailing newline).
    pub fn to_json(&self) -> String {
        match self {
            Event::Attached { hwnd, workerw, mode } => format!(
                "{{\"event\":\"attached\",\"hwnd\":{},\"workerw\":{},\"mode\":\"{}\"}}",
                hwnd, workerw, mode
            ),
            Event::Heartbeat => "{\"event\":\"heartbeat\"}".to_string(),
            Event::WorkerwDestroyed { hwnd } => {
                format!("{{\"event\":\"workerw-destroyed\",\"hwnd\":{}}}", hwnd)
            }
            Event::ExplorerRestarted => "{\"event\":\"explorer-restarted\"}".to_string(),
            Event::Reasserted { hwnd } => format!("{{\"event\":\"reasserted\",\"hwnd\":{}}}", hwnd),
            Event::Moved { hwnd } => format!("{{\"event\":\"moved\",\"hwnd\":{}}}", hwnd),
            Event::Detached { hwnd } => format!("{{\"event\":\"detached\",\"hwnd\":{}}}", hwnd),
            Event::MouseMove { x, y } => {
                format!("{{\"event\":\"mousemove\",\"x\":{x},\"y\":{y}}}")
            }
            Event::MouseButtonDown { x, y } => {
                format!("{{\"event\":\"mousedown\",\"x\":{x},\"y\":{y}}}")
            }
            Event::MouseButtonUp { x, y } => {
                format!("{{\"event\":\"mouseup\",\"x\":{x},\"y\":{y}}}")
            }
            Event::MouseWheel { x, y, delta_x, delta_y } => {
                format!("{{\"event\":\"mousewheel\",\"x\":{x},\"y\":{y},\"deltaX\":{delta_x},\"deltaY\":{delta_y}}}")
            }
            Event::Error { message, kind } => match kind {
                Some(kind) => format!(
                    "{{\"event\":\"error\",\"message\":\"{}\",\"kind\":\"{}\"}}",
                    escape_json(message),
                    kind
                ),
                None => format!(
                    "{{\"event\":\"error\",\"message\":\"{}\"}}",
                    escape_json(message)
                ),
            },
        }
    }
}

/// Writes one event line to stdout (JSONL protocol) and flushes immediately — the main
/// process parses these incrementally, so buffering would stall its watchdog.
pub fn emit(event: &Event) {
    use std::io::Write;
    let stdout = std::io::stdout();
    let mut lock = stdout.lock();
    let _ = writeln!(lock, "{}", event.to_json());
    let _ = lock.flush();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attached_snapshot() {
        let event = Event::Attached { hwnd: 111, workerw: 222, mode: "classic" };
        assert_eq!(
            event.to_json(),
            "{\"event\":\"attached\",\"hwnd\":111,\"workerw\":222,\"mode\":\"classic\"}"
        );
        assert_eq!(event.kind(), "attached");
    }

    #[test]
    fn scalar_events_snapshot() {
        assert_eq!(Event::Heartbeat.to_json(), "{\"event\":\"heartbeat\"}");
        assert_eq!(
            Event::WorkerwDestroyed { hwnd: 5 }.to_json(),
            "{\"event\":\"workerw-destroyed\",\"hwnd\":5}"
        );
        assert_eq!(
            Event::ExplorerRestarted.to_json(),
            "{\"event\":\"explorer-restarted\"}"
        );
        assert_eq!(
            Event::Reasserted { hwnd: 5 }.to_json(),
            "{\"event\":\"reasserted\",\"hwnd\":5}"
        );
        assert_eq!(Event::Moved { hwnd: 5 }.to_json(), "{\"event\":\"moved\",\"hwnd\":5}");
        assert_eq!(
            Event::Detached { hwnd: 5 }.to_json(),
            "{\"event\":\"detached\",\"hwnd\":5}"
        );
        assert_eq!(
            Event::MouseMove { x: 1920, y: 1080 }.to_json(),
            "{\"event\":\"mousemove\",\"x\":1920,\"y\":1080}"
        );
        assert_eq!(
            Event::MouseButtonDown { x: 10, y: 20 }.to_json(),
            "{\"event\":\"mousedown\",\"x\":10,\"y\":20}"
        );
        assert_eq!(
            Event::MouseButtonUp { x: 10, y: 20 }.to_json(),
            "{\"event\":\"mouseup\",\"x\":10,\"y\":20}"
        );
        assert_eq!(
            Event::MouseWheel { x: 30, y: 40, delta_x: 0, delta_y: -120 }.to_json(),
            "{\"event\":\"mousewheel\",\"x\":30,\"y\":40,\"deltaX\":0,\"deltaY\":-120}"
        );
    }

    #[test]
    fn error_message_is_escaped() {
        let event = Event::Error { message: "bad \"thing\"\nnext".to_string(), kind: None };
        assert_eq!(
            event.to_json(),
            "{\"event\":\"error\",\"message\":\"bad \\\"thing\\\"\\nnext\"}"
        );
    }

    #[test]
    fn error_kind_is_serialized_when_present() {
        let event = Event::Error {
            message: "folia window was destroyed together with the WorkerW".to_string(),
            kind: Some(ERR_KIND_WINDOW_DESTROYED),
        };
        assert_eq!(
            event.to_json(),
            "{\"event\":\"error\",\"message\":\"folia window was destroyed together with the WorkerW\",\"kind\":\"window-destroyed\"}"
        );
    }
}
