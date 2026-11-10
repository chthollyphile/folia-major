import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import { installPlaybackFailedListener, notifyPlaybackFailed, type PlaybackFailedNotice } from '@/services/hostExtensionHooks';

// test/unit/playback/playbackFailedNotice.test.ts
// The host's playback failure notice (services/hostExtensionHooks): a no-op until the extension
// layer installs a listener, and a throwing listener never reaches the playback code that reported.

const notice: PlaybackFailedNotice = {
    song: { id: 1, name: 'Song', artists: [], album: { id: 0, name: '' }, durationMs: 0 } as unknown as SongResult,
    reason: 'unreachable',
    phase: 'play',
    willAutoSkip: false,
};

afterEach(() => {
    installPlaybackFailedListener(null);
    vi.restoreAllMocks();
});

describe('playback failed notice', () => {
    it('does nothing without a listener', () => {
        expect(() => notifyPlaybackFailed(notice)).not.toThrow();
    });

    it('hands the notice to the installed listener as is', () => {
        const listener = vi.fn();
        installPlaybackFailedListener(listener);
        notifyPlaybackFailed(notice);
        expect(listener).toHaveBeenCalledOnce();
        expect(listener).toHaveBeenCalledWith(notice);
    });

    it('stops reporting once the listener is removed', () => {
        const listener = vi.fn();
        installPlaybackFailedListener(listener);
        installPlaybackFailedListener(null);
        notifyPlaybackFailed(notice);
        expect(listener).not.toHaveBeenCalled();
    });

    it('contains a throwing listener', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        installPlaybackFailedListener(() => { throw new Error('boom'); });
        expect(() => notifyPlaybackFailed(notice)).not.toThrow();
        expect(warn).toHaveBeenCalledOnce();
    });
});
