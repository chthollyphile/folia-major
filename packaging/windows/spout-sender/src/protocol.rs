// packaging/windows/spout-sender/src/protocol.rs
// JSON line protocol spoken with the Electron main process (see the Spout integration contract):
// stdin carries commands (`frame`, `stop`), stdout carries events (`ready`, `done`, `frameError`,
// `fatal`). One UTF-8 JSON object per line, camelCase keys. Pure parsing / serialisation — no
// Win32 — so the tests at the bottom run on any host OS.

use serde::{Deserialize, Serialize};
use std::io::Write;

/// Pixel format of the incoming Electron texture (textureInfo.pixelFormat).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PixelFormat {
    Bgra,
    Rgba,
}

/// `{"type":"frame",...}`: one Electron offscreen paint to copy into the Spout texture.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameCommand {
    pub id: u32,
    /// Decimal string of the u64 NT HANDLE value, valid in the parent (Electron main) process.
    pub handle: String,
    pub coded_width: u32,
    pub coded_height: u32,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub format: PixelFormat,
}

impl FrameCommand {
    /// The NT handle value as a pointer-sized integer; None for a non-decimal / zero handle.
    pub fn parent_handle(&self) -> Option<usize> {
        let value = self.handle.parse::<u64>().ok()?;
        if value == 0 {
            return None;
        }
        usize::try_from(value).ok()
    }
}

/// A parsed stdin line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    Frame(FrameCommand),
    Stop,
    /// Not a usable command. When the line was a `frame` whose id could still be read, `frame_id`
    /// is set so the caller can honour "every frame gets exactly one done or frameError".
    Invalid { frame_id: Option<u32>, reason: String },
}

/// Parses one stdin line. Never panics; blank lines and unknown command types are `Invalid`.
pub fn parse_command(line: &str) -> Command {
    let value: serde_json::Value = match serde_json::from_str(line.trim()) {
        Ok(value) => value,
        Err(error) => return Command::Invalid { frame_id: None, reason: format!("malformed JSON: {error}") },
    };
    match value.get("type").and_then(|kind| kind.as_str()) {
        Some("stop") => Command::Stop,
        Some("frame") => {
            let frame_id = value
                .get("id")
                .and_then(|id| id.as_u64())
                .and_then(|id| u32::try_from(id).ok());
            match serde_json::from_value::<FrameCommand>(value) {
                Ok(frame) => Command::Frame(frame),
                Err(error) => Command::Invalid { frame_id, reason: format!("bad frame command: {error}") },
            }
        }
        Some(other) => Command::Invalid { frame_id: None, reason: format!("unknown command type: {other}") },
        None => Command::Invalid { frame_id: None, reason: "missing command type".to_string() },
    }
}

/// Fatal error codes (exact strings from the contract).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum FatalCode {
    #[serde(rename = "name-in-use")]
    NameInUse,
    #[serde(rename = "d3d-init-failed")]
    D3dInitFailed,
    #[serde(rename = "spout-register-failed")]
    SpoutRegisterFailed,
    #[serde(rename = "bad-args")]
    BadArgs,
}

/// stdout events, helper -> Electron.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Event {
    /// Sender registered, waiting for frames.
    Ready { sender_name: String },
    /// Frame copied AND the GPU copy completed; Electron may release the texture now.
    Done { id: u32 },
    /// This frame failed; Electron releases the texture; the helper keeps running.
    FrameError { id: u32, message: String },
    /// The helper is about to exit non-zero.
    Fatal { code: FatalCode, message: String },
}

impl Event {
    pub fn to_line(&self) -> String {
        // Serialising plain strings / integers cannot fail.
        serde_json::to_string(self).expect("event serialisation")
    }
}

