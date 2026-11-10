import { describe, expect, it } from 'vitest';

// test/unit/electron/windowAlwaysOnTopSupport.test.ts
// Always-on-top is greyed out only on Chromium's native Wayland backend (issue #657).

type Options = {
    platform?: string;
    ozonePlatform?: string;
    env?: Record<string, string | undefined>;
};

const { resolveLinuxOzonePlatform, isWindowAlwaysOnTopSupported } = require('../../../electron/windowAlwaysOnTopSupport.cjs') as {
    resolveLinuxOzonePlatform: (options?: Options) => string | null;
    isWindowAlwaysOnTopSupported: (options?: Options) => boolean;
};

const WAYLAND_SESSION = { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' };

describe('isWindowAlwaysOnTopSupported', () => {
    it('is supported off Linux whatever the environment says', () => {
        expect(isWindowAlwaysOnTopSupported({ platform: 'win32', env: WAYLAND_SESSION })).toBe(true);
        expect(isWindowAlwaysOnTopSupported({ platform: 'darwin', env: WAYLAND_SESSION })).toBe(true);
        expect(resolveLinuxOzonePlatform({ platform: 'win32', env: WAYLAND_SESSION })).toBeNull();
    });

    it('trusts the backend Chromium wrote into --ozone-platform', () => {
        expect(isWindowAlwaysOnTopSupported({ platform: 'linux', ozonePlatform: 'wayland', env: {} })).toBe(false);
        // XWayland inside a Wayland session: the documented workaround keeps the switches.
        expect(isWindowAlwaysOnTopSupported({ platform: 'linux', ozonePlatform: 'x11', env: WAYLAND_SESSION })).toBe(true);
    });

    it('falls back to the environment the way Chromium picks a backend', () => {
        const resolve = (env: Record<string, string | undefined>) => resolveLinuxOzonePlatform({ platform: 'linux', env });
        expect(resolve({ WAYLAND_DISPLAY: 'wayland-1' })).toBe('wayland');
        expect(resolve({ WAYLAND_SOCKET: '3' })).toBe('wayland');
        expect(resolve({ DISPLAY: ':0' })).toBe('x11');
        // Both displays reachable: the session type breaks the tie.
        expect(resolve(WAYLAND_SESSION)).toBe('wayland');
        expect(resolve({ ...WAYLAND_SESSION, XDG_SESSION_TYPE: 'x11' })).toBe('x11');
        // An empty variable counts as unset.
        expect(resolve({ WAYLAND_DISPLAY: '', DISPLAY: ':0', XDG_SESSION_TYPE: 'wayland' })).toBe('x11');
        expect(resolve({})).toBe('x11');
    });
});
