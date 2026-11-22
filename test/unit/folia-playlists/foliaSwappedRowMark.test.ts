import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';

// test/unit/folia-playlists/foliaSwappedRowMark.test.ts
// 换过来源的条目在歌单详情的行上带一个记号：记号从条目的 originalKey 来，悬停说明原来是哪个来源的歌。

vi.mock('@/services/onlineMusic/omni', () => ({
    omni: {
        getProviderLabel: (id: string) => ({ alpha: 'Alpha', beta: 'Beta' } as Record<string, string>)[id] ?? id,
        getProviderNaming: () => ({}),
        isSourceSwitchedOn: () => true,
        subscribeProviders: () => () => {},
        getProviderRegistryVersion: () => 0,
    },
}));
vi.mock('@/services/navidromeService', () => ({ getNavidromeConfig: () => ({}) }));

import { getTrackSwappedFromLabel } from '@/services/foliaPlaylist/trackSourceState';
import { resolveFoliaPlaylistTracks } from '@/components/app/home/gridViewCollectionAdapters';
import type { SongResult, UnifiedSong } from '@/types';

const t = ((key: string, options?: Record<string, unknown>) => (
    options ? `${key}${JSON.stringify(options)}` : key
)) as unknown as TFunction;

describe('the mark on a row that was switched to another source', () => {
    const snapshot = (id: string, extra: object = {}): SongResult => ({
        id, name: id, artists: [], album: { id: 1, name: 'A' }, sourceRef: { kind: 'online', providerId: 'beta', mediaId: id }, ...extra,
    } as unknown as SongResult);

    it('rides on the row from the entry, and only from the entry', () => {
        const tracks = resolveFoliaPlaylistTracks({
            entries: [
                { key: 'online:beta:1', song: snapshot('1'), addedAt: 1, originalKey: 'online:alpha:x1', fromOrigin: true },
                { key: 'online:beta:2', song: snapshot('2'), addedAt: 1 },
                // 快照里带着别处留下的记号，这一条自己没换过：拿掉。
                { key: 'online:beta:3', song: snapshot('3', { foliaOriginalKey: 'online:alpha:stale' }), addedAt: 1 },
            ],
        }, []) as UnifiedSong[];
        expect(tracks.map(track => track.foliaOriginalKey)).toEqual(['online:alpha:x1', undefined, undefined]);
        expect(tracks[2]).not.toHaveProperty('foliaOriginalKey');
        expect(getTrackSwappedFromLabel(tracks[0], t)).toBe('foliaTransfer.swappedFrom{"source":"Alpha"}');
        expect(getTrackSwappedFromLabel(tracks[1], t)).toBe('');
    });

    it('names Navidrome, and falls back to a plain line for a key it cannot read', () => {
        expect(getTrackSwappedFromLabel(snapshot('1', { foliaOriginalKey: 'navidrome:9' }), t)).toBe('foliaTransfer.swappedFrom{"source":"navidrome.title"}');
        expect(getTrackSwappedFromLabel(snapshot('1', { foliaOriginalKey: 'what' }), t)).toBe('foliaTransfer.swappedFromUnknown');
    });
});
