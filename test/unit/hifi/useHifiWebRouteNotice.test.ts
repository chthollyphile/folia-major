// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type { SongResult } from '@/types';
import { PlayerState } from '@/types';

// test/unit/hifi/useHifiWebRouteNotice.test.ts
// With HiFi on, an online song still plays on the Web engine: the first one that starts playing in a session
// says so once, and names exclusive mode when it is on outside Linux. Local songs, HiFi off, no mpv, a song
// that is only loading: no notice.

vi.hoisted(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key), clear: () => values.clear(),
    } });
});

const { maybeShowHifiWebRouteNotice, resetHifiWebRouteNotice } = await import('@/components/hifi/useHifiWebRouteNotice');
const { useHifiEngineStore } = await import('@/services/hifi/hifiEngine');
const { useHifiSettingsStore } = await import('@/stores/useHifiSettingsStore');
const { useStatusMessageStore } = await import('@/stores/useStatusMessageStore');

const t = ((key: string) => key) as unknown as TFunction;
const online = { id: 7, name: 'Online song' } as unknown as SongResult;
const local = { id: 'song-1', name: 'Song', isLocal: true, localRef: { songId: 'song-1' }, sourceRef: { kind: 'local', mediaId: 'song-1' } } as unknown as SongResult;
const message = () => useStatusMessageStore.getState().message;

const setPlatform = (platform: string | undefined) => {
    (window as unknown as { electron: unknown }).electron = platform ? { platform } : undefined;
};

beforeEach(() => {
    resetHifiWebRouteNotice();
    useStatusMessageStore.setState({ message: null });
    useHifiSettingsStore.setState({ enabled: true, exclusive: false });
    useHifiEngineStore.setState({ supported: true, runtime: { available: true } as never });
    setPlatform('win32');
});

afterEach(() => {
    setPlatform(undefined);
});

describe('maybeShowHifiWebRouteNotice', () => {
    it('says once per session that an online song does not go through HiFi', () => {
        maybeShowHifiWebRouteNotice(online, PlayerState.PLAYING, t);
        expect(message()).toEqual({ type: 'info', text: 'hifi.notice.onlineNotHifi', note: 'hifi.notice.onlineNotHifiNote' });

        useStatusMessageStore.setState({ message: null });
        maybeShowHifiWebRouteNotice(online, PlayerState.PLAYING, t);
        expect(message()).toBeNull();
    });

    it('names exclusive mode when it is on, except on Linux where there is none', () => {
        useHifiSettingsStore.setState({ exclusive: true });
        maybeShowHifiWebRouteNotice(online, PlayerState.PLAYING, t);
        expect(message()?.note).toBe('hifi.notice.onlineNotHifiExclusiveNote');

        resetHifiWebRouteNotice();
        setPlatform('linux');
        maybeShowHifiWebRouteNotice(online, PlayerState.PLAYING, t);
        expect(message()?.note).toBe('hifi.notice.onlineNotHifiNote');
    });

    it('stays quiet for a local song, a song that is not playing yet, HiFi off, or no mpv', () => {
        maybeShowHifiWebRouteNotice(local, PlayerState.PLAYING, t);
        maybeShowHifiWebRouteNotice(online, PlayerState.IDLE, t);
        maybeShowHifiWebRouteNotice(null, PlayerState.PLAYING, t);
        useHifiSettingsStore.setState({ enabled: false });
        maybeShowHifiWebRouteNotice(online, PlayerState.PLAYING, t);
        useHifiSettingsStore.setState({ enabled: true });
        useHifiEngineStore.setState({ runtime: { available: false } as never });
        maybeShowHifiWebRouteNotice(online, PlayerState.PLAYING, t);
        expect(message()).toBeNull();
    });
});
