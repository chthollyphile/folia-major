// packaging/windows/spout-sender/src/shared_info.rs
// Pure byte layout of Spout's per-sender SharedTextureInfo (spoutSenderNames.h, 280 bytes),
// the structure receivers read from the shared-memory map named after the sender to learn the
// texture's share handle, size and format. All fields are uint32 / uint8 so there is no padding;
// integers are little-endian (x86/x64 Windows).

pub const SHARED_TEXTURE_INFO_SIZE: usize = 280;
const DESCRIPTION_LEN: usize = 256;

// Offsets within the 280-byte structure.
const OFFSET_SHARE_HANDLE: usize = 0;
const OFFSET_WIDTH: usize = 4;
const OFFSET_HEIGHT: usize = 8;
const OFFSET_FORMAT: usize = 12;
const OFFSET_USAGE: usize = 16;
const OFFSET_DESCRIPTION: usize = 20;
const OFFSET_PARTNER_ID: usize = OFFSET_DESCRIPTION + DESCRIPTION_LEN;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SharedTextureInfo {
    /// Legacy DXGI shared handle value truncated to 32 bits (HandleToLong).
    pub share_handle: u32,
    pub width: u32,
    pub height: u32,
    /// DXGI_FORMAT value; 87 = DXGI_FORMAT_B8G8R8A8_UNORM for a DirectX 11 sender.
    pub format: u32,
    /// Unused by the SDK (always 0).
    pub usage: u32,
    /// Host executable path, NUL terminated (SDK SetSenderInfo stores QueryFullProcessImageName).
    pub description: [u8; DESCRIPTION_LEN],
    /// Top two bits flag CPU-sharing / GL-DX compatibility; 0 = plain GPU texture share.
    pub partner_id: u32,
}

impl SharedTextureInfo {
    pub fn new(share_handle: u32, width: u32, height: u32, format: u32, host_path: &str) -> Self {
        Self {
            share_handle,
            width,
            height,
            format,
            usage: 0,
            description: encode_description(host_path),
            partner_id: 0,
        }
    }

    pub fn to_bytes(&self) -> [u8; SHARED_TEXTURE_INFO_SIZE] {
        let mut bytes = [0u8; SHARED_TEXTURE_INFO_SIZE];
        bytes[OFFSET_SHARE_HANDLE..OFFSET_SHARE_HANDLE + 4].copy_from_slice(&self.share_handle.to_le_bytes());
        bytes[OFFSET_WIDTH..OFFSET_WIDTH + 4].copy_from_slice(&self.width.to_le_bytes());
        bytes[OFFSET_HEIGHT..OFFSET_HEIGHT + 4].copy_from_slice(&self.height.to_le_bytes());
        bytes[OFFSET_FORMAT..OFFSET_FORMAT + 4].copy_from_slice(&self.format.to_le_bytes());
        bytes[OFFSET_USAGE..OFFSET_USAGE + 4].copy_from_slice(&self.usage.to_le_bytes());
        bytes[OFFSET_DESCRIPTION..OFFSET_DESCRIPTION + DESCRIPTION_LEN].copy_from_slice(&self.description);
        bytes[OFFSET_PARTNER_ID..OFFSET_PARTNER_ID + 4].copy_from_slice(&self.partner_id.to_le_bytes());
        bytes
    }

    /// Decodes a map's bytes; used by the tests to prove `to_bytes` round-trips.
    #[cfg(test)]
    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < SHARED_TEXTURE_INFO_SIZE {
            return None;
        }
        let read_u32 = |offset: usize| u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
        let mut description = [0u8; DESCRIPTION_LEN];
        description.copy_from_slice(&bytes[OFFSET_DESCRIPTION..OFFSET_DESCRIPTION + DESCRIPTION_LEN]);
        Some(Self {
            share_handle: read_u32(OFFSET_SHARE_HANDLE),
            width: read_u32(OFFSET_WIDTH),
            height: read_u32(OFFSET_HEIGHT),
            format: read_u32(OFFSET_FORMAT),
            usage: read_u32(OFFSET_USAGE),
            description,
            partner_id: read_u32(OFFSET_PARTNER_ID),
        })
    }
}

/// Truncates `path` to 255 bytes on a character boundary and NUL terminates it.
fn encode_description(path: &str) -> [u8; DESCRIPTION_LEN] {
    let mut end = path.len().min(DESCRIPTION_LEN - 1);
    while !path.is_char_boundary(end) {
        end -= 1;
    }
    let mut description = [0u8; DESCRIPTION_LEN];
    description[..end].copy_from_slice(&path.as_bytes()[..end]);
    description
}

/// Win32 HandleToLong: legacy DXGI shared handles are global 32-bit values, so the SDK stores the
/// low 32 bits (sign-extension is irrelevant, the value round-trips through LongToHandle).
pub fn handle_to_u32(handle: isize) -> u32 {
    handle as i32 as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_is_280_bytes_with_sdk_offsets() {
        let mut info = SharedTextureInfo::new(0x1122_3344, 1920, 1080, 87, "C:\\Folia\\helper.exe");
        info.usage = 9;
        info.partner_id = 0xC000_0000;
        let bytes = info.to_bytes();
        assert_eq!(bytes.len(), 280);
        assert_eq!(&bytes[0..4], &[0x44, 0x33, 0x22, 0x11]);
        assert_eq!(u32::from_le_bytes(bytes[4..8].try_into().unwrap()), 1920);
        assert_eq!(u32::from_le_bytes(bytes[8..12].try_into().unwrap()), 1080);
        assert_eq!(u32::from_le_bytes(bytes[12..16].try_into().unwrap()), 87);
        assert_eq!(u32::from_le_bytes(bytes[16..20].try_into().unwrap()), 9);
        assert_eq!(&bytes[20..39], b"C:\\Folia\\helper.exe");
        assert_eq!(bytes[39], 0);
        assert_eq!(u32::from_le_bytes(bytes[276..280].try_into().unwrap()), 0xC000_0000);
    }

    #[test]
    fn round_trips_through_bytes() {
        let info = SharedTextureInfo::new(0xDEAD_BEEF, 3840, 2160, 87, "host.exe");
        assert_eq!(SharedTextureInfo::from_bytes(&info.to_bytes()), Some(info));
    }

    #[test]
    fn from_bytes_rejects_short_input() {
        assert!(SharedTextureInfo::from_bytes(&[0u8; 279]).is_none());
        assert!(SharedTextureInfo::from_bytes(&[0u8; 280]).is_some());
    }

    #[test]
    fn description_is_truncated_on_a_char_boundary_and_terminated() {
        let long = "歌".repeat(100); // 300 bytes, 3 bytes per char
        let info = SharedTextureInfo::new(1, 1, 1, 87, &long);
        let end = info.description.iter().position(|&byte| byte == 0).unwrap();
        assert!(end <= 255);
        assert!(std::str::from_utf8(&info.description[..end]).is_ok());
        assert_eq!(end, 255); // 85 whole characters
    }

    #[test]
    fn handle_truncates_like_handle_to_long() {
        assert_eq!(handle_to_u32(0x1234), 0x1234);
        assert_eq!(handle_to_u32(0x1_0000_0042), 0x42);
        assert_eq!(handle_to_u32(-1), 0xFFFF_FFFF);
    }
}
