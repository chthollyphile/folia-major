// packaging/windows/spout-sender/src/gpu.rs
// Windows-only D3D11 / DXGI side of the helper: device and adapter selection, the Spout shared
// texture (what a DirectX Spout sender publishes), opening Electron's NT-handle texture, copying
// the visible rect across, and waiting for the GPU. Texture flags follow
// spoutDirectX::CreateSharedDX11Texture with its defaults (no NT handle, no keyed mutex): a BGRA
// texture created with D3D11_RESOURCE_MISC_SHARED whose legacy handle comes from
// IDXGIResource::GetSharedHandle — the form every Spout 2.007 receiver opens.

use std::time::{Duration, Instant};
use windows::core::{Interface, BOOL};
use windows::Win32::Foundation::{HANDLE, HMODULE};
use windows::Win32::Graphics::Direct3D::{
    D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_UNKNOWN, D3D_FEATURE_LEVEL, D3D_FEATURE_LEVEL_10_0,
    D3D_FEATURE_LEVEL_10_1, D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_11_1,
};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11Device1, ID3D11DeviceContext, ID3D11Texture2D, D3D11_BIND_RENDER_TARGET,
    D3D11_BIND_SHADER_RESOURCE, D3D11_BOX, D3D11_CREATE_DEVICE_FLAG, D3D11_QUERY_DESC, D3D11_QUERY_EVENT,
    D3D11_RESOURCE_MISC_SHARED, D3D11_RESOURCE_MISC_SHARED_KEYEDMUTEX, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC,
    D3D11_USAGE_DEFAULT,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_FORMAT, DXGI_FORMAT_B8G8R8A8_TYPELESS, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_B8G8R8A8_UNORM_SRGB,
    DXGI_SAMPLE_DESC,
};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIAdapter, IDXGIAdapter1, IDXGIDevice, IDXGIFactory1, IDXGIKeyedMutex, IDXGIResource,
    DXGI_ADAPTER_FLAG_SOFTWARE,
};

/// DXGI_FORMAT stored in SharedTextureInfo.format for the sender texture (87).
pub const SPOUT_TEXTURE_FORMAT: u32 = DXGI_FORMAT_B8G8R8A8_UNORM.0 as u32;

/// Longest the helper waits for the GPU copy before failing the frame.
const GPU_WAIT_LIMIT: Duration = Duration::from_secs(2);
/// A keyed-mutex texture from Chromium is normally released immediately.
const KEYED_MUTEX_WAIT_MS: u32 = 100;

/// The Spout shared texture and its legacy share handle.
pub struct SharedTexture {
    pub texture: ID3D11Texture2D,
    /// Legacy DXGI shared handle (global value, never closed by us).
    pub share_handle: isize,
    pub width: u32,
    pub height: u32,
}

/// Source rectangle inside Electron's texture.
pub struct CopyRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

pub struct Gpu {
    device: ID3D11Device,
    device1: ID3D11Device1,
    context: ID3D11DeviceContext,
    adapter_luid: (u32, i32),
}

impl Gpu {
    /// Default (first enumerated) hardware adapter, like the SDK's CreateDX11device.
    pub fn new_default() -> Result<Self, String> {
        Self::create(None)
    }

    /// Device on a specific adapter (used when Chromium renders on a different GPU).
    pub fn new_on_adapter(adapter: &IDXGIAdapter1) -> Result<Self, String> {
        Self::create(Some(adapter))
    }

