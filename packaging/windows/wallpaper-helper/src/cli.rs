// packaging/windows/wallpaper-helper/src/cli.rs
// Pure command-line parsing for the wallpaper helper. No Win32 imports, so the unit tests at the
// bottom of this file run on any host OS (see `cargo test`) — the Windows-dependent code paths
// live in attach.rs / monitor.rs / mouse_forward.rs and are cfg-gated to Windows.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    /// Resident mode: attach the Folia window into the WorkerW layer, then keep monitoring
    /// (heartbeat, z-order guard, explorer restarts) until a `detach` line arrives on stdin.
    Attach {
        hwnd: isize,
        forward_mouse: bool,
        zguard: bool,
    },
    /// One-shot: re-assert the window geometry to fill the monitor it currently sits on
    /// (used by the main process on display change / resolution change).
    Move { hwnd: isize },
    /// One-shot fallback: un-parent the window from WorkerW and restore normal styles.
    /// The resident attach process also accepts `detach` on stdin; this subcommand exists
    /// for the case where the resident helper is hung or was killed first.
    Detach { hwnd: isize },
}

fn parse_isize(value: &str) -> Result<isize, String> {
    value
        .parse::<isize>()
        .map_err(|_| format!("invalid integer value: {value}"))
}

/// Parses `args` (already stripped of argv[0] and the command name is expected first).
pub fn parse(args: &[String]) -> Result<Command, String> {
    let Some(command) = args.first() else {
        return Err("missing command (attach | move | detach)".to_string());
    };

    // Collect flags as (name, Option<value>) pairs; both `--hwnd 12` and `--hwnd=12` are accepted.
    let mut options: Vec<(String, Option<String>)> = Vec::new();
    let mut iter = args[1..].iter();
    while let Some(arg) = iter.next() {
        let (name, inline_value) = match arg.split_once('=') {
            Some((name, value)) => (name.to_string(), Some(value.to_string())),
            None => (arg.clone(), None),
        };
        if !name.starts_with("--") {
            return Err(format!("unexpected argument: {arg}"));
        }
        if inline_value.is_none() && name == "--hwnd" {
            // Value-taking options also accept the space-separated form.
            match iter.next() {
                Some(value) => options.push((name, Some(value.clone()))),
                None => return Err(format!("missing value for {name}")),
            }
        } else {
            options.push((name, inline_value));
        }
    }

    let take_flag = |name: &str, default: bool| -> Result<bool, String> {
        let present = options.iter().find(|(key, _)| key == name);
        match present {
            Some((_, value)) => match value.as_deref() {
                None | Some("true") | Some("1") => Ok(true),
                Some("false") | Some("0") => Ok(false),
                Some(other) => Err(format!("invalid boolean for {name}: {other}")),
            },
            None => Ok(default),
        }
    };

    let take_hwnd = || -> Result<isize, String> {
        let value = options
            .iter()
            .find(|(key, _)| key == "--hwnd")
            .map(|(_, value)| value.clone().unwrap_or_default());
        match value {
            Some(value) => parse_isize(&value),
            None => Err("missing required option --hwnd <n>".to_string()),
        }
    };

    match command.as_str() {
        "attach" => Ok(Command::Attach {
            hwnd: take_hwnd()?,
            forward_mouse: take_flag("--forward-mouse", false)?,
            zguard: take_flag("--zguard", false)?,
        }),
        "move" => Ok(Command::Move { hwnd: take_hwnd()? }),
        "detach" => Ok(Command::Detach { hwnd: take_hwnd()? }),
        other => Err(format!("unknown command: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parses_attach_with_flags() {
        let command = parse(&args(&["attach", "--hwnd", "12345", "--forward-mouse", "--zguard"])).unwrap();
        assert_eq!(
            command,
            Command::Attach {
                hwnd: 12345,
                forward_mouse: true,
                zguard: true,
            }
        );
    }

    #[test]
    fn attach_defaults_are_false() {
        let command = parse(&args(&["attach", "--hwnd=42"])).unwrap();
        assert_eq!(
            command,
            Command::Attach {
                hwnd: 42,
                forward_mouse: false,
                zguard: false,
            }
        );
    }

    #[test]
    fn attach_accepts_explicit_false() {
        let command = parse(&args(&["attach", "--hwnd=42", "--forward-mouse=false"])).unwrap();
        assert_eq!(
            command,
            Command::Attach {
                hwnd: 42,
                forward_mouse: false,
                zguard: false,
            }
        );
    }

    #[test]
    fn parses_move_and_detach() {
        assert_eq!(parse(&args(&["move", "--hwnd", "7"])).unwrap(), Command::Move { hwnd: 7 });
        assert_eq!(
            parse(&args(&["detach", "--hwnd=9"])).unwrap(),
            Command::Detach { hwnd: 9 }
        );
    }

    #[test]
    fn rejects_missing_or_bad_input() {
        assert!(parse(&args(&[])).is_err());
        assert!(parse(&args(&["attach"])).is_err());
        assert!(parse(&args(&["attach", "--hwnd", "abc"])).is_err());
        assert!(parse(&args(&["attach", "--hwnd", "1", "stray"])).is_err());
        assert!(parse(&args(&["frobnicate", "--hwnd", "1"])).is_err());
        assert!(parse(&args(&["attach", "--hwnd"])).is_err());
    }
}
