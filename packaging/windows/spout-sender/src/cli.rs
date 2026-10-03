// packaging/windows/spout-sender/src/cli.rs
// Pure command-line parsing for the Spout sender helper:
//   folia-spout-sender.exe --name "<sender name>" --parent-pid <electron main pid>
// No Win32 imports, so the unit tests at the bottom run on any host OS (`cargo test`).

use crate::sender_names::validate_sender_name;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Args {
    /// Requested Spout sender name (validated: 1..=255 bytes, no NUL, ASCII first byte).
    pub name: String,
    /// Electron main process id: frame handles are duplicated out of it and its death stops us.
    pub parent_pid: u32,
}

/// Parses `args` (argv without argv[0]). Both `--name X` and `--name=X` are accepted. Unknown
/// options, duplicates and missing values are errors so a typo in the Electron side is loud.
pub fn parse(args: &[String]) -> Result<Args, String> {
    let mut name: Option<String> = None;
    let mut parent_pid: Option<u32> = None;

    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        let (option, inline_value) = match arg.split_once('=') {
            Some((option, value)) => (option, Some(value.to_string())),
            None => (arg.as_str(), None),
        };
        if option != "--name" && option != "--parent-pid" {
            return Err(if option.starts_with("--") {
                format!("unknown option: {option}")
            } else {
                format!("unexpected argument: {arg}")
            });
        }
        let value = match inline_value {
            Some(value) => value,
            None => iter
                .next()
                .cloned()
                .ok_or_else(|| format!("missing value for {option}"))?,
        };
        match option {
            "--name" => {
                if name.replace(value).is_some() {
                    return Err("--name given more than once".to_string());
                }
            }
            _ => {
                let pid = value
                    .parse::<u32>()
                    .map_err(|_| format!("invalid --parent-pid: {value}"))?;
                if pid == 0 {
                    return Err("--parent-pid must be non-zero".to_string());
                }
                if parent_pid.replace(pid).is_some() {
                    return Err("--parent-pid given more than once".to_string());
                }
            }
        }
    }

    let name = name.ok_or_else(|| "missing required option --name".to_string())?;
    let parent_pid = parent_pid.ok_or_else(|| "missing required option --parent-pid".to_string())?;
    validate_sender_name(&name)?;
    Ok(Args { name, parent_pid })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| item.to_string()).collect()
    }

    #[test]
    fn parses_space_separated_form() {
        let parsed = parse(&args(&["--name", "Folia", "--parent-pid", "4242"])).unwrap();
        assert_eq!(parsed, Args { name: "Folia".to_string(), parent_pid: 4242 });
    }

    #[test]
    fn parses_equals_form_and_any_order() {
        let parsed = parse(&args(&["--parent-pid=7", "--name=My Sender"])).unwrap();
        assert_eq!(parsed, Args { name: "My Sender".to_string(), parent_pid: 7 });
    }

    #[test]
    fn name_may_contain_equals_signs() {
        let parsed = parse(&args(&["--name=a=b", "--parent-pid=1"])).unwrap();
        assert_eq!(parsed.name, "a=b");
    }

    #[test]
    fn rejects_missing_required_options() {
        assert!(parse(&args(&["--name", "Folia"])).unwrap_err().contains("--parent-pid"));
        assert!(parse(&args(&["--parent-pid", "1"])).unwrap_err().contains("--name"));
        assert!(parse(&args(&[])).is_err());
    }

    #[test]
    fn rejects_bad_values_and_unknown_options() {
        assert!(parse(&args(&["--name", "x", "--parent-pid", "abc"])).is_err());
        assert!(parse(&args(&["--name", "x", "--parent-pid", "0"])).is_err());
        assert!(parse(&args(&["--name", "x", "--parent-pid", "-3"])).is_err());
        assert!(parse(&args(&["--name", "x", "--parent-pid", "1", "--verbose"]))
            .unwrap_err()
            .contains("unknown option"));
        assert!(parse(&args(&["stray", "--name", "x", "--parent-pid", "1"])).is_err());
        assert!(parse(&args(&["--name"])).unwrap_err().contains("missing value"));
    }

    #[test]
    fn rejects_duplicates() {
        assert!(parse(&args(&["--name", "a", "--name", "b", "--parent-pid", "1"])).is_err());
        assert!(parse(&args(&["--name", "a", "--parent-pid", "1", "--parent-pid", "2"])).is_err());
    }

    #[test]
    fn rejects_unpublishable_names() {
        assert!(parse(&args(&["--name", "", "--parent-pid", "1"])).is_err());
        assert!(parse(&args(&["--name", &"x".repeat(256), "--parent-pid", "1"])).is_err());
        assert!(parse(&args(&["--name", "歌", "--parent-pid", "1"])).is_err());
    }
}