    fn create(adapter: Option<&IDXGIAdapter1>) -> Result<Self, String> {
        // Same accepted feature levels as the SDK; OpenSharedResource1 needs 11.1 runtime support.
        let levels: [D3D_FEATURE_LEVEL; 4] =
            [D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_10_1, D3D_FEATURE_LEVEL_10_0];
        let mut device: Option<ID3D11Device> = None;
        let mut context: Option<ID3D11DeviceContext> = None;
        let result = unsafe {
            match adapter {
                Some(adapter) => {
                    let adapter: IDXGIAdapter = adapter.cast().map_err(|error| format!("adapter cast: {error}"))?;
                    D3D11CreateDevice(
                        &adapter,
                        D3D_DRIVER_TYPE_UNKNOWN,
                        HMODULE::default(),
                        D3D11_CREATE_DEVICE_FLAG(0),
                        Some(&levels),
                        D3D11_SDK_VERSION,
                        Some(&mut device),
                        None,
                        Some(&mut context),
                    )
                }
                None => D3D11CreateDevice(
                    None::<&IDXGIAdapter>,
                    D3D_DRIVER_TYPE_HARDWARE,
                    HMODULE::default(),
                    D3D11_CREATE_DEVICE_FLAG(0),
                    Some(&levels),
                    D3D11_SDK_VERSION,
                    Some(&mut device),
                    None,
                    Some(&mut context),
                ),
            }
        };
        result.map_err(|error| format!("D3D11CreateDevice failed: {error}"))?;
        let device = device.ok_or("D3D11CreateDevice returned no device")?;
        let context = context.ok_or("D3D11CreateDevice returned no context")?;
        let device1: ID3D11Device1 = device
            .cast()
            .map_err(|error| format!("ID3D11Device1 unavailable (needs Windows 8+ / D3D 11.1): {error}"))?;
        let adapter_luid = Self::device_luid(&device)?;
        Ok(Self { device, device1, context, adapter_luid })
    }

    fn device_luid(device: &ID3D11Device) -> Result<(u32, i32), String> {
        let dxgi_device: IDXGIDevice = device.cast().map_err(|error| format!("IDXGIDevice: {error}"))?;
        let adapter = unsafe { dxgi_device.GetAdapter() }.map_err(|error| format!("GetAdapter: {error}"))?;
        let desc = unsafe { adapter.GetDesc() }.map_err(|error| format!("adapter GetDesc: {error}"))?;
        Ok((desc.AdapterLuid.LowPart, desc.AdapterLuid.HighPart))
    }

    /// Hardware adapters other than the one this device runs on, in DXGI enumeration order.
    pub fn other_hardware_adapters(&self) -> Vec<IDXGIAdapter1> {
        let Ok(factory) = (unsafe { CreateDXGIFactory1::<IDXGIFactory1>() }) else {
            return Vec::new();
        };
        let mut adapters = Vec::new();
        let mut index = 0;
        // EnumAdapters1 fails with DXGI_ERROR_NOT_FOUND past the last adapter.
        while let Ok(adapter) = unsafe { factory.EnumAdapters1(index) } {
            index += 1;
            let Ok(desc) = (unsafe { adapter.GetDesc1() }) else { continue };
            // Skip the Basic Render Driver / WARP: it can never open Chromium's GPU texture.
            if desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0 {
                continue;
            }
            if (desc.AdapterLuid.LowPart, desc.AdapterLuid.HighPart) == self.adapter_luid {
                continue;
            }
            adapters.push(adapter);
        }
        adapters
    }

    /// CreateSharedDX11Texture: BGRA, default usage, MISC_SHARED, legacy GetSharedHandle.
    pub fn create_shared_texture(&self, width: u32, height: u32) -> Result<SharedTexture, String> {
        let desc = D3D11_TEXTURE2D_DESC {
            Width: width,
            Height: height,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
            CPUAccessFlags: 0,
            MiscFlags: D3D11_RESOURCE_MISC_SHARED.0 as u32,
        };
        let mut texture: Option<ID3D11Texture2D> = None;
        unsafe { self.device.CreateTexture2D(&desc, None, Some(&mut texture)) }
            .map_err(|error| format!("CreateTexture2D {width}x{height} failed: {error}"))?;
        let texture = texture.ok_or("CreateTexture2D returned no texture")?;
        let resource: IDXGIResource = texture.cast().map_err(|error| format!("IDXGIResource: {error}"))?;
        let handle = unsafe { resource.GetSharedHandle() }.map_err(|error| format!("GetSharedHandle failed: {error}"))?;
        // The SDK flushes right after creation so receivers can open the new texture.
        unsafe { self.context.Flush() };
        Ok(SharedTexture { texture, share_handle: handle.0 as isize, width, height })
    }

