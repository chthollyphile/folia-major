// packaging/windows/spout-sender/src/sender_names.rs
// Pure (no Win32) model of the Spout 2.007 "SpoutSenderNames" shared-memory list and the object
// names derived from a sender name. Reproduces spoutSenderNames::readSenderSetFromBuffer /
// writeBufferFromSenderSet byte for byte so OBS's obs-spout2-plugin and SpoutReceiver (which
// parse this buffer with the SDK code) see exactly what an SDK sender would have written.
// The Windows-only code that owns the actual file mappings lives in shared_memory.rs /
// registry_lists.rs; keeping the byte-level rules here lets them be unit-tested on any host.

use std::collections::BTreeSet;

/// Every name occupies a fixed 256-byte slot (SpoutMaxSenderNameLen), NUL terminated.
pub const SLOT_LEN: usize = 256;
/// Longest name that still fits a slot together with its NUL terminator.
pub const MAX_NAME_BYTES: usize = SLOT_LEN - 1;
/// SDK default for HKCU\Software\Leading Edge\Spout\MaxSenders when the value is absent.
pub const DEFAULT_MAX_SENDERS: usize = 64;
/// Sanity ceiling for a garbage registry value (a 4096-slot map is already 1 MiB).
const MAX_SENDERS_CEILING: usize = 4096;

/// Why a sender name cannot be published through the Spout sender list.
pub fn validate_sender_name(name: &str) -> Result<(), String> {
    let bytes = name.as_bytes();
    if bytes.is_empty() {
        return Err("sender name is empty".to_string());
    }
    if bytes.len() > MAX_NAME_BYTES {
        return Err(format!(
            "sender name is {} bytes, the Spout limit is {MAX_NAME_BYTES}",
            bytes.len()
        ));
    }
    if bytes.contains(&0) {
        return Err("sender name contains a NUL byte".to_string());
    }
    // The SDK reader (readSenderSetFromBuffer) stops at the first slot whose first `char` is not
    // > 0. `char` is signed on MSVC, so a name starting with a byte >= 0x80 reads as the list
    // terminator and every receiver would silently lose this sender (and all names sorted after
    // it). Refuse it instead of publishing an invisible sender.
    if bytes[0] >= 0x80 {
        return Err(
            "sender name must start with an ASCII character (Spout receivers cannot list names \
             whose first byte is >= 0x80)"
                .to_string(),
        );
    }
    Ok(())
}

/// Resolves the effective sender-list capacity from the optional registry DWORD. Absent or zero
/// falls back to the SDK default; an absurdly large value is capped.
pub fn resolve_max_senders(registry_value: Option<u32>) -> usize {
    match registry_value {
        None | Some(0) => DEFAULT_MAX_SENDERS,
        Some(value) => (value as usize).min(MAX_SENDERS_CEILING),
    }
}

/// Size in bytes of the "SpoutSenderNames" mapping for a given capacity.
pub fn names_map_size(max_senders: usize) -> usize {
    max_senders * SLOT_LEN
}

/// Parses the name list: slots are read until the first one whose first byte is not 1..=127
/// (end of list) or `max_senders` slots were consumed. Mirrors readSenderSetFromBuffer.
pub fn read_sender_set(buffer: &[u8], max_senders: usize) -> BTreeSet<Vec<u8>> {
    let mut names = BTreeSet::new();
    let capacity = max_senders.min(buffer.len() / SLOT_LEN);
    for slot in buffer.chunks_exact(SLOT_LEN).take(capacity) {
        // signed-char `name[0] > 0` in the SDK
        if slot[0] == 0 || slot[0] >= 0x80 {
            break;
        }
        let end = slot[..MAX_NAME_BYTES]
            .iter()
            .position(|&byte| byte == 0)
            .unwrap_or(MAX_NAME_BYTES);
        names.insert(slot[..end].to_vec());
    }
    names
}

