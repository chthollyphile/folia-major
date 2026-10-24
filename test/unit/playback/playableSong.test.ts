import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';

// test/unit/playback/playableSong.test.ts
// The two "can this track be played" checks, and the inputs on which they differ. The provider
// registry is replaced by two switches: whether the provider can play, whether it marks the track
// unavailable.

const provider = vi.hoisted(() => ({ canPlay: true, marksUnavailable: false }));
vi.mock('@/services/onlineMusic/omni', () => ({ omni: { canPlaySong: () => provider.canPlay } }));
vi.mock('@/services/onlineMusic/songAvailability', () => ({ askPlayedSong: () => null, isSongUnavailable: () => provider.marksUnavailable }));

const { isQueueSongPlayable, isRestoredSongPlayable } = await import('@/components/app/playback/playableSong');

const base = { id: '1', name: 'Song', artists: [], album: { id: '', name: '' }, durationMs: 1000 };
const onlineSong = { ...base, sourceRef: { kind: 'online', providerId: 'bodian', mediaId: '1' } } as SongResult;
const localSong = { ...base, isLocal: true, localRef: { songId: 'local-1' }, sourceRef: { kind: 'local', mediaId: 'local-1' } } as unknown as SongResult;
const navidromeSong = { ...base, isNavidrome: true, sourceRef: { kind: 'navidrome', mediaId: '1' } } as unknown as SongResult;
const stageSong = { ...base, sourceRef: { kind: 'stage', mediaId: '1' } } as unknown as SongResult;
const songWithoutSource = { ...base } as SongResult;

beforeEach(() => {
    provider.canPlay = true;
    provider.marksUnavailable = false;
});

describe('isQueueSongPlayable', () => {
    it('passes local and Navidrome tracks whatever the provider says', () => {
        provider.canPlay = false;
        provider.marksUnavailable = true;
        expect(isQueueSongPlayable(localSong)).toBe(true);
        expect(isQueueSongPlayable(navidromeSong)).toBe(true);
    });

    it('passes an online track its provider can play', () => {
        expect(isQueueSongPlayable(onlineSong)).toBe(true);
    });

    it('fails an online track whose provider cannot play it', () => {
        provider.canPlay = false;
        expect(isQueueSongPlayable(onlineSong)).toBe(false);
    });

    it('fails an online track marked unavailable', () => {
        provider.marksUnavailable = true;
        expect(isQueueSongPlayable(onlineSong)).toBe(false);
    });
});

describe('isRestoredSongPlayable', () => {
    it('passes every track whose stored source is not an online one', () => {
        provider.canPlay = false;
        expect(isRestoredSongPlayable(localSong)).toBe(true);
        expect(isRestoredSongPlayable(navidromeSong)).toBe(true);
        expect(isRestoredSongPlayable(stageSong)).toBe(true);
        expect(isRestoredSongPlayable(songWithoutSource)).toBe(true);
    });

    it('passes an online track its provider can play', () => {
        expect(isRestoredSongPlayable(onlineSong)).toBe(true);
    });

    it('fails an online track whose provider cannot play it', () => {
        provider.canPlay = false;
        expect(isRestoredSongPlayable(onlineSong)).toBe(false);
    });
});

describe('where the two checks differ', () => {
    it('an online track marked unavailable fails the queue check and passes the restore check', () => {
        provider.marksUnavailable = true;
        expect(isQueueSongPlayable(onlineSong)).toBe(false);
        expect(isRestoredSongPlayable(onlineSong)).toBe(true);
    });

    it('a track that is neither local, Navidrome nor online fails the queue check and passes the restore check when no provider plays it', () => {
        provider.canPlay = false;
        expect(isQueueSongPlayable(stageSong)).toBe(false);
        expect(isRestoredSongPlayable(stageSong)).toBe(true);
        expect(isQueueSongPlayable(songWithoutSource)).toBe(false);
        expect(isRestoredSongPlayable(songWithoutSource)).toBe(true);
    });
});