    /// Opens an NT-handle shared resource (already duplicated into this process) on this device.
    pub fn open_shared(&self, handle: HANDLE) -> windows::core::Result<ID3D11Texture2D> {
        unsafe { self.device1.OpenSharedResource1::<ID3D11Texture2D>(handle) }
    }

    /// Copies `rect` of `source` into the top-left of `dest`, flushes and waits for the GPU
    /// (D3D11_QUERY_EVENT, as spoutDirectX::FlushWait) so Electron can safely release `source`.
    pub fn copy_and_wait(&self, dest: &SharedTexture, source: &ID3D11Texture2D, rect: &CopyRect) -> Result<(), String> {
        let mut source_desc = D3D11_TEXTURE2D_DESC::default();
        unsafe { source.GetDesc(&mut source_desc) };

        // Chromium's DXGI textures may carry a keyed mutex (key 0); take it around the read.
        let keyed_mutex = if source_desc.MiscFlags & D3D11_RESOURCE_MISC_SHARED_KEYEDMUTEX.0 as u32 != 0 {
            source.cast::<IDXGIKeyedMutex>().ok()
        } else {
            None
        };
        let mut acquired = false;
        if let Some(mutex) = &keyed_mutex {
            match unsafe { mutex.AcquireSync(0, KEYED_MUTEX_WAIT_MS) } {
                Ok(()) => acquired = true,
                // Best effort: dropping every frame because the producer sits on the mutex is
                // worse than a possible torn frame.
                Err(error) => eprintln!("[spout-sender] keyed mutex acquire failed, copying unsynchronised: {error}"),
            }
        }

        let source_box = D3D11_BOX {
            left: rect.x,
            top: rect.y,
            front: 0,
            right: rect.x + rect.width,
            bottom: rect.y + rect.height,
            back: 1,
        };
        unsafe {
            self.context.CopySubresourceRegion(&dest.texture, 0, 0, 0, 0, source, 0, Some(&source_box));
            self.context.Flush();
        }
        let waited = self.wait_for_gpu();

        if acquired {
            if let Some(mutex) = &keyed_mutex {
                unsafe { mutex.ReleaseSync(0).ok() };
            }
        }
        waited
    }

    /// Flush-and-wait: an event query signals once every prior command has executed.
    fn wait_for_gpu(&self) -> Result<(), String> {
        let query_desc = D3D11_QUERY_DESC { Query: D3D11_QUERY_EVENT, MiscFlags: 0 };
        let mut query = None;
        unsafe { self.device.CreateQuery(&query_desc, Some(&mut query)) }
            .map_err(|error| format!("CreateQuery failed: {error}"))?;
        let query = query.ok_or("CreateQuery returned no query")?;
        unsafe { self.context.End(&query) };

        let started = Instant::now();
        let mut spins = 0u32;
        loop {
            // GetData maps S_FALSE (not finished) to Ok without touching the data, so the BOOL
            // stays FALSE until the GPU reports completion (S_OK writes TRUE).
            let mut finished = BOOL(0);
            unsafe {
                self.context.GetData(
                    &query,
                    Some(&mut finished as *mut BOOL as *mut _),
                    std::mem::size_of::<BOOL>() as u32,
                    0,
                )
            }
            .map_err(|error| format!("GetData failed (device lost?): {error}"))?;
            if finished.as_bool() {
                return Ok(());
            }
            if started.elapsed() > GPU_WAIT_LIMIT {
                return Err("timed out waiting for the GPU copy".to_string());
            }
            // Busy-yield first (a copy normally completes in well under a millisecond), then back off.
            spins += 1;
            if spins < 200 {
                std::thread::yield_now();
            } else {
                std::thread::sleep(Duration::from_millis(1));
            }
        }
    }
}

/// True for the BGRA8 family (typeless / unorm / sRGB), the only layouts that can be copied into
/// the B8G8R8A8_UNORM Spout texture with CopySubresourceRegion.
pub fn is_bgra8_family(format: DXGI_FORMAT) -> bool {
    format == DXGI_FORMAT_B8G8R8A8_UNORM
        || format == DXGI_FORMAT_B8G8R8A8_TYPELESS
        || format == DXGI_FORMAT_B8G8R8A8_UNORM_SRGB
}
