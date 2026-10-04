// packaging/windows/spout-sender/src/spout_registry.rs
// Windows-only port of the parts of spoutSenderNames (SpoutSenderNames.cpp) a DirectX sender
// uses: register the name in the shared "SpoutSenderNames" list, publish the per-sender
// SharedTextureInfo map, maintain the "ActiveSenderName" map, and unregister on exit. Lock
// ordering mirrors the SDK: the names-list mutex is the outer lock (RegisterSenderName /
// ReleaseSenderName take it, then touch the active-sender map inside it); the per-sender info
// map is only ever locked on its own, outside the list lock, exactly like UpdateSender.
// Deviations from the SDK, all deliberate:
//   * The info map is created and filled BEFORE the name is listed (the SDK lists first), so a
//     receiver or GetSenderCount can never observe a listed sender with no info map and drop it.
//   * A name whose info map already exists is a live sender: fail with NameInUse instead of the
//     SDK's silent `name_1` increment (the Electron contract reports `name-in-use`).
//   * A full list or a lock timeout is an error (the SDK silently skips registration).

use windows::core::PCSTR;
use windows::Win32::Foundation::ERROR_SUCCESS;
use windows::Win32::System::Registry::{RegGetValueA, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};

use crate::shared_info::{SharedTextureInfo, SHARED_TEXTURE_INFO_SIZE};
use crate::shared_memory::SharedMemory;
use crate::sender_names::{
    names_map_size, read_sender_set, resolve_max_senders, write_active_sender, write_sender_set, SLOT_LEN,
};

const SENDER_NAMES_MAP: &str = "SpoutSenderNames";
const ACTIVE_SENDER_MAP: &str = "ActiveSenderName";
const SPOUT_REGISTRY_KEY: &[u8] = b"Software\\Leading Edge\\Spout\0";

/// The names-list mutex is contended only briefly; retry a few SDK-length (67 ms) waits before
/// giving up, because failing here aborts the whole feature.
const LIST_LOCK_ATTEMPTS: u32 = 8;

#[derive(Debug)]
pub enum RegisterError {
    /// A live sender with this name already exists.
    NameInUse,
    Failed(String),
}

/// Reads a DWORD from HKCU\Software\Leading Edge\Spout (None when absent or not a DWORD).
pub fn read_spout_dword(value_name: &str) -> Option<u32> {
    let value_c = std::ffi::CString::new(value_name).ok()?;
    let mut data = 0u32;
    let mut size = std::mem::size_of::<u32>() as u32;
    let status = unsafe {
        RegGetValueA(
            HKEY_CURRENT_USER,
            PCSTR(SPOUT_REGISTRY_KEY.as_ptr()),
            PCSTR(value_c.as_ptr() as *const u8),
            RRF_RT_REG_DWORD,
            None,
            Some(&mut data as *mut u32 as *mut _),
            Some(&mut size),
        )
    };
    (status == ERROR_SUCCESS).then_some(data)
}

pub struct SenderRegistry {
    // Field order is drop order: the name is unregistered (Drop below) before the handles close.
    name: String,
    /// Capacity of the list as visible through the mapping (registry MaxSenders, clamped).
    capacity: usize,
    names: SharedMemory,
    active: Option<SharedMemory>,
    info: Option<SharedMemory>,
    registered: bool,
}

impl SenderRegistry {
    /// Creates the sender's info map (filled with `info`), lists the name and makes it the
    /// active sender, as SpoutDX::CreateSender -> RegisterSenderName/UpdateSender would.
    pub fn register(name: &str, info: &SharedTextureInfo) -> Result<Self, RegisterError> {
        let max_senders = resolve_max_senders(read_spout_dword("MaxSenders"));
        let (names, _) = SharedMemory::create(SENDER_NAMES_MAP, names_map_size(max_senders))
            .map_err(|error| RegisterError::Failed(format!("sender list unavailable: {error}")))?;
        let capacity = max_senders.min(names.len() / SLOT_LEN);

        // An existing mapping of this name means a live sender holds it (mappings die with their
        // last handle, so a crashed sender's leftover list entry has no map).
        let (mut info_map, already_existed) = SharedMemory::create(name, SHARED_TEXTURE_INFO_SIZE)
            .map_err(|error| RegisterError::Failed(format!("sender info map unavailable: {error}")))?;
        if already_existed {
            return Err(RegisterError::NameInUse);
        }
        write_info(&mut info_map, info).map_err(RegisterError::Failed)?;

        let mut registry = Self {
            name: name.to_string(),
            capacity,
            names,
            active: None,
            info: Some(info_map),
            registered: false,
        };
        registry.list_name()?;
        Ok(registry)
    }

    /// Rewrites the sender's info map (texture recreated: new size and/or share handle).
    pub fn update_info(&mut self, info: &SharedTextureInfo) -> Result<(), String> {
        match self.info.as_mut() {
            Some(info_map) => write_info(info_map, info),
            None => Err("sender info map is closed".to_string()),
        }
    }

