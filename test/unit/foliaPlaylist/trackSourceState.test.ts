import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type { SongResult } from '@/types';
import { omni } from '@/services/onlineMusic/omni';
import * as navidromeService from '@/services/navidromeService';
import {
    getTrackSourceKey,
    getTrackSourceLabel,
    getTrackUnplayableLabel,
    isTrackShownUnplayable,
    isTrackSourceUnavailable,
    trackSourceHue,
} from '@/services/foliaPlaylist/trackSourceState';
import { foliaPlaylistEntryKeyOf } from '@/library/core/collection/mutations/collectionMutationCapabilities';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';

// test/unit/foliaPlaylist/trackSourceState.test.ts
// 聚合歌单里一行歌「现在播不播得了」与来源标签：音源停用 / 没装、Navidrome 没配置时置灰并说明原因；
// 来源标签只是字，颜色由来源身份算出来。

const t = ((key: string) => key) as unknown as TFunction;
const online = (providerId: string, id: string, patch: Partial<SongResult> = {}): SongResult => ({
    id,
    name: id,
    artists: [],
    album: { id: 0, name: '' },
    durationMs: 1,
    sourceRef: { kind: 'online', providerId, mediaId: id },
    ...patch,
} as unknown as SongResult);
const navidrome = (id: string): SongResult => ({
    id, name: id, artists: [], album: { id: 0, name: '' }, durationMs: 1, sourceRef: { kind: 'navidrome', mediaId: id },
} as unknown as SongResult);
const local = (songId: string): SongResult => ({
    id: `local-${songId}`, name: songId, artists: [], album: { id: 0, name: '' }, durationMs: 1,
    sourceRef: { kind: 'local', mediaId: songId }, localRef: { songId },
} as unknown as SongResult);

const sources = (state: Record<string, 'on' | 'off'>) => {
    vi.spyOn(omni, 'getProviderNaming').mockImplementation(id => (id in state ? { displayName: `Name ${id}`, shortName: id } : null));
    vi.spyOn(omni, 'isSourceSwitchedOn').mockImplementation(id => state[id] !== 'off');
    vi.spyOn(omni, 'getProviderLabel').mockImplementation(id => `Label ${id}`);
};

afterEach(() => vi.restoreAllMocks());

describe('track source state', () => {
    it('a song of a source that is on plays; off or not installed does not, and says why', () => {
        sources({ alpha: 'on', beta: 'off' });
        expect(isTrackShownUnplayable(online('alpha', '1'))).toBe(false);
        expect(isTrackSourceUnavailable(online('beta', '2'))).toBe(true);
        expect(getTrackUnplayableLabel(online('beta', '2'), t, 'gone')).toBe('foliaPlaylist.sourceOff');
        expect(getTrackUnplayableLabel(online('gamma', '3'), t, 'gone')).toBe('foliaPlaylist.sourceMissing');
        expect(getTrackUnplayableLabel(online('alpha', '1'), t, 'gone')).toBe('');
    });

    it('a Navidrome song needs a configured server; a local row always counts as there', () => {
        sources({});
        const config = vi.spyOn(navidromeService, 'getNavidromeConfig').mockReturnValue(null);
        expect(getTrackUnplayableLabel(navidrome('n1'), t, 'gone')).toBe('foliaPlaylist.navidromeUnconfigured');
        config.mockReturnValue({} as ReturnType<typeof navidromeService.getNavidromeConfig>);
        expect(isTrackShownUnplayable(navidrome('n1'))).toBe(false);
        expect(isTrackShownUnplayable(local('s1'))).toBe(false);
    });

    it('labels a row by its source with words only, and colours it from the source identity', () => {
        sources({ alpha: 'on' });
        expect(getTrackSourceLabel(online('alpha', '1'), t)).toBe('Label alpha');
        expect(getTrackSourceLabel(navidrome('n1'), t)).toBe('navidrome.title');
        expect(getTrackSourceLabel(local('s1'), t)).toBe('scratchpad.sourceLocal');
        expect(getTrackSourceKey(online('alpha', '1'))).toBe('online:alpha');
        expect(getTrackSourceKey(local('s1'))).toBe('local');
        const hue = trackSourceHue('online:alpha');
        expect(hue).toBe(trackSourceHue('online:alpha'));
        expect(hue).toBeGreaterThanOrEqual(0);
        expect(hue).toBeLessThan(360);
    });

    it('the entry key of a row: local songs by library id, everything else by the playback key', () => {
        expect(foliaPlaylistEntryKeyOf(local('s1'))).toBe('local:s1');
        const song = online('alpha', '7');
        expect(foliaPlaylistEntryKeyOf(song)).toBe(getPlaybackSongKey(song));
    });
});
