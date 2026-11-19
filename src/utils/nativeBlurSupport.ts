// src/utils/nativeBlurSupport.ts
// Whether the player page's native blur can work here. Windows draws it with the Acrylic background
// material, which only exists from Windows 11 22H2 on; on Windows 10 the switch would only empty the
// player background. The desktop app's preload answers from the OS build; in a browser only Linux
// is ruled out, as before.

/** Whether the native blur switch can take effect on this system. */
export const NATIVE_BLUR_SUPPORTED: boolean = (() => {
    if (typeof window !== 'undefined' && typeof window.electron?.nativeBlurSupported === 'boolean') {
        return window.electron.nativeBlurSupported;
    }
    return !(typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('linux'));
})();
