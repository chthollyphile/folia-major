// packaging/windows/spout-sender/src/shared_memory.rs
// Windows-only port of the Spout SDK's SpoutSharedMemory (SpoutSharedMemory.cpp): a pagefile
// backed named file mapping paired with a named mutex "<map name>_mutex" that serialises access.
// The SDK's names, flags and 67 ms lock timeout are reproduced so SDK-built receivers (OBS's
// obs-spout2-plugin, SpoutReceiver) lock the very same mutex objects as this helper. Unlike the
// SDK the lock is scoped (`with_lock`), so a map can never be left locked on an early return.

use std::ffi::CString;
use windows::core::PCSTR;
use windows::Win32::Foundation::{
    CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE, INVALID_HANDLE_VALUE, WAIT_ABANDONED, WAIT_OBJECT_0,
};
use windows::Win32::System::Memory::{
    CreateFileMappingA, MapViewOfFile, OpenFileMappingA, UnmapViewOfFile, VirtualQuery, FILE_MAP_ALL_ACCESS,
    MEMORY_BASIC_INFORMATION, MEMORY_MAPPED_VIEW_ADDRESS, PAGE_READWRITE,
};
use windows::Win32::System::Threading::{CreateMutexA, ReleaseMutex, WaitForSingleObject};

use crate::sender_names::map_mutex_name;

/// SpoutSharedMemory::Lock waits 67 ms (four frames at 60 fps) for the mutex.
const LOCK_TIMEOUT_MS: u32 = 67;

pub struct SharedMemory {
    map: HANDLE,
    view: *mut u8,
    /// Mapped region size (page rounded); OpenFileMapping cannot report the creator's size.
    len: usize,
    mutex: HANDLE,
}

fn c_name(name: &str) -> Result<CString, String> {
    CString::new(name).map_err(|_| format!("object name contains NUL: {name:?}"))
}

impl SharedMemory {
    /// SpoutSharedMemory::Create — create the map (or attach to an existing one, which keeps its
    /// original size). Returns the map and whether it already existed.
    pub fn create(name: &str, size: usize) -> Result<(Self, bool), String> {
        let name_c = c_name(name)?;
        let size = u32::try_from(size).map_err(|_| "shared memory size too large".to_string())?;
        let map = unsafe {
            CreateFileMappingA(INVALID_HANDLE_VALUE, None, PAGE_READWRITE, 0, size, PCSTR(name_c.as_ptr() as *const u8))
        }
        .map_err(|error| format!("CreateFileMapping {name:?} failed: {error}"))?;
        // Must be read before any further Win32 call can overwrite the thread's last error.
        let already_existed = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
        Self::finish(map, name, true).map(|memory| (memory, already_existed))
    }

    /// SpoutSharedMemory::Open — attach to an existing map; None when no process holds it.
    pub fn open(name: &str) -> Option<Self> {
        let name_c = c_name(name).ok()?;
        let map = unsafe { OpenFileMappingA(FILE_MAP_ALL_ACCESS.0, false, PCSTR(name_c.as_ptr() as *const u8)) }.ok()?;
        Self::finish(map, name, false).ok()
    }

    /// Maps the view and creates/opens the companion mutex; closes `map` on any failure.
    fn finish(map: HANDLE, name: &str, _created: bool) -> Result<Self, String> {
        let view = unsafe { MapViewOfFile(map, FILE_MAP_ALL_ACCESS, 0, 0, 0) };
        if view.Value.is_null() {
            let error = windows::core::Error::from_thread();
            unsafe { CloseHandle(map).ok() };
            return Err(format!("MapViewOfFile {name:?} failed: {error}"));
        }
        let mut info = MEMORY_BASIC_INFORMATION::default();
        let queried = unsafe {
            VirtualQuery(Some(view.Value as *const _), &mut info, std::mem::size_of::<MEMORY_BASIC_INFORMATION>())
        };
        if queried == 0 || info.RegionSize == 0 {
            unsafe {
                UnmapViewOfFile(view).ok();
                CloseHandle(map).ok();
            }
            return Err(format!("VirtualQuery {name:?} failed"));
        }
        let mutex_name = match c_name(&map_mutex_name(name)) {
            Ok(mutex_name) => mutex_name,
            Err(error) => {
                unsafe {
                    UnmapViewOfFile(view).ok();
                    CloseHandle(map).ok();
                }
                return Err(error);
            }
        };
        let mutex = match unsafe { CreateMutexA(None, false, PCSTR(mutex_name.as_ptr() as *const u8)) } {
            Ok(mutex) => mutex,
            Err(error) => {
                unsafe {
                    UnmapViewOfFile(view).ok();
                    CloseHandle(map).ok();
                }
                return Err(format!("CreateMutex for {name:?} failed: {error}"));
            }
        };
        Ok(Self { map, view: view.Value as *mut u8, len: info.RegionSize, mutex })
    }

    /// Size of the mapped region in bytes.
    pub fn len(&self) -> usize {
        self.len
    }

    /// Runs `f` on the mapped bytes while holding the map's named mutex. None when the mutex
    /// could not be acquired within the SDK's 67 ms. An abandoned mutex (previous owner died
    /// holding it) is taken over: the data is plain bytes and every writer rewrites it whole.
    pub fn with_lock<R>(&mut self, f: impl FnOnce(&mut [u8]) -> R) -> Option<R> {
        let wait = unsafe { WaitForSingleObject(self.mutex, LOCK_TIMEOUT_MS) };
        if wait != WAIT_OBJECT_0 && wait != WAIT_ABANDONED {
            return None;
        }
        let bytes = unsafe { std::slice::from_raw_parts_mut(self.view, self.len) };
        let result = f(bytes);
        unsafe { ReleaseMutex(self.mutex).ok() };
        Some(result)
    }
}

impl Drop for SharedMemory {
    fn drop(&mut self) {
        unsafe {
            UnmapViewOfFile(MEMORY_MAPPED_VIEW_ADDRESS { Value: self.view as *mut _ }).ok();
            CloseHandle(self.map).ok();
            CloseHandle(self.mutex).ok();
        }
    }
}
