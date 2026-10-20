import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Exercise the real Plasma scripts against panels, including interrupted changes and recovery.
const require = createRequire(import.meta.url);
interface Controller {
    hide: () => void;
    restore: () => boolean;
    recover: () => boolean;
}
interface Panel {
    id: number;
    hiding: string;
}
interface Options {
    platform: string;
    env: Record<string, string>;
    userDataPath: () => string;
    fsModule?: typeof fs;
    run: (command: string, args: string[], options: Record<string, unknown>) => string;
    logInfo: (...args: unknown[]) => void;
    logWarn: (...args: unknown[]) => void;
}
const { createKdeWallpaperPanels } = require('../../../electron/wallpaper/kdeWallpaperPanels.cjs') as {
    createKdeWallpaperPanels: (options: Options) => Controller;
};
const tempDirs: string[] = [];
afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function setup(panels: Panel[] = [{ id: 275, hiding: 'dodgewindows' }]) {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-kde-panels-'));
    tempDirs.push(userData);
    const marker = path.join(userData, '.wallpaper-kde-panels.json');
    const evaluate = (command: string, args: string[]) => {
        let output = '';
        vm.runInNewContext(args.at(-1)!, {
            panels: () => panels,
            panelById: (id: number) => panels.find(panel => panel.id === id),
            print: (value: string) => { output = value; },
        });
        return command === 'gdbus' ? `('${output}',)\n` : `${output}\n`;
    };
    const run = vi.fn((command: string, args: string[], _options: Record<string, unknown>) => evaluate(command, args));
    const options: Options = {
        platform: 'linux', env: { XDG_CURRENT_DESKTOP: 'KDE' }, userDataPath: () => userData,
        run, logInfo: vi.fn(), logWarn: vi.fn(),
    };
    return { panels, marker, evaluate, run, options, controller: createKdeWallpaperPanels(options) };
}

