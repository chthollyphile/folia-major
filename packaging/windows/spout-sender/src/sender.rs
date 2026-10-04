// packaging/windows/spout-sender/src/sender.rs
// Windows-only: one live Spout sender. Owns the D3D11 device, the Spout shared texture, the
// sender-list registration and the texture access mutex / frame counter, and turns each `frame`
// command (an Electron shared-texture NT handle valid in the parent process) into a GPU copy
// into the Spout texture. Lock ordering per frame mirrors SpoutDX::SendTexture:
// access mutex -> (resize: info map) -> copy + flush + GPU wait -> frame counter -> release.

use std::ffi::c_void;
use windows::Win32::Foundation::{CloseHandle, DuplicateHandle, DUPLICATE_SAME_ACCESS, HANDLE};
use windows::Win32::System::Threading::GetCurrentProcess;

use crate::gpu::{is_bgra8_family, CopyRect, Gpu, SharedTexture, SPOUT_TEXTURE_FORMAT};
use crate::frame_sync::FrameSync;
use crate::protocol::{FatalCode, FrameCommand, PixelFormat};
use crate::shared_info::{handle_to_u32, SharedTextureInfo};
use crate::spout_registry::{RegisterError, SenderRegistry};

/// The sender is announced before Electron's first frame (and so before the real size is known),
/// so it starts at Folia's default output size and is re-created on the first frame if different.
const INITIAL_WIDTH: u32 = 1920;
const INITIAL_HEIGHT: u32 = 1080;

pub struct StartError {
    pub code: FatalCode,
    pub message: String,
}

/// Parent (Electron main) process handle opened for DuplicateHandle.
pub struct ParentProcess {
    pub handle: HANDLE,
}

/// Closes a duplicated handle on every exit path.
struct OwnedHandle(HANDLE);

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0).ok() };
    }
}

pub struct SpoutSender {
    // Drop order matters: unregister first, then counters, then the texture, then the device.
    registry: SenderRegistry,
    sync: FrameSync,
    texture: SharedTexture,
    gpu: Gpu,
    parent: HANDLE,
    host_path: String,
}

impl SpoutSender {
    /// Brings the sender up: device -> texture -> info map + list registration -> access mutex.
    pub fn start(name: &str, parent: &ParentProcess) -> Result<Self, StartError> {
        let d3d_error = |message: String| StartError { code: FatalCode::D3dInitFailed, message };
        let gpu = Gpu::new_default().map_err(d3d_error)?;
        let texture = gpu.create_shared_texture(INITIAL_WIDTH, INITIAL_HEIGHT).map_err(d3d_error)?;

        let host_path = std::env::current_exe().map(|path| path.to_string_lossy().into_owned()).unwrap_or_default();
        let info = Self::info_for(&texture, &host_path);
        let registry = SenderRegistry::register(name, &info).map_err(|error| match error {
            RegisterError::NameInUse => StartError {
                code: FatalCode::NameInUse,
                message: format!("a Spout sender named {name:?} is already running"),
            },
            RegisterError::Failed(message) => StartError { code: FatalCode::SpoutRegisterFailed, message },
        })?;
        let sync = FrameSync::create(name)
            .map_err(|message| StartError { code: FatalCode::SpoutRegisterFailed, message })?;

        Ok(Self { registry, sync, texture, gpu, parent: parent.handle, host_path })
    }

    fn info_for(texture: &SharedTexture, host_path: &str) -> SharedTextureInfo {
        SharedTextureInfo::new(
            handle_to_u32(texture.share_handle),
            texture.width,
            texture.height,
            SPOUT_TEXTURE_FORMAT,
            host_path,
        )
    }

