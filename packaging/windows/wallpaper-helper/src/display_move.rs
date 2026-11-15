// Resident display changes keep the same HWND and renderer/audio session.
#[derive(Debug, PartialEq, Eq)]
pub struct Request { pub id: u64, pub x: i32, pub y: i32, pub width: i32, pub height: i32 }

pub fn parse(line: &str) -> Option<Request> {
    let parts: Vec<_> = line.split_whitespace().collect();
    if parts.len() != 6 || parts[0] != "relocate" { return None; }
    let request = Request { id: parts[1].parse().ok()?, x: parts[2].parse().ok()?,
        y: parts[3].parse().ok()?, width: parts[4].parse().ok()?, height: parts[5].parse().ok()? };
    if request.width <= 0 || request.height <= 0 { return None; }
    request.x.checked_add(request.width)?;
    request.y.checked_add(request.height)?;
    Some(request)
}

#[cfg(windows)]
static REQUESTS: std::sync::Mutex<std::collections::VecDeque<Request>> = std::sync::Mutex::new(std::collections::VecDeque::new());
#[cfg(windows)]
pub const MESSAGE: u32 = 0x8001;

#[cfg(windows)]
pub fn submit(request: Request) {
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::PostMessageW;
    let id = request.id;
    let mut queue = REQUESTS.lock().unwrap();
    queue.push_back(request);
    let posted = crate::message_window::hwnd().map(|hwnd| unsafe {
        PostMessageW(Some(hwnd), MESSAGE, WPARAM::default(), LPARAM::default()).is_ok()
    }).unwrap_or(false);
    if !posted {
        queue.pop_back();
        crate::events::emit(&crate::events::Event::DisplayMoved { request_id: id, error: Some("Cannot post display move".into()) });
    }
}

#[cfg(windows)]
pub unsafe fn handle() {
    let request = REQUESTS.lock().unwrap().pop_front();
    if let Some(request) = request {
        let result = crate::monitor::relocate(&request);
        crate::events::emit(&crate::events::Event::DisplayMoved { request_id: request.id, error: result.err() });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn validates_physical_rectangles() {
        assert_eq!(parse("relocate 7 -1600 -648 1600 2560"), Some(Request {id:7,x:-1600,y:-648,width:1600,height:2560}));
        for value in ["relocate 1 0 0 0 20", "relocate 1 2147483647 0 2 20", "relocate 1 0 0 2 -1", "relocate 1 0 0 20 20 extra"] {
            assert!(parse(value).is_none());
        }
    }
}
