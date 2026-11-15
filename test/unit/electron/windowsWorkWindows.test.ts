import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// Validate the read-only native boundary, including exclusion and DPI restoration on failures.
const require = createRequire(import.meta.url);
const { createWindowsWorkWindowReader } = require('../../../electron/wallpaper/windowsWorkWindows.cjs');

function fixture() {
    const normal = { pid: 7, visible: true, minimized: false, maximized: false, style: 0, cloaked: false,
        className: 'OrdinaryWindow', rect: { left: 100, top: 200, right: 800, bottom: 600 } };
    type NativeWindow = typeof normal;
    const windows = [normal];
    const dpi = vi.fn((context: number) => { void context; return 42; });
    const bounds = vi.fn((window: NativeWindow, output: Record<string, number>) => { Object.assign(output, window.rect); return true; });
    const api = {
        EnumWindows: vi.fn((callback: (window: NativeWindow) => boolean) => windows.every(window => callback(window))),
        IsWindowVisible: (window: NativeWindow) => window.visible,
        IsIconic: (window: NativeWindow) => window.minimized,
        IsZoomed: (window: NativeWindow) => window.maximized,
        GetWindowThreadProcessId: (window: NativeWindow, output: number[]) => { output[0] = window.pid; return 1; },
        GetWindowLongW: (window: NativeWindow) => window.style,
        GetClassNameW: (window: NativeWindow, output: Buffer) => { output.write(window.className, 'utf16le'); return window.className.length; },
        GetWindowRect: bounds,
        DwmGetWindowAttribute: (window: NativeWindow, _attribute: number, output: number[]) => { output[0] = Number(window.cloaked); return 0; },
        SetThreadDpiAwarenessContext: dpi,
    };
    const koffi = {
        load: () => ({ func: (signature: string) => {
            const name = signature.match(/(\w+)\(/)?.[1];
            if (!name || !(name in api)) throw new Error('Unknown native function');
            return api[name as keyof typeof api];
        } }),
        struct: vi.fn(), proto: () => 'callback', pointer: (value: string) => value,
        register: vi.fn((callback: unknown) => callback), unregister: vi.fn(),
    };
    return { read: createWindowsWorkWindowReader({ ownPid: 42, loadKoffi: () => koffi }),
        windows, normal, api, bounds, dpi, koffi };
}

describe('Windows work-window sampling', () => {
    it('keeps physical normal/maximized bounds while excluding overlays, other desktops and itself', () => {
        const f = fixture();
        f.windows.push({ ...f.normal, maximized: true });
        f.windows.push(...[
            { visible: false }, { minimized: true }, { pid: 42 }, { cloaked: true },
            { style: 0x80 }, { style: 0x08000000 }, { className: 'Progman' }, { className: 'Shell_TrayWnd' },
        ].map(change => ({ ...f.normal, ...change })));
        expect(f.read()).toEqual([
            { x: 100, y: 200, width: 700, height: 400, maximized: false },
            { x: 100, y: 200, width: 700, height: 400, maximized: true },
        ]);
        expect(f.bounds).toHaveBeenCalledTimes(2);
        expect(f.dpi.mock.calls).toEqual([[-4], [42]]);
        expect(f.koffi.unregister).toHaveBeenCalledOnce();
    });
    it('restores DPI if callback registration fails', () => {
        const f = fixture();
        f.koffi.register.mockImplementation(() => { throw new Error('register failed'); });
        expect(f.read).toThrow('register failed');
        expect(f.dpi.mock.calls).toEqual([[-4], [42]]);
        expect(f.koffi.unregister).not.toHaveBeenCalled();
    });
    it('reports native callback failures rather than returning an empty desktop', () => {
        const f = fixture();
        f.bounds.mockImplementation(() => { throw new Error('native failure'); });
        expect(f.read).toThrow('native failure');
        expect(f.dpi.mock.calls).toEqual([[-4], [42]]);
        expect(f.koffi.unregister).toHaveBeenCalledOnce();
    });
    it('restores DPI even when releasing the callback fails', () => {
        const f = fixture();
        f.koffi.unregister.mockImplementation(() => { throw new Error('release failed'); });
        expect(f.read).toThrow('release failed');
        expect(f.dpi.mock.calls).toEqual([[-4], [42]]);
    });
});
