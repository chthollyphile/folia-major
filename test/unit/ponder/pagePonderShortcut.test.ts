// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/ponder/pagePonderShortcut.test.ts
// The page-level hold-to-enter key on macOS: Cmd+G starts it, Ctrl+G (a different chord there) does
// not, and letting go of Cmd gives up the hold. `isMacPlatform` is read from the user agent once at
// module load, so the Mac user agent is in place before the platform module is imported.

vi.hoisted(() => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' });
});

const { isMacPlatform } = await import('@/utils/platform');
const { abandonsPagePonderShortcut, acceptsPagePonderShortcut, releasesPagePonderShortcut } = await import('@/components/ponder/hold/usePagePonderShortcut');

type KeyInit = Partial<Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>>;

const keyEvent = ({ key = 'g', code = 'KeyG', ctrlKey = false, metaKey = false, altKey = false, shiftKey = false }: KeyInit) => ({
    key, code, ctrlKey, metaKey, altKey, shiftKey, isComposing: false, target: null,
}) as KeyboardEvent;

describe('page Ponder shortcut on macOS', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('runs as a Mac', () => {
        expect(isMacPlatform).toBe(true);
    });

    it('accepts Meta+G and not Ctrl+G, nor both together', () => {
        expect(acceptsPagePonderShortcut(keyEvent({ metaKey: true }))).toBe(true);
        expect(acceptsPagePonderShortcut(keyEvent({ ctrlKey: true }))).toBe(false);
        expect(acceptsPagePonderShortcut(keyEvent({ metaKey: true, ctrlKey: true }))).toBe(false);
        expect(acceptsPagePonderShortcut(keyEvent({}))).toBe(false);
    });

    it('gives up the hold when Meta, Control or G is released', () => {
        expect(releasesPagePonderShortcut(keyEvent({ key: 'Meta', code: 'MetaLeft' }))).toBe(true);
        expect(releasesPagePonderShortcut(keyEvent({ key: 'Control', code: 'ControlLeft' }))).toBe(true);
        expect(releasesPagePonderShortcut(keyEvent({}))).toBe(true);
        expect(releasesPagePonderShortcut(keyEvent({ key: 'Shift', code: 'ShiftLeft' }))).toBe(false);
    });

    it('gives up the hold when another key goes down, since the G keyup never comes while Meta is held', () => {
        expect(abandonsPagePonderShortcut(keyEvent({ key: 'k', code: 'KeyK', metaKey: true }))).toBe(true);
    });
});
