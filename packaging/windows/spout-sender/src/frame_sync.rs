// packaging/windows/spout-sender/src/frame_sync.rs
// Windows-only port of the sender half of spoutFrameCount (SpoutFrameCount.cpp):
//   * the named "<sender>_SpoutAccessMutex" a sender holds while it writes the shared texture, so
//     a receiver copying out of it never reads a half-written frame;
//   * the optional "<sender>_Count_Semaphore" frame counter, which the SDK only creates when
//     HKCU\Software\Leading Edge\Spout\Framecount == 1 (it is off by default).
// Both objects are opened-or-created by name, so they are shared with the receiver's own copies.

use std::ffi::CString;
use windows::core::PCSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_ABANDONED, WAIT_OBJECT_0};
use windows::Win32::System::Threading::{
    CreateMutexA, CreateSemaphoreA, ReleaseMutex, ReleaseSemaphore, WaitForSingleObject,
};

use crate::sender_names::{access_mutex_name, count_semaphore_name};
use crate::spout_registry::read_spout_dword;

/// spoutFrameCount::CheckAccess waits 67 ms (four frames at 60 fps).
const ACCESS_TIMEOUT_MS: u32 = 67;

pub struct FrameSync {
    access_mutex: HANDLE,
    count_semaphore: Option<HANDLE>,
}

impl FrameSync {
    /// CreateAccessMutex + EnableFrameCount for `sender_name`.
    pub fn create(sender_name: &str) -> Result<Self, String> {
        let mutex_name = CString::new(access_mutex_name(sender_name)).map_err(|_| "bad sender name".to_string())?;
        let access_mutex = unsafe { CreateMutexA(None, false, PCSTR(mutex_name.as_ptr() as *const u8)) }
            .map_err(|error| format!("CreateMutex (texture access) failed: {error}"))?;

        let mut count_semaphore = None;
        if read_spout_dword("Framecount") == Some(1) {
            let semaphore_name =
                CString::new(count_semaphore_name(sender_name)).map_err(|_| "bad sender name".to_string())?;
            // initial count 1, max LONG_MAX — the SDK's values; the receiver may create it first.
            match unsafe { CreateSemaphoreA(None, 1, i32::MAX, PCSTR(semaphore_name.as_ptr() as *const u8)) } {
                Ok(semaphore) => count_semaphore = Some(semaphore),
                // The SDK logs and carries on without counting; a missing counter only costs
                // receivers their frame-new detection.
                Err(error) => eprintln!("[spout-sender] frame count semaphore unavailable: {error}"),
            }
        }
        Ok(Self { access_mutex, count_semaphore })
    }

    /// CheckAccess: take the texture access mutex (an abandoned one is taken over, like a crashed
    /// receiver releasing it). False after 67 ms means a receiver is holding it.
    pub fn check_access(&self) -> bool {
        let wait = unsafe { WaitForSingleObject(self.access_mutex, ACCESS_TIMEOUT_MS) };
        wait == WAIT_OBJECT_0 || wait == WAIT_ABANDONED
    }

    /// AllowAccess: release the texture access mutex.
    pub fn allow_access(&self) {
        unsafe { ReleaseMutex(self.access_mutex).ok() };
    }

    /// SetNewFrame: bump the frame count. Called inside the access lock, after the GPU copy.
    pub fn set_new_frame(&self) {
        let Some(semaphore) = self.count_semaphore else { return };
        // The wait always succeeds (count >= 1) but must precede ReleaseSemaphore; the release by
        // 2 compensates for the unit the wait just took, netting +1 per frame.
        if unsafe { WaitForSingleObject(semaphore, 0) } == WAIT_OBJECT_0 {
            unsafe { ReleaseSemaphore(semaphore, 2, None).ok() };
        }
    }
}

impl Drop for FrameSync {
    fn drop(&mut self) {
        unsafe {
            if let Some(semaphore) = self.count_semaphore.take() {
                CloseHandle(semaphore).ok();
            }
            CloseHandle(self.access_mutex).ok();
        }
    }
}
