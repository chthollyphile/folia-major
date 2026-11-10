import { describe, expect, it } from 'vitest';

// test/unit/electron/linuxVulkan.test.ts
// FOLIA_LINUX_VULKAN=1 turns Vulkan on only for the X11 backend in system graphics mode (issue #752).

type Options = {
    platform?: string;
    env?: Record<string, string | undefined>;
    ozonePlatform?: string;
    graphicsMode?: string;
};

type Choice = { enabled: boolean; refused: string | null; ozonePlatform: string | null };

const { resolveLinuxVulkanChoice } = require('../../../electron/linuxVulkan.cjs') as {
    resolveLinuxVulkanChoice: (options?: Options) => Choice;
};

const OPT_IN = { FOLIA_LINUX_VULKAN: '1' };

describe('resolveLinuxVulkanChoice', () => {
    it('stays off and silent unless the user opts in', () => {
        expect(resolveLinuxVulkanChoice({ platform: 'linux', env: {}, ozonePlatform: 'x11' }))
            .toEqual({ enabled: false, refused: null, ozonePlatform: null });
        expect(resolveLinuxVulkanChoice({ platform: 'linux', env: { FOLIA_LINUX_VULKAN: '0' }, ozonePlatform: 'x11' }).enabled).toBe(false);
        expect(resolveLinuxVulkanChoice({ platform: 'win32', env: OPT_IN, ozonePlatform: 'x11' }).refused).toBeNull();
    });

    it('enables Vulkan on the x11 backend, including XWayland inside a Wayland session', () => {
        const waylandSession = { ...OPT_IN, XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' };
        expect(resolveLinuxVulkanChoice({ platform: 'linux', env: waylandSession, ozonePlatform: 'x11' }))
            .toEqual({ enabled: true, refused: null, ozonePlatform: 'x11' });
    });

    it('refuses on the native Wayland backend, where Vulkan takes the GPU process down', () => {
        expect(resolveLinuxVulkanChoice({ platform: 'linux', env: OPT_IN, ozonePlatform: 'wayland' }))
            .toEqual({ enabled: false, refused: 'not-x11', ozonePlatform: 'wayland' });
        // No --ozone-platform: falls back to the environment the way Chromium does.
        expect(resolveLinuxVulkanChoice({ platform: 'linux', env: { ...OPT_IN, WAYLAND_DISPLAY: 'wayland-1' } }).refused).toBe('not-x11');
        expect(resolveLinuxVulkanChoice({ platform: 'linux', env: { ...OPT_IN, DISPLAY: ':0' } }).enabled).toBe(true);
    });

    it('refuses outside the system graphics mode', () => {
        for (const graphicsMode of ['swiftshader', 'software']) {
            expect(resolveLinuxVulkanChoice({ platform: 'linux', env: OPT_IN, ozonePlatform: 'x11', graphicsMode }).refused)
                .toBe('graphics-mode');
        }
    });
});