/// Writes one event line to stdout and flushes. An error means the pipe is gone (parent died).
pub fn emit(event: &Event) -> std::io::Result<()> {
    let stdout = std::io::stdout();
    let mut handle = stdout.lock();
    writeln!(handle, "{}", event.to_line())?;
    handle.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

    const FRAME_LINE: &str = r#"{"type":"frame","id":7,"handle":"1234567890123","codedWidth":1920,"codedHeight":1088,"x":0,"y":0,"width":1920,"height":1080,"format":"bgra"}"#;

    #[test]
    fn parses_a_frame_command() {
        let Command::Frame(frame) = parse_command(FRAME_LINE) else { panic!("not a frame") };
        assert_eq!(frame.id, 7);
        assert_eq!(frame.parent_handle(), Some(1_234_567_890_123));
        assert_eq!((frame.coded_width, frame.coded_height), (1920, 1088));
        assert_eq!((frame.x, frame.y, frame.width, frame.height), (0, 0, 1920, 1080));
        assert_eq!(frame.format, PixelFormat::Bgra);
    }

    #[test]
    fn parses_rgba_and_ignores_unknown_fields() {
        let line = FRAME_LINE.replace("\"bgra\"", "\"rgba\"").replace("\"x\":0", "\"x\":0,\"extra\":true");
        let Command::Frame(frame) = parse_command(&line) else { panic!("not a frame") };
        assert_eq!(frame.format, PixelFormat::Rgba);
    }

    #[test]
    fn handle_above_js_safe_integer_survives_as_a_string() {
        let line = FRAME_LINE.replace("1234567890123", "18446744073709551615");
        let Command::Frame(frame) = parse_command(&line) else { panic!("not a frame") };
        assert_eq!(frame.parent_handle(), usize::try_from(u64::MAX).ok());
    }

    #[test]
    fn rejects_zero_or_non_decimal_handles() {
        for handle in ["0", "abc", "-5", "", "0x10"] {
            let line = FRAME_LINE.replace("1234567890123", handle);
            let Command::Frame(frame) = parse_command(&line) else { panic!("not a frame") };
            assert_eq!(frame.parent_handle(), None, "handle {handle:?}");
        }
    }

    #[test]
    fn parses_stop() {
        assert_eq!(parse_command(r#"{"type":"stop"}"#), Command::Stop);
        assert_eq!(parse_command("  {\"type\":\"stop\"}\r\n"), Command::Stop);
    }

    #[test]
    fn frame_with_bad_fields_keeps_its_id_for_the_error_reply() {
        let line = r#"{"type":"frame","id":9,"handle":"5","format":"bgra"}"#;
        match parse_command(line) {
            Command::Invalid { frame_id, reason } => {
                assert_eq!(frame_id, Some(9));
                assert!(reason.contains("bad frame command"), "{reason}");
            }
            other => panic!("unexpected {other:?}"),
        }
        let unknown_format = FRAME_LINE.replace("\"bgra\"", "\"nv12\"");
        assert!(matches!(parse_command(&unknown_format), Command::Invalid { frame_id: Some(7), .. }));
    }

    #[test]
    fn garbage_is_invalid_without_an_id() {
        for line in ["", "not json", "[]", "{}", r#"{"type":"dance"}"#, r#"{"type":5}"#] {
            assert!(
                matches!(parse_command(line), Command::Invalid { frame_id: None, .. }),
                "line {line:?}"
            );
        }
        // id out of u32 range cannot be echoed back
        let big_id = r#"{"type":"frame","id":4294967296}"#;
        assert!(matches!(parse_command(big_id), Command::Invalid { frame_id: None, .. }));
    }

    #[test]
    fn events_serialise_to_the_contract_shapes() {
        assert_eq!(
            Event::Ready { sender_name: "Folia".to_string() }.to_line(),
            r#"{"type":"ready","senderName":"Folia"}"#
        );
        assert_eq!(Event::Done { id: 3 }.to_line(), r#"{"type":"done","id":3}"#);
        assert_eq!(
            Event::FrameError { id: 4, message: "bad \"x\"\n".to_string() }.to_line(),
            r#"{"type":"frameError","id":4,"message":"bad \"x\"\n"}"#
        );
        assert_eq!(
            Event::Fatal { code: FatalCode::NameInUse, message: "m".to_string() }.to_line(),
            r#"{"type":"fatal","code":"name-in-use","message":"m"}"#
        );
    }

    #[test]
    fn fatal_codes_are_the_exact_contract_strings() {
        let code = |code: FatalCode| serde_json::to_string(&code).unwrap();
        assert_eq!(code(FatalCode::NameInUse), "\"name-in-use\"");
        assert_eq!(code(FatalCode::D3dInitFailed), "\"d3d-init-failed\"");
        assert_eq!(code(FatalCode::SpoutRegisterFailed), "\"spout-register-failed\"");
        assert_eq!(code(FatalCode::BadArgs), "\"bad-args\"");
    }

    #[test]
    fn event_lines_are_single_line_even_with_non_ascii_and_newlines() {
        let line = Event::FrameError { id: 1, message: "歌词\r\nbreak".to_string() }.to_line();
        assert!(!line.contains('\n') && !line.contains('\r'));
    }
}
