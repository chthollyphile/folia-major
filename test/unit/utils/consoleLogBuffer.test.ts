import { beforeEach, describe, expect, it } from 'vitest';
import {
    clearConsoleLog,
    formatConsoleLog,
    getConsoleLogEntries,
    installConsoleLogCapture,
    isConsoleCaptureEnabled,
    setConsoleCaptureEnabled,
} from '../../../src/utils/consoleLogBuffer';

// The suite runs on the node environment. Capture also listens for uncaught errors on `window`,
// which is not what is under test here, so a stub is enough to let the install run.
(globalThis as unknown as { window: { addEventListener: () => void } }).window = { addEventListener: () => {} };
// The module patches console once per process and never unpatches, which is what the app wants
// and what makes this file order-independent: installing again is a no-op.
installConsoleLogCapture();

describe('consoleLogBuffer scopes', () => {
    beforeEach(() => {
        clearConsoleLog();
    });

    it('reads the [Module] prefix the app already writes', () => {
        console.log('[Automix] blending 7.68s - bassSwap');
        console.warn('[KugouProvider] login-status:error');

        expect(getConsoleLogEntries().map(entry => entry.scope)).toEqual(['Automix', 'KugouProvider']);
    });

    it('leaves the prefix in the text, so a copied log keeps its familiar shape', () => {
        console.log('[Prefetch] Audio already cached for: Starry Eyes');

        expect(getConsoleLogEntries()[0].text).toBe('[Prefetch] Audio already cached for: Starry Eyes');
    });

    it('has no scope for a line that never announced one', () => {
        console.log('Restoring last song');
        // A bracket that is not a prefix must not be mistaken for one.
        console.log('finished [after] a while');
        // Nor one with a space in it, which is prose rather than a tag.
        console.log('[not a tag] something');

        expect(getConsoleLogEntries().map(entry => entry.scope)).toEqual([null, null, null]);
    });

    it('formats only the lines it is given, which is how a selection gets copied', () => {
        console.log('[A] first');
        console.log('[B] second');
        console.log('[A] third');

        const onlyA = getConsoleLogEntries().filter(entry => entry.scope === 'A');
        const text = formatConsoleLog(onlyA);

        expect(text.split('\n')).toHaveLength(2);
        expect(text).toContain('[A] first');
        expect(text).toContain('[A] third');
        expect(text).not.toContain('second');
    });
});

describe('console capture switch', () => {
    beforeEach(() => {
        setConsoleCaptureEnabled(true);
        clearConsoleLog();
    });

    it('records by default - a log that has to be switched on first is never there when needed', () => {
        expect(isConsoleCaptureEnabled()).toBe(true);
    });

    it('stops recording, and drops what it was holding', () => {
        console.log('[A] before');
        expect(getConsoleLogEntries()).toHaveLength(1);

        setConsoleCaptureEnabled(false);
        expect(getConsoleLogEntries()).toHaveLength(0);

        console.log('[A] after');
        expect(getConsoleLogEntries()).toHaveLength(0);
    });

    it('records again once switched back on', () => {
        setConsoleCaptureEnabled(false);
        console.log('[A] ignored');
        setConsoleCaptureEnabled(true);
        console.log('[A] kept');

        expect(getConsoleLogEntries().map(entry => entry.text)).toEqual(['[A] kept']);
    });
});
