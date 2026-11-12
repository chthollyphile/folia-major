// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/ponder/pagePonderShortcutOtherPlatforms.test.ts
// The page-level hold-to-enter key off macOS stays literal Ctrl+G: Meta+G does not start it, and
// pressing another key mid-hold does not give it up there. Also the shared hold's opt-in rule that
// lets an entry give up when a key it does not own goes down mid-hold (what macOS relies on).

vi.hoisted(() => {
    // jsdom's user agent names the host platform; pin a Windows one so this holds on a Mac runner too.
    Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    });
});

const { isMacPlatform } = await import('@/utils/platform');
const {
    abandonsPagePonderShortcut,
    acceptsPagePonderShortcut,
    releasesPagePonderShortcut,
} = await import('@/components/ponder/hold/usePagePonderShortcut');
const { usePonderHold } = await import('@/components/ponder/hold/usePonderHold');
const { PONDER_HOLD_DURATION_MS } = await import('@/components/ponder/hold/ponderHoldProgress');

type KeyInit = Partial<Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>>;

const keyEvent = ({ key = 'g', code = 'KeyG', ctrlKey = false, metaKey = false, altKey = false, shiftKey = false }: KeyInit) => ({
    key, code, ctrlKey, metaKey, altKey, shiftKey, isComposing: false, target: null,
}) as KeyboardEvent;

describe('page Ponder shortcut off macOS', () => {
    it('runs as Windows', () => {
        expect(isMacPlatform).toBe(false);
    });

    it('accepts Ctrl+G only, as before', () => {
        // No tutorial is resolvable in this bare document, so acceptance is checked up to the
        // key rule: every chord other than Ctrl+G must already be refused by it.
        expect(acceptsPagePonderShortcut(keyEvent({ metaKey: true }))).toBe(false);
        expect(acceptsPagePonderShortcut(keyEvent({ ctrlKey: true, metaKey: true }))).toBe(false);
        expect(acceptsPagePonderShortcut(keyEvent({ ctrlKey: true, shiftKey: true }))).toBe(false);
        expect(acceptsPagePonderShortcut(keyEvent({ ctrlKey: true, altKey: true }))).toBe(false);
        expect(acceptsPagePonderShortcut(keyEvent({}))).toBe(false);
    });

    it('gives up on releasing G or Control, and not on another keydown', () => {
        expect(releasesPagePonderShortcut(keyEvent({}))).toBe(true);
        expect(releasesPagePonderShortcut(keyEvent({ key: 'Control', code: 'ControlLeft' }))).toBe(true);
        expect(releasesPagePonderShortcut(keyEvent({ key: 'Shift', code: 'ShiftLeft' }))).toBe(false);
        expect(abandonsPagePonderShortcut(keyEvent({ key: 'k', code: 'KeyK', ctrlKey: true }))).toBe(false);
    });
});

describe('usePonderHold abandonedByKeyDown', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.useFakeTimers();
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.useRealTimers();
    });

    const mount = (onFull: () => void, abandonedByKeyDown?: (event: KeyboardEvent) => boolean) => {
        const refs = { wipeRef: { current: null }, labelRef: { current: null }, holdLabelRef: { current: null } };
        const Probe = () => {
            usePonderHold({
                enabled: true,
                accepts: event => event.code === 'KeyG',
                releasedBy: event => event.code === 'KeyG',
                abandonedByKeyDown,
                onFull,
                refs,
            });
            return null;
        };
        act(() => root.render(React.createElement(Probe)));
    };

    const press = (code: string) => act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code.replace('Key', '').toLowerCase() }));
    });

    it('keeps the hold through another keydown unless the entry opts in', () => {
        const onFull = vi.fn();
        mount(onFull);
        press('KeyG');
        press('KeyK');
        act(() => { vi.advanceTimersByTime(PONDER_HOLD_DURATION_MS); });
        expect(onFull).toHaveBeenCalledTimes(1);
    });

    it('gives the hold up when another key goes down and the entry says so', () => {
        const onFull = vi.fn();
        mount(onFull, () => true);
        press('KeyG');
        press('KeyK');
        act(() => { vi.advanceTimersByTime(PONDER_HOLD_DURATION_MS * 2); });
        expect(onFull).not.toHaveBeenCalled();

        // The key it owns, auto-repeating, is not "another key".
        press('KeyG');
        press('KeyG');
        act(() => { vi.advanceTimersByTime(PONDER_HOLD_DURATION_MS); });
        expect(onFull).toHaveBeenCalledTimes(1);
    });
});