    /// Copies one Electron frame into the Spout texture. Ok means the GPU copy has completed, so
    /// the caller may ack `done`; the duplicated handle and the opened texture are released
    /// before this returns.
    pub fn handle_frame(&mut self, frame: &FrameCommand) -> Result<(), String> {
        if frame.format != PixelFormat::Bgra {
            // A swizzle shader is not implemented: Electron is required to request bgra.
            return Err("rgba frames are not supported, Electron must emit bgra".to_string());
        }
        if frame.width == 0 || frame.height == 0 {
            return Err("empty visible rect".to_string());
        }
        let parent_handle = frame.parent_handle().ok_or("invalid texture handle")?;

        // Pull the NT handle out of the Electron process (it is only valid there).
        let mut local = HANDLE::default();
        unsafe {
            DuplicateHandle(
                self.parent,
                HANDLE(parent_handle as *mut c_void),
                GetCurrentProcess(),
                &mut local,
                0,
                false,
                DUPLICATE_SAME_ACCESS,
            )
        }
        .map_err(|error| format!("DuplicateHandle from Electron failed: {error}"))?;
        let local = OwnedHandle(local);

        let source = self.open_source(local.0)?;
        let mut desc = Default::default();
        unsafe { source.GetDesc(&mut desc) };
        if !is_bgra8_family(desc.Format) {
            return Err(format!("unsupported source DXGI format {}", desc.Format.0));
        }
        // Validate against the real texture, not the (decoder-coded) size the command claims.
        let right = frame.x.checked_add(frame.width);
        let bottom = frame.y.checked_add(frame.height);
        if right.is_none_or(|right| right > desc.Width) || bottom.is_none_or(|bottom| bottom > desc.Height) {
            return Err(format!(
                "visible rect {}x{}+{}+{} outside the {}x{} source texture",
                frame.width, frame.height, frame.x, frame.y, desc.Width, desc.Height
            ));
        }
        let rect = CopyRect { x: frame.x, y: frame.y, width: frame.width, height: frame.height };

        if !self.sync.check_access() {
            return Err("timed out waiting for the Spout texture access mutex".to_string());
        }
        let result = self.copy_locked(&source, &rect);
        self.sync.allow_access();
        result
    }

    /// Texture access mutex is held: resize the Spout texture if needed, copy, count the frame.
    fn copy_locked(&mut self, source: &windows::Win32::Graphics::Direct3D11::ID3D11Texture2D, rect: &CopyRect) -> Result<(), String> {
        if self.texture.width != rect.width || self.texture.height != rect.height {
            self.replace_texture(rect.width, rect.height)?;
        }
        self.gpu.copy_and_wait(&self.texture, source, rect)?;
        self.sync.set_new_frame();
        Ok(())
    }

    /// Re-creates the Spout texture at a new size and rewrites the sender info so receivers
    /// reconnect (SpoutDX::UpdateSender).
    fn replace_texture(&mut self, width: u32, height: u32) -> Result<(), String> {
        let texture = self.gpu.create_shared_texture(width, height)?;
        self.registry.update_info(&Self::info_for(&texture, &self.host_path))?;
        self.texture = texture;
        Ok(())
    }

    /// Opens Electron's texture on the current device; if that fails Chromium is probably on a
    /// different GPU, so try every other hardware adapter and keep the first that works.
    fn open_source(
        &mut self,
        handle: HANDLE,
    ) -> Result<windows::Win32::Graphics::Direct3D11::ID3D11Texture2D, String> {
        let first_error = match self.gpu.open_shared(handle) {
            Ok(texture) => return Ok(texture),
            Err(error) => error,
        };
        for adapter in self.gpu.other_hardware_adapters() {
            let Ok(gpu) = Gpu::new_on_adapter(&adapter) else { continue };
            let Ok(texture) = gpu.open_shared(handle) else { continue };
            // Switch the whole sender to this adapter: the Spout texture must live on the same
            // GPU as the copy, and its new share handle goes out through the info map.
            let replacement = gpu.create_shared_texture(self.texture.width, self.texture.height)?;
            self.registry.update_info(&Self::info_for(&replacement, &self.host_path))?;
            self.texture = replacement;
            self.gpu = gpu;
            eprintln!("[spout-sender] switched to the adapter Electron renders on");
            return Ok(texture);
        }
        Err(format!("OpenSharedResource1 failed on every hardware adapter: {first_error}"))
    }
}
