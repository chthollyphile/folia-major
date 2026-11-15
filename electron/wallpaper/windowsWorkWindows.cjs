// Read-only Win32 sampling: no window titles, keyboard hooks, focus changes or screenshots.
function createWindowsWorkWindowReader({ ownPid = process.pid, loadKoffi = () => require('koffi') } = {}) {
    let api;
    function bind() {
        if (api) return api;
        const koffi = loadKoffi();
        const user = koffi.load('user32.dll');
        const dwm = koffi.load('dwmapi.dll');
        koffi.struct('FoliaAutoDisplayRect', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
        const callback = koffi.proto('bool __stdcall FoliaAutoDisplayEnum(void *hwnd, intptr_t data)');
        api = {
            koffi, callback,
            enumerate: user.func('bool __stdcall EnumWindows(FoliaAutoDisplayEnum *callback, intptr_t data)'),
            visible: user.func('bool __stdcall IsWindowVisible(void *hwnd)'),
            iconic: user.func('bool __stdcall IsIconic(void *hwnd)'),
            zoomed: user.func('bool __stdcall IsZoomed(void *hwnd)'),
            pid: user.func('uint32 __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32 *pid)'),
            style: user.func('int32 __stdcall GetWindowLongW(void *hwnd, int index)'),
            className: user.func('int __stdcall GetClassNameW(void *hwnd, _Out_ uint16 *name, int size)'),
            bounds: user.func('bool __stdcall GetWindowRect(void *hwnd, _Out_ FoliaAutoDisplayRect *rect)'),
            cloaked: dwm.func('int32 __stdcall DwmGetWindowAttribute(void *hwnd, uint32 attribute, _Out_ uint32 *value, uint32 size)'),
            dpi: user.func('void * __stdcall SetThreadDpiAwarenessContext(void *context)'),
        };
        return api;
    }

    return function readWorkWindows() {
        const f = bind();
        const windows = [];
        const previousDpi = f.dpi(-4); // PMv2: GetWindowRect and Electron's converted target use physical pixels.
        if (!previousDpi) throw new Error('Cannot obtain per-monitor window coordinates');
        let failure;
        let callback;
        try {
            callback = f.koffi.register(hwnd => {
                try {
                    if (!f.visible(hwnd) || f.iconic(hwnd)) return true;
                    const pid = [0]; f.pid(hwnd, pid);
                    if (pid[0] === ownPid) return true;
                    const style = f.style(hwnd, -20);
                    if (style & (0x80 | 0x08000000)) return true; // Tool windows and non-activating overlays.
                    const cloaked = [0];
                    if (f.cloaked(hwnd, 14, cloaked, 4) === 0 && cloaked[0]) return true;
                    const name = Buffer.alloc(256);
                    const count = f.className(hwnd, name, 128);
                    const className = name.toString('utf16le', 0, count * 2);
                    if (/^(Progman|WorkerW|Shell_TrayWnd|Shell_SecondaryTrayWnd|tooltips_class32|#32768)$/.test(className)) return true;
                    const bounds = {};
                    if (f.bounds(hwnd, bounds)) windows.push({ x: bounds.left, y: bounds.top,
                        width: bounds.right - bounds.left, height: bounds.bottom - bounds.top, maximized: f.zoomed(hwnd) });
                } catch (error) { failure = error; return false; }
                return true;
            }, f.koffi.pointer(f.callback));
            const ok = f.enumerate(callback, 0);
            if (failure) throw failure;
            if (!ok) throw new Error('Window enumeration did not complete');
            return windows;
        } finally {
            try {
                if (callback) f.koffi.unregister(callback);
            } finally {
                f.dpi(previousDpi);
            }
        }
    };
}

module.exports = { createWindowsWorkWindowReader };