describe('KDE wallpaper panels', () => {
    it.each([
        ['win32', 'KDE'], ['darwin', 'KDE'], ['linux', 'GNOME'], ['linux', 'niri'], ['linux', ''],
    ])('does not touch system state on %s / %s', (platform, desktop) => {
        const h = setup();
        const controller = createKdeWallpaperPanels({ ...h.options, platform, env: { XDG_CURRENT_DESKTOP: desktop } });
        controller.hide();
        controller.restore();
        controller.recover();
        expect(h.run).not.toHaveBeenCalled();
        expect(fs.existsSync(h.marker)).toBe(false);
    });

    it('records recovery before changing only dodge panels, and restores them once', () => {
        const h = setup([
            { id: 1, hiding: 'none' }, { id: 2, hiding: 'dodgewindows' },
            { id: 3, hiding: 'autohide' }, { id: 4, hiding: 'windowsgobelow' },
            { id: 5, hiding: 'dodgewindows' },
        ]);
        h.run.mockImplementation((command, args) => {
            if (args.at(-1)!.includes("panel.hiding = 'autohide'")) {
                expect(JSON.parse(fs.readFileSync(h.marker, 'utf8'))).toEqual([2, 5]);
            }
            return h.evaluate(command, args);
        });
        h.controller.hide();
        expect(h.panels.map(panel => panel.hiding)).toEqual(['none', 'autohide', 'autohide', 'windowsgobelow', 'autohide']);
        const hideCalls = h.run.mock.calls.length;
        h.controller.hide();
        expect(h.run).toHaveBeenCalledTimes(hideCalls);
        expect(h.controller.restore()).toBe(true);
        expect(h.panels.map(panel => panel.hiding)).toEqual(['none', 'dodgewindows', 'autohide', 'windowsgobelow', 'dodgewindows']);
        expect(fs.existsSync(h.marker)).toBe(false);
        h.controller.restore();
        expect(h.run).toHaveBeenCalledTimes(hideCalls + 1);
    });

    it('preserves manual changes, deleted panels and unrelated newly added panels on exit', () => {
        const h = setup([{ id: 1, hiding: 'dodgewindows' }, { id: 2, hiding: 'dodgewindows' }]);
        h.controller.hide();
        h.panels[0].hiding = 'none';
        h.panels.splice(1, 1);
        h.panels.push({ id: 3, hiding: 'autohide' });
        expect(h.controller.restore()).toBe(true);
        expect(h.panels).toEqual([{ id: 1, hiding: 'none' }, { id: 3, hiding: 'autohide' }]);
    });

    it('recovers a crashed session before the next wallpaper enters', () => {
        const h = setup();
        h.controller.hide();
        const next = createKdeWallpaperPanels(h.options);
        expect(next.recover()).toBe(true);
        expect(h.panels[0].hiding).toBe('dodgewindows');
        next.hide();
        expect(h.panels[0].hiding).toBe('autohide');
        next.restore();
        expect(h.panels[0].hiding).toBe('dodgewindows');
    });

    it('does not claim or restore panels already configured to auto-hide', () => {
        const h = setup([{ id: 1, hiding: 'autohide' }]);
        h.controller.hide();
        h.controller.restore();
        expect(h.run).toHaveBeenCalledTimes(1);
        expect(fs.existsSync(h.marker)).toBe(false);
        expect(h.panels[0].hiding).toBe('autohide');
    });

    it('leaves panels untouched if the recovery marker cannot be saved', () => {
        const h = setup();
        const error = new Error('disk full');
        const controller = createKdeWallpaperPanels({
            ...h.options, fsModule: { ...fs, renameSync: () => { throw error; } },
        });
        controller.hide();
        expect(h.panels[0].hiding).toBe('dodgewindows');
        expect(h.run).toHaveBeenCalledTimes(1);
        expect(h.options.logWarn).toHaveBeenCalledWith(expect.any(String), error);
    });

    it('rolls back even when a failed D-Bus reply followed a successful change', () => {
        const h = setup();
        h.run.mockImplementation((command, args) => {
            const output = h.evaluate(command, args);
            if (args.at(-1)!.includes("panel.hiding = 'autohide'")) throw new Error('reply lost');
            return output;
        });
        h.controller.hide();
        expect(h.panels[0].hiding).toBe('dodgewindows');
        expect(fs.existsSync(h.marker)).toBe(false);
    });

    it('keeps a failed restore recoverable by a later process', () => {
        const h = setup();
        h.controller.hide();
        h.run.mockImplementationOnce(() => { throw new Error('Plasma unavailable'); });
        expect(h.controller.restore()).toBe(false);
        expect(fs.existsSync(h.marker)).toBe(true);
        expect(createKdeWallpaperPanels(h.options).recover()).toBe(true);
        expect(h.panels[0].hiding).toBe('dodgewindows');
        expect(fs.existsSync(h.marker)).toBe(false);
    });

    it('verifies that Plasma accepted the requested mode', () => {
        const h = setup();
        Object.defineProperty(h.panels[0], 'hiding', { get: () => 'dodgewindows', set: () => {} });
        h.controller.hide();
        expect(h.options.logWarn).toHaveBeenCalledWith(
            expect.any(String), expect.objectContaining({ message: expect.stringContaining('auto-hide did not apply') }),
        );
        expect(fs.existsSync(h.marker)).toBe(false);
    });

    it('retains the recovery marker if Plasma refuses to restore a panel', () => {
        const h = setup();
        h.controller.hide();
        Object.defineProperty(h.panels[0], 'hiding', {
            configurable: true, get: () => 'autohide', set: () => {},
        });
        expect(h.controller.restore()).toBe(false);
        expect(JSON.parse(fs.readFileSync(h.marker, 'utf8'))).toEqual([275]);
        Object.defineProperty(h.panels[0], 'hiding', { value: 'autohide', writable: true });
        expect(h.controller.restore()).toBe(true);
        expect(h.panels[0].hiding).toBe('dodgewindows');
    });

    it.each(['null', '{}', '[-1]', '["275"]', '[1.5]', 'invalid json'])(
        'refuses to overwrite an invalid recovery marker: %s', (marker) => {
            const h = setup();
            fs.writeFileSync(h.marker, marker);
            expect(h.controller.recover()).toBe(false);
            h.controller.hide();
            expect(h.run).not.toHaveBeenCalled();
            expect(fs.readFileSync(h.marker, 'utf8')).toBe(marker);
        },
    );

    it('falls back to qdbus6 when gdbus is missing, including mixed desktop identifiers', () => {
        const h = setup();
        h.run.mockImplementation((command, args) => {
            if (command === 'gdbus') throw Object.assign(new Error('missing gdbus'), { code: 'ENOENT' });
            return h.evaluate(command, args);
        });
        const controller = createKdeWallpaperPanels({ ...h.options, env: { XDG_CURRENT_DESKTOP: 'other:kde' } });
        controller.hide();
        expect(h.panels[0].hiding).toBe('autohide');
        controller.restore();
        expect(h.panels[0].hiding).toBe('dodgewindows');
        expect(h.run.mock.calls.some(([command]) => command === 'qdbus6')).toBe(true);
    });

    it('does not change panels when the session bus is denied', () => {
        const h = setup();
        const error = Object.assign(new Error('access denied'), { code: 'EACCES' });
        h.run.mockImplementation(() => { throw error; });
        h.controller.hide();
        expect(h.panels[0].hiding).toBe('dodgewindows');
        expect(h.run).toHaveBeenCalledTimes(1);
        expect(fs.existsSync(h.marker)).toBe(false);
        expect(h.options.logWarn).toHaveBeenCalledWith(expect.any(String), error);
    });
});
