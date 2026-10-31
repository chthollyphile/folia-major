import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/globalShortcuts.test.ts
// The main-process side of the global playback shortcuts: only accelerators with at least one
// modifier and a key on the list are registered, each apply replaces the last set touching only what
// changed, refusals are reported and retried, and Wayland goes through the desktop portal.

type Answer = { backend: 'native' | 'portal'; results: Array<{ accelerator: string; registered: boolean }> };

const { createGlobalShortcutController, usesGlobalShortcutsPortal } = require('../../../electron/globalShortcuts.cjs') as {
    createGlobalShortcutController: (options: {
        globalShortcut: { register: (accelerator: string, callback: () => void) => boolean; unregister: (accelerator: string) => void };
        onTrigger: (accelerator: string) => void;
        backend: 'native' | 'portal';
    }) => { apply: (accelerators: unknown) => Answer; dispose: () => void };
    usesGlobalShortcutsPortal: (options?: { platform?: string; ozonePlatform?: string; env?: Record<string, string> }) => boolean;
};

const fakeGlobalShortcut = (taken: string[] = []) => {
    const callbacks = new Map<string, () => void>();
    return {
        callbacks,
        register: vi.fn((accelerator: string, callback: () => void) => {
            if (taken.includes(accelerator)) {
                return false;
            }
            callbacks.set(accelerator, callback);
            return true;
        }),
        unregister: vi.fn((accelerator: string) => {
            callbacks.delete(accelerator);
        }),
    };
};

describe('createGlobalShortcutController', () => {
    it('registers the combinations the settings allow and drops anything else', () => {
        const globalShortcut = fakeGlobalShortcut();
        const controller = createGlobalShortcutController({ globalShortcut, onTrigger: vi.fn(), backend: 'native' });

        const answer = controller.apply([
            'Control+Alt+Shift+P',
            'Shift+Space',
            'Alt+Up',
            'Control+F5',
            'Super+Left',
            'P',
            'Space',
            'Control+Control+P',
            'Control+Plus',
            'Control+Escape',
            'Control+Alt+F25',
            42,
            'Control+Alt+Shift+P',
        ]);

        expect(answer).toEqual({
            backend: 'native',
            results: [
                { accelerator: 'Control+Alt+Shift+P', registered: true },
                { accelerator: 'Shift+Space', registered: true },
                { accelerator: 'Alt+Up', registered: true },
                { accelerator: 'Control+F5', registered: true },
                { accelerator: 'Super+Left', registered: true },
            ],
        });
        expect(globalShortcut.register).toHaveBeenCalledTimes(5);
    });

    it('reports a key the system refuses and keeps the others', () => {
        const globalShortcut = fakeGlobalShortcut(['Control+Alt+Shift+N']);
        const controller = createGlobalShortcutController({ globalShortcut, onTrigger: vi.fn(), backend: 'native' });

        const answer = controller.apply(['Control+Alt+Shift+P', 'Control+Alt+Shift+N']);

        expect(answer.results).toEqual([
            { accelerator: 'Control+Alt+Shift+P', registered: true },
            { accelerator: 'Control+Alt+Shift+N', registered: false },
        ]);
    });

    it('replaces the previous set, so a key taken out is no longer held', () => {
        const globalShortcut = fakeGlobalShortcut();
        const controller = createGlobalShortcutController({ globalShortcut, onTrigger: vi.fn(), backend: 'native' });

        controller.apply(['Control+Alt+Shift+P', 'Control+Alt+Shift+N']);
        controller.apply(['Control+Alt+Shift+N']);

        expect([...globalShortcut.callbacks.keys()]).toEqual(['Control+Alt+Shift+N']);
        controller.dispose();
        expect(globalShortcut.callbacks.size).toBe(0);
    });

    it('leaves a key already held alone, and registers nothing for an unchanged set', () => {
        const globalShortcut = fakeGlobalShortcut();
        const controller = createGlobalShortcutController({ globalShortcut, onTrigger: vi.fn(), backend: 'portal' });

        controller.apply(['Control+Alt+Shift+P', 'Control+Alt+Shift+N']);
        globalShortcut.register.mockClear();
        const again = controller.apply(['Control+Alt+Shift+P', 'Control+Alt+Shift+N']);

        expect(globalShortcut.register).not.toHaveBeenCalled();
        expect(globalShortcut.unregister).not.toHaveBeenCalled();
        expect(again.results.every(result => result.registered)).toBe(true);

        controller.apply(['Control+Alt+Shift+P', 'Control+Alt+Shift+M']);
        expect(globalShortcut.unregister.mock.calls).toEqual([['Control+Alt+Shift+N']]);
        expect(globalShortcut.register.mock.calls.map(call => call[0])).toEqual(['Control+Alt+Shift+M']);
    });

    it('tries a refused key again on the next apply', () => {
        const taken = ['Control+Alt+Shift+N'];
        const globalShortcut = fakeGlobalShortcut(taken);
        const controller = createGlobalShortcutController({ globalShortcut, onTrigger: vi.fn(), backend: 'native' });

        expect(controller.apply(['Control+Alt+Shift+N']).results[0].registered).toBe(false);
        taken.length = 0;
        expect(controller.apply(['Control+Alt+Shift+N']).results[0].registered).toBe(true);
    });

    it('passes the pressed accelerator to onTrigger', () => {
        const globalShortcut = fakeGlobalShortcut();
        const onTrigger = vi.fn();
        const controller = createGlobalShortcutController({ globalShortcut, onTrigger, backend: 'portal' });

        expect(controller.apply(['Control+Alt+Shift+1']).backend).toBe('portal');
        globalShortcut.callbacks.get('Control+Alt+Shift+1')?.();

        expect(onTrigger).toHaveBeenCalledWith('Control+Alt+Shift+1');
    });

    it('treats a non-array request as an empty set', () => {
        const globalShortcut = fakeGlobalShortcut();
        const controller = createGlobalShortcutController({ globalShortcut, onTrigger: vi.fn(), backend: 'native' });

        controller.apply(['Control+Alt+Shift+P']);
        expect(controller.apply('Control+Alt+Shift+P').results).toEqual([]);
        expect(globalShortcut.callbacks.size).toBe(0);
    });
});

describe('usesGlobalShortcutsPortal', () => {
    it('is true only on the native Wayland backend', () => {
        expect(usesGlobalShortcutsPortal({ platform: 'linux', ozonePlatform: 'wayland' })).toBe(true);
        expect(usesGlobalShortcutsPortal({ platform: 'linux', ozonePlatform: 'x11' })).toBe(false);
        expect(usesGlobalShortcutsPortal({ platform: 'win32', ozonePlatform: 'wayland' })).toBe(false);
        expect(usesGlobalShortcutsPortal({ platform: 'darwin' })).toBe(false);
    });
});
