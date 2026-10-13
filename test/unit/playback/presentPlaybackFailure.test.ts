import { describe, expect, it, vi } from 'vitest';
import { PlayerState, type StatusMessage } from '@/types';
import type { PlaybackFailure } from '@/types/playbackFailure';
import { presentPlaybackFailure, type PlaybackFailurePresentation } from '@/components/app/playback/presentPlaybackFailure';

// test/unit/playback/presentPlaybackFailure.test.ts

const network: PlaybackFailure = { reason: 'network', stage: 'resolve-url' };
const takenDown: PlaybackFailure = { reason: 'taken-down', stage: 'resolve-url' };

function setup(overrides: Partial<PlaybackFailurePresentation> = {}) {
    let message: StatusMessage | null = null;
    const calls: string[] = [];
    const setStatusMsg = vi.fn((next: StatusMessage | null | ((prev: StatusMessage | null) => StatusMessage | null)) => {
        message = typeof next === 'function' ? next(message) : next;
        if (message === null) calls.push('clear');
    });
    const deps = {
        t: (key: string) => key,
        setStatusMsg,
        setPlayerState: vi.fn(),
        audioRef: { current: { pause: vi.fn() } },
        shouldAutoPlayRef: { current: true },
        setIsLyricsLoading: vi.fn(),
        showTimedSkipPrompt: vi.fn(),
        maxAutoSkipCount: 2,
    };
    const input: PlaybackFailurePresentation = {
        failure: network,
        context: 'play',
        isCurrent: () => true,
        skipCount: 0,
        retry: vi.fn(() => { calls.push('retry'); }),
        skip: vi.fn(() => { calls.push('skip'); }),
        ...overrides,
    };
    return { deps, input, calls, message: () => message, present: () => presentPlaybackFailure(input, deps) };
}

describe('presentPlaybackFailure', () => {
    it('has no side effects for a stale request', () => {
        const { deps, input, present } = setup({ isCurrent: () => false, failure: takenDown });
        present();
        expect(deps.setIsLyricsLoading).not.toHaveBeenCalled();
        expect(deps.setStatusMsg).not.toHaveBeenCalled();
        expect(deps.setPlayerState).not.toHaveBeenCalled();
        expect(deps.showTimedSkipPrompt).not.toHaveBeenCalled();
        expect(deps.audioRef.current.pause).not.toHaveBeenCalled();
        expect(deps.shouldAutoPlayRef.current).toBe(true);
        expect(input.retry).not.toHaveBeenCalled();
        expect(input.skip).not.toHaveBeenCalled();
    });

    it('counts down for a taken-down song without stopping playback', () => {
        let current = true;
        const { deps, input, present } = setup({ failure: takenDown, isCurrent: () => current });
        present();
        expect(deps.showTimedSkipPrompt).toHaveBeenCalledWith('status.songUnavailablePrompt', expect.any(Function));
        expect(deps.setIsLyricsLoading).toHaveBeenCalledWith(false);
        expect(deps.audioRef.current.pause).not.toHaveBeenCalled();
        expect(deps.setPlayerState).not.toHaveBeenCalled();
        expect(deps.setStatusMsg).not.toHaveBeenCalled();

        const onSkip = deps.showTimedSkipPrompt.mock.calls[0][1] as () => void;
        current = false;
        onSkip();
        expect(input.skip).not.toHaveBeenCalled();
        current = true;
        onSkip();
        expect(input.skip).toHaveBeenCalledOnce();
    });

    it.each([
        ['the automatic skips are used up', { skipCount: 2 }],
        ['there is no next song', { skip: undefined }],
    ] as const)('falls back to a plain taken-down message when %s', (_case, overrides) => {
        const { deps, message, present } = setup({ failure: takenDown, ...overrides });
        present();
        expect(deps.showTimedSkipPrompt).not.toHaveBeenCalled();
        expect(deps.audioRef.current.pause).not.toHaveBeenCalled();
        expect(message()).toEqual({ type: 'error', text: 'status.songUnavailable' });
    });

    it('stops playback and offers retry and skip for a network failure', () => {
        const { deps, message, present } = setup();
        present();
        expect(deps.shouldAutoPlayRef.current).toBe(false);
        expect(deps.audioRef.current.pause).toHaveBeenCalledOnce();
        expect(deps.setPlayerState).toHaveBeenCalledWith(PlayerState.IDLE);
        expect(deps.showTimedSkipPrompt).not.toHaveBeenCalled();
        expect(message()).toMatchObject({
            type: 'error', text: 'status.songNetworkFailed', persistent: true,
            actionLabel: 'ui.retry', cancelLabel: 'status.skipUnavailableAction',
        });
    });

    it('pauses rather than idles for a mid-playback failure', () => {
        const { deps, present } = setup({ context: 'mid-playback' });
        present();
        expect(deps.setPlayerState).toHaveBeenCalledWith(PlayerState.PAUSED);
    });

    it('re-checks the request and clears the message before running a button action', () => {
        const { calls, message, present } = setup();
        present();
        const shown = message()!;

        shown.onAction?.();
        expect(calls).toEqual(['clear', 'retry']);
        shown.onCancel?.();
        expect(calls).toEqual(['clear', 'retry', 'clear', 'skip']);
    });

    it('lets a stale button dismiss its own message without running the action', () => {
        let current = true;
        const { input, message, present } = setup({ isCurrent: () => current });
        present();
        const shown = message()!;

        current = false;
        shown.onAction?.();
        expect(message()).toBeNull();
        shown.onCancel?.();
        expect(message()).toBeNull();
        expect(input.retry).not.toHaveBeenCalled();
        expect(input.skip).not.toHaveBeenCalled();
    });

    it('leaves a newer message alone when a stale button is pressed', () => {
        let current = true;
        const { deps, input, message, present } = setup({ isCurrent: () => current });
        present();
        const shown = message()!;
        const newer: StatusMessage = { type: 'info', text: 'status.loadingSong' };
        deps.setStatusMsg(newer);

        current = false;
        shown.onAction?.();
        shown.onCancel?.();
        expect(message()).toBe(newer);
        expect(input.retry).not.toHaveBeenCalled();
        expect(input.skip).not.toHaveBeenCalled();
    });

    it('dismisses with cancel when there is no next song to skip to', () => {
        const { input, message, present } = setup({ failure: { reason: 'unknown', stage: 'resolve-url' }, skip: undefined });
        present();
        expect(message()).toMatchObject({ actionLabel: 'ui.retry', cancelLabel: 'status.cancel' });
        message()?.onCancel?.();
        expect(message()).toBeNull();
        expect(input.retry).not.toHaveBeenCalled();
    });

    it('offers only skip when retrying cannot help', () => {
        const { message, present } = setup({ failure: { reason: 'not-signed-in', stage: 'resolve-url' } });
        present();
        expect(message()).toMatchObject({
            text: 'status.songLoginRequired', actionLabel: 'status.skipUnavailableAction', cancelLabel: 'status.cancel',
        });
    });
});
