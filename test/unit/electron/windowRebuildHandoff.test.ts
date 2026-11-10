import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/windowRebuildHandoff.test.ts
// Pins that every rebuild of the main window the main process starts by itself asks the page for its
// playback first, as the rebuilds the page asks for do: a provider's own player (the Apple Music
// companion) and mpv outlive the window, and a rebuild that hands nothing on leaves them sounding
// with nobody following them. main.cjs cannot be required (it starts the whole app): the rebuild
// helper is taken from the source as it is and run with stand-ins for the names it uses.

const rootDir = path.resolve(__dirname, '../../../');
const mainCjs = readFileSync(path.join(rootDir, 'electron/main.cjs'), 'utf8');

const helperBody = mainCjs.match(/\nasync function rebuildMainWindowWithPlaybackHandoff\(reason, stillWanted = \(\) => true\) \{\n([\s\S]*?)\n\}\n/)?.[1] ?? '';
const functionBody = (name: string) => mainCjs.match(new RegExp(`\\nfunction ${name}\\([^)]*\\) \\{\\n([\\s\\S]*?)\\n\\}\\n`))?.[1] ?? '';
const degradeBody = mainCjs.match(/\n {2}onDegrade: \(\) => \{\n([\s\S]*?)\n {2}\},\n/)?.[1] ?? '';

const compileHelper = (deps: {
    requestWindowPlaybackHandoff: () => Promise<unknown>;
    recreateMainWindowWithTransparencyMode: (enabled: boolean, handoff: unknown) => void;
}) => new Function(
    'requestWindowPlaybackHandoff',
    'recreateMainWindowWithTransparencyMode',
    'isTransparentPlayerBackgroundEnabled',
    'console',
    `let mainProcessWindowRebuildGeneration = 0;\nreturn async (reason, stillWanted = () => true) => {\n${helperBody}\n};`,
)(
    deps.requestWindowPlaybackHandoff,
    deps.recreateMainWindowWithTransparencyMode,
    () => true,
    { log: () => {} },
) as (reason: string, stillWanted?: () => boolean) => Promise<boolean>;

describe('main-process window rebuilds and the playback handoff', () => {
    it('finds the pieces it checks in main.cjs', () => {
        expect(helperBody).not.toBe('');
        expect(functionBody('reconcileWindowsWallpaperWindowTransparency')).not.toBe('');
        expect(functionBody('recreateMainWindowWithTransparencyMode')).not.toBe('');
        expect(degradeBody).not.toBe('');
    });

    it('asks the page first and rebuilds with its answer', async () => {
        const order: string[] = [];
        const handoff = { version: 1 };
        const recreate = vi.fn(() => { order.push('rebuild'); });
        const rebuild = compileHelper({
            requestWindowPlaybackHandoff: async () => { order.push('ask'); return handoff; },
            recreateMainWindowWithTransparencyMode: recreate,
        });
        expect(await rebuild('test')).toBe(true);
        expect(order).toEqual(['ask', 'rebuild']);
        expect(recreate).toHaveBeenCalledWith(true, handoff);
    });

    it('drops a rebuild that is no longer needed once the page answered, or that a newer one superseded', async () => {
        const recreate = vi.fn();
        const answers: Array<(handoff: unknown) => void> = [];
        const rebuild = compileHelper({
            requestWindowPlaybackHandoff: () => new Promise(resolve => { answers.push(resolve); }),
            recreateMainWindowWithTransparencyMode: recreate,
        });
        const notNeeded = rebuild('test', () => false);
        answers[0]({ version: 1 });
        expect(await notNeeded).toBe(false);

        const first = rebuild('first');
        const second = rebuild('second');
        answers[1]({ version: 1, n: 1 });
        answers[2]({ version: 1, n: 2 });
        expect(await first).toBe(false);
        expect(await second).toBe(true);
        expect(recreate).toHaveBeenCalledTimes(1);
        expect(recreate).toHaveBeenCalledWith(true, { version: 1, n: 2 });
    });

    it('rebuilds for the desktop transparency and for a given-up wallpaper only through the ask', () => {
        const reconcile = functionBody('reconcileWindowsWallpaperWindowTransparency');
        expect(reconcile).toContain('rebuildMainWindowWithPlaybackHandoff(');
        expect(reconcile).not.toContain('recreateMainWindowWithTransparencyMode(');
        expect(degradeBody).toContain('rebuildMainWindowWithPlaybackHandoff(');
        expect(degradeBody).not.toContain('recreateMainWindowWithTransparencyMode(');
    });

    it('rebuilds without asking only the window it has just created at startup', () => {
        const unasked = mainCjs.match(/recreateMainWindowWithTransparencyMode\([^;]*,\s*null\)/g) ?? [];
        expect(unasked).toHaveLength(1);
        const at = mainCjs.indexOf(unasked[0] ?? '');
        expect(mainCjs.slice(Math.max(0, at - 1200), at)).toContain("attachResult === 'missing'");
    });

    it('pauses the players outside the window when the next window restores nothing', () => {
        const recreate = functionBody('recreateMainWindowWithTransparencyMode');
        const carry = recreate.indexOf('windowPlaybackHandoffStore.carryForward(');
        const pause = recreate.indexOf("pauseExternalPlayersNobodyFollows(");
        expect(carry).toBeGreaterThan(-1);
        expect(pause).toBeGreaterThan(carry);
        expect(recreate.slice(carry, pause)).toContain('!windowPlaybackHandoffStore.peek()');
        const pauser = functionBody('pauseExternalPlayersNobodyFollows');
        expect(pauser).toContain('appleMusicClient.pauseIfRunning()');
        expect(pauser).toContain('spotifyApiBridge.pauseSoloist()');
    });

    it('passes on what the replaced window read when it never answered', () => {
        expect(functionBody('recreateMainWindowWithTransparencyMode')).toContain('windowPlaybackHandoffStore.carryForward(mainWindow, lastWindowPlaybackHandoffRequestAt)');
        expect(functionBody('requestWindowPlaybackHandoff')).toContain('lastWindowPlaybackHandoffRequestAt = Date.now()');
        expect(mainCjs).toContain('windowPlaybackHandoffStore.consume(mainWindow)');
    });
});