    /// RegisterSenderName: insert into the list under the list lock, then set the active sender.
    fn list_name(&mut self) -> Result<(), RegisterError> {
        let name_bytes = self.name.as_bytes().to_vec();
        let capacity = self.capacity;
        let active = &mut self.active;
        let outcome = with_list_lock(&mut self.names, |buffer| -> Result<(), RegisterError> {
            let mut names = read_sender_set(buffer, capacity);
            if !names.contains(&name_bytes) && names.len() >= capacity {
                // cleanSenderSet: drop entries whose info map no longer exists, then re-check.
                names.retain(|entry| sender_map_exists(entry));
                if names.len() >= capacity {
                    return Err(RegisterError::Failed(format!("Spout sender list is full ({capacity} senders)")));
                }
            }
            names.insert(name_bytes.clone());
            write_sender_set(&names, buffer, capacity);
            // setActiveSenderName runs inside the list lock, as SetActiveSender does.
            if let Err(error) = set_active_sender(active, &name_bytes) {
                eprintln!("[spout-sender] could not set active sender: {error}");
            }
            Ok(())
        });
        match outcome {
            Some(result) => {
                result?;
                self.registered = true;
                Ok(())
            }
            None => Err(RegisterError::Failed("timed out locking the Spout sender list".to_string())),
        }
    }

    /// ReleaseSenderName: under the list lock close the info map, remove the name and, if it was
    /// the active sender (or the only one left), promote the first remaining sender.
    fn unregister(&mut self) {
        if !self.registered {
            self.info = None;
            return;
        }
        let name_bytes = self.name.as_bytes().to_vec();
        let capacity = self.capacity;
        let info = &mut self.info;
        let active = &mut self.active;
        let outcome = with_list_lock(&mut self.names, |buffer| {
            // Closing our handle destroys the map once no receiver still holds it.
            *info = None;
            let mut names = read_sender_set(buffer, capacity);
            if !names.remove(&name_bytes) {
                return;
            }
            write_sender_set(&names, buffer, capacity);
            if let Some(first) = names.iter().next() {
                let was_active = read_active_sender(active).is_some_and(|current| current == name_bytes);
                if was_active || names.len() == 1 {
                    if let Err(error) = set_active_sender(active, first) {
                        eprintln!("[spout-sender] could not promote active sender: {error}");
                    }
                }
            }
        });
        if outcome.is_none() {
            // Leave a stale list entry; SDK clients prune names with no info map on their own.
            eprintln!("[spout-sender] timed out locking the Spout sender list during unregister");
            self.info = None;
        }
        self.registered = false;
    }
}

impl Drop for SenderRegistry {
    fn drop(&mut self) {
        self.unregister();
    }
}

fn write_info(info_map: &mut SharedMemory, info: &SharedTextureInfo) -> Result<(), String> {
    let bytes = info.to_bytes();
    info_map
        .with_lock(|buffer| buffer[..SHARED_TEXTURE_INFO_SIZE].copy_from_slice(&bytes))
        .ok_or_else(|| "timed out locking the sender info map".to_string())
}

/// Locks the names list, retrying a few times before reporting a timeout (None).
fn with_list_lock<R>(names: &mut SharedMemory, mut f: impl FnMut(&mut [u8]) -> R) -> Option<R> {
    for _ in 0..LIST_LOCK_ATTEMPTS {
        if let Some(result) = names.with_lock(&mut f) {
            return Some(result);
        }
    }
    None
}

/// True when a process currently holds a mapping with this (raw byte) sender name.
fn sender_map_exists(raw_name: &[u8]) -> bool {
    match std::str::from_utf8(raw_name) {
        Ok(name) => SharedMemory::open(name).is_some(),
        // Names are written as raw bytes; a non-UTF-8 entry from an ANSI-codepage sender cannot be
        // probed through the &str API, so keep it rather than risk dropping a live sender.
        Err(_) => true,
    }
}

/// setActiveSenderName: write `name` into the shared "ActiveSenderName" map (created on demand).
fn set_active_sender(active: &mut Option<SharedMemory>, name: &[u8]) -> Result<(), String> {
    if active.is_none() {
        let (map, _) = SharedMemory::create(ACTIVE_SENDER_MAP, SLOT_LEN)?;
        *active = Some(map);
    }
    let map = active.as_mut().expect("active map just created");
    let wrote = map
        .with_lock(|buffer| write_active_sender(buffer, name))
        .ok_or_else(|| "timed out locking the active sender map".to_string())?;
    if wrote {
        Ok(())
    } else {
        Err("active sender name does not fit".to_string())
    }
}

/// getActiveSenderName: the NUL-terminated name currently in the "ActiveSenderName" map.
fn read_active_sender(active: &mut Option<SharedMemory>) -> Option<Vec<u8>> {
    if active.is_none() {
        *active = SharedMemory::open(ACTIVE_SENDER_MAP);
    }
    let map = active.as_mut()?;
    map.with_lock(|buffer| {
        let end = buffer[..SLOT_LEN].iter().position(|&byte| byte == 0).unwrap_or(SLOT_LEN);
        buffer[..end].to_vec()
    })
}