/// Serialises the name list: names in `std::set<std::string>` order (bytewise ascending), one per
/// 256-byte slot, then a NUL first byte in the next slot when the list is not full. Mirrors
/// writeBufferFromSenderSet (the SDK leaves stale bytes after each NUL; zero-filling the tail of
/// the slot is equivalent for every reader because they stop at the NUL).
pub fn write_sender_set(names: &BTreeSet<Vec<u8>>, buffer: &mut [u8], max_senders: usize) {
    let capacity = max_senders.min(buffer.len() / SLOT_LEN);
    let mut written = 0;
    for name in names {
        if written >= capacity {
            break;
        }
        let slot = &mut buffer[written * SLOT_LEN..(written + 1) * SLOT_LEN];
        slot.fill(0);
        let len = name.len().min(MAX_NAME_BYTES);
        slot[..len].copy_from_slice(&name[..len]);
        written += 1;
    }
    if written < capacity {
        buffer[written * SLOT_LEN] = 0;
    }
}

/// Writes the NUL-terminated active-sender name into its 256-byte "ActiveSenderName" mapping
/// (setActiveSenderName: memcpy(name, len + 1)). Returns false for an empty / oversized name.
pub fn write_active_sender(buffer: &mut [u8], name: &[u8]) -> bool {
    if name.is_empty() || name.len() + 1 > SLOT_LEN || buffer.len() < name.len() + 1 {
        return false;
    }
    buffer[..name.len()].copy_from_slice(name);
    buffer[name.len()] = 0;
    true
}

/// Name of the named mutex guarding a shared-memory map: "<map name>_mutex"
/// (SpoutSharedMemory::Create/Open).
pub fn map_mutex_name(map_name: &str) -> String {
    format!("{map_name}_mutex")
}

/// Texture access mutex a sender holds while writing the shared texture
/// (spoutFrameCount::CreateAccessMutex).
pub fn access_mutex_name(sender_name: &str) -> String {
    format!("{sender_name}_SpoutAccessMutex")
}

