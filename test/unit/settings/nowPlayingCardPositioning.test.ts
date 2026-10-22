// @vitest-environment jsdom
import React, { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { motionValue } from 'framer-motion';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppViewStore } from '../../../src/stores/useAppViewStore';
import { usePlaybackStore } from '../../../src/stores/usePlaybackStore';
import { useStageSettingsStore } from '../../../src/stores/useStageSettingsStore';
import { playerBottomBarLiveOffset } from '../../../src/stores/motionSignals';
import { useNowPlayingCardLayoutStore } from '../../../src/components/app/overlays/now-playing-toast/nowPlayingCardLayoutStore';
import { useNowPlayingCardPositioningEntry } from '../../../src/components/app/overlays/now-playing-toast/useNowPlayingCardPositioningEntry';
import { useNowPlayingCardPosition } from '../../../src/components/app/overlays/now-playing-toast/useNowPlayingCardPosition';

// StrictMode replays the card mount: it must not cancel a newly opened adjustment session.
let root: Root | null;
let editor: ReturnType<typeof useNowPlayingCardPosition>;
const bottom = motionValue(32);
const navigate = vi.fn(() => useAppViewStore.getState().setView('player'));
const Editor = () => {
    const frame = useRef<HTMLDivElement>(null);
    editor = useNowPlayingCardPosition(frame, { width: 240, height: 64 }, bottom, true, () => {});
    return React.createElement('div', { ref: frame }, React.createElement('button', null, 'card'));
};
const Host = () => {
    useNowPlayingCardPositioningEntry(navigate);
    const positioning = useNowPlayingCardLayoutStore(state => state.isPositioning);
    return positioning ? React.createElement(Editor) : null;
};
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
    useAppViewStore.getState().setView('home');
    useNowPlayingCardLayoutStore.setState({ isPositioning: false, requestSeq: 0 });
    usePlaybackStore.setState({ currentSong: { id: 1, name: 'Position test' } as any, transitionDisplay: null });
    useStageSettingsStore.setState({ stageTrackPillPosition: { x: 0.4, y: 0.6 } });
    navigate.mockClear();
    playerBottomBarLiveOffset.set(120);
    root = createRoot(document.createElement('div'));
});
afterEach(async () => { await act(async () => root?.unmount()); root = null; });
const start = async () => {
    await act(async () => root!.render(React.createElement(React.StrictMode, null, React.createElement(Host))));
    await act(async () => useNowPlayingCardLayoutStore.getState().requestPositioning());
};
describe('card positioning session', () => {
    it('survives mount replay, navigates once and leaves the saved bottom-bar height alone', async () => {
        await start();
        expect(useNowPlayingCardLayoutStore.getState().isPositioning).toBe(true);
        expect(navigate).toHaveBeenCalledTimes(1);
        expect(playerBottomBarLiveOffset.get()).toBe(120);
    });
    it('cancels a reset draft and saves a reset only after confirmation', async () => {
        await start();
        await act(async () => { editor.reset(); editor.cancel(); });
        expect(useStageSettingsStore.getState().stageTrackPillPosition).toEqual({ x: 0.4, y: 0.6 });
        await act(async () => useNowPlayingCardLayoutStore.getState().requestPositioning());
        await act(async () => { editor.reset(); editor.save(); });
        expect(useStageSettingsStore.getState().stageTrackPillPosition).toBeNull();
    });
    it('keeps keyboard editing local and does not persist arrow-key drafts', async () => {
        await start();
        const left = editor.style.left;
        if (typeof left === 'number') throw new Error('Expected an editable MotionValue');
        const before = left.get();
        const preventDefault = vi.fn();
        const stopPropagation = vi.fn();
        const key = (value: string) => ({ key: value, shiftKey: true, preventDefault, stopPropagation }) as unknown as React.KeyboardEvent<HTMLButtonElement>;
        await act(async () => {
            editor.handlers.onKeyDown(key('ArrowRight'));
            editor.handlers.onKeyDown(key(' '));
            editor.handlers.onKeyDown(key('Enter'));
        });
        expect(left.get()).toBe(before + 10);
        expect(preventDefault).toHaveBeenCalledTimes(3);
        expect(stopPropagation).toHaveBeenCalledTimes(3);
        expect(useStageSettingsStore.getState().stageTrackPillPosition).toEqual({ x: 0.4, y: 0.6 });
    });

    it('cancels when leaving the player or losing the display song', async () => {
        await start();
        await act(async () => useAppViewStore.getState().setView('home'));
        expect(useNowPlayingCardLayoutStore.getState().isPositioning).toBe(false);
        await act(async () => useNowPlayingCardLayoutStore.getState().requestPositioning());
        await act(async () => usePlaybackStore.setState({ currentSong: null }));
        expect(useNowPlayingCardLayoutStore.getState().isPositioning).toBe(false);
    });
});