/// Frame counter semaphore name (spoutFrameCount::EnableFrameCount).
pub fn count_semaphore_name(sender_name: &str) -> String {
    format!("{sender_name}_Count_Semaphore")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(names: &[&str]) -> BTreeSet<Vec<u8>> {
        names.iter().map(|name| name.as_bytes().to_vec()).collect()
    }

    #[test]
    fn validate_accepts_plain_and_boundary_names() {
        assert!(validate_sender_name("Folia").is_ok());
        assert!(validate_sender_name("a").is_ok());
        assert!(validate_sender_name(&"x".repeat(255)).is_ok());
        // Non-ASCII is fine as long as it is not the first byte.
        assert!(validate_sender_name("Folia 歌词").is_ok());
    }

    #[test]
    fn validate_rejects_unpublishable_names() {
        assert!(validate_sender_name("").is_err());
        assert!(validate_sender_name(&"x".repeat(256)).is_err());
        assert!(validate_sender_name("a\0b").is_err());
        assert!(validate_sender_name("歌词").is_err());
    }

    #[test]
    fn max_senders_falls_back_and_caps() {
        assert_eq!(resolve_max_senders(None), 64);
        assert_eq!(resolve_max_senders(Some(0)), 64);
        assert_eq!(resolve_max_senders(Some(10)), 10);
        assert_eq!(resolve_max_senders(Some(256)), 256);
        assert_eq!(resolve_max_senders(Some(u32::MAX)), 4096);
        assert_eq!(names_map_size(64), 16384);
    }

    #[test]
    fn write_then_read_round_trips_sorted() {
        let mut buffer = vec![0xAAu8; names_map_size(8)];
        write_sender_set(&set(&["Zeta", "Alpha", "Folia"]), &mut buffer, 8);
        // Slots are in bytewise order and NUL padded.
        assert_eq!(&buffer[..5], b"Alpha");
        assert_eq!(buffer[5], 0);
        assert_eq!(&buffer[SLOT_LEN..SLOT_LEN + 5], b"Folia");
        assert_eq!(&buffer[2 * SLOT_LEN..2 * SLOT_LEN + 4], b"Zeta");
        // List terminator in the first free slot.
        assert_eq!(buffer[3 * SLOT_LEN], 0);
        let read = read_sender_set(&buffer, 8);
        assert_eq!(read, set(&["Alpha", "Folia", "Zeta"]));
    }

    #[test]
    fn empty_set_writes_a_terminator_and_reads_back_empty() {
        let mut buffer = vec![0xAAu8; names_map_size(4)];
        write_sender_set(&BTreeSet::new(), &mut buffer, 4);
        assert_eq!(buffer[0], 0);
        assert!(read_sender_set(&buffer, 4).is_empty());
    }

    #[test]
    fn full_list_has_no_terminator_and_reads_exactly_max() {
        let mut buffer = vec![0u8; names_map_size(2)];
        write_sender_set(&set(&["a", "b", "c"]), &mut buffer, 2);
        let read = read_sender_set(&buffer, 2);
        assert_eq!(read, set(&["a", "b"]));
    }

    #[test]
    fn reader_stops_at_first_empty_slot_even_with_junk_after_it() {
        let mut buffer = vec![0u8; names_map_size(4)];
        buffer[..3].copy_from_slice(b"one");
        // slot 1 empty, slot 2 holds a name that the SDK reader never reaches
        buffer[2 * SLOT_LEN..2 * SLOT_LEN + 3].copy_from_slice(b"two");
        assert_eq!(read_sender_set(&buffer, 4), set(&["one"]));
    }

    #[test]
    fn reader_treats_high_first_byte_as_terminator_like_signed_char() {
        let mut buffer = vec![0u8; names_map_size(4)];
        buffer[..3].copy_from_slice(b"one");
        buffer[SLOT_LEN] = 0xE6; // UTF-8 lead byte, `char` < 0 on MSVC
        buffer[SLOT_LEN + 1] = 0xAD;
        buffer[2 * SLOT_LEN..2 * SLOT_LEN + 3].copy_from_slice(b"two");
        assert_eq!(read_sender_set(&buffer, 4), set(&["one"]));
    }

    #[test]
    fn reader_never_reads_past_a_short_buffer() {
        let buffer = vec![b'a'; SLOT_LEN * 2];
        // max_senders asks for 64 slots, the mapping only holds 2.
        assert_eq!(read_sender_set(&buffer, 64).len(), 1);
    }

    #[test]
    fn write_overwrites_stale_slot_tail() {
        let mut buffer = vec![0u8; names_map_size(2)];
        write_sender_set(&set(&["LongerName"]), &mut buffer, 2);
        write_sender_set(&set(&["Ab"]), &mut buffer, 2);
        assert_eq!(&buffer[..3], b"Ab\0");
        assert!(buffer[3..SLOT_LEN].iter().all(|&byte| byte == 0));
    }

    #[test]
    fn active_sender_is_nul_terminated() {
        let mut buffer = vec![0xAAu8; SLOT_LEN];
        assert!(write_active_sender(&mut buffer, b"Folia"));
        assert_eq!(&buffer[..6], b"Folia\0");
        assert!(!write_active_sender(&mut buffer, b""));
        assert!(!write_active_sender(&mut buffer, &[b'x'; 256]));
        assert!(write_active_sender(&mut buffer, &[b'x'; 255]));
    }

    #[test]
    fn derived_object_names_match_the_sdk_suffixes() {
        assert_eq!(map_mutex_name("SpoutSenderNames"), "SpoutSenderNames_mutex");
        assert_eq!(access_mutex_name("Folia"), "Folia_SpoutAccessMutex");
        assert_eq!(count_semaphore_name("Folia"), "Folia_Count_Semaphore");
    }
}
