import { describe, expect, it } from 'vitest';
import type { SongResult, UnifiedSong } from '@/types';
import type { OmniExploreSection, ProviderCollection } from '@/types/onlineMusic';
import { withExploreSongPreviews, withExploreTileSongPreviews, type ExplorePreviewPlayback } from '@/components/app/home/explore/exploreSongPreviews';
import { faceOf } from '@/components/app/home/explore/exploreFace';
import { buildExploreTiles, handedEntriesOf, sectionsOfTiles } from '@/components/app/lattice/exploreWall';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';

// Recommendation previews follow playback ownership rather than a song's appearance elsewhere in the app.

const song = (id: string, providerId = 'probe'): UnifiedSong => ({
    id, name: `Song ${id}`, artists: [{ id: 'artist', name: 'Artist' }],
    album: { id: 'album', name: 'Album', coverUrl: `https://example.invalid/${id}.jpg` }, durationMs: 120000,
    sourceRef: { kind: 'online', providerId, mediaId: id },
});
const firstFm = song('first-fm');
const firstDaily = song('first-daily');
const current = song('current');
const acceptedFm = (songs: SongResult[] = [current], providerId = 'probe') => ({
    providerId, selection: { mode: 'DEFAULT' as const, scene: null }, songKeys: new Set(songs.map(getPlaybackSongKey)),
});
const collections = (): ProviderCollection[] => [{
    providerId: 'probe', id: 'personal_fm', type: 'radio', name: 'Recommended for You',
    personalFm: { mode: 'DEFAULT', scene: null }, songPreview: { firstSong: firstFm },
}, {
    providerId: 'probe', id: 'daily', type: 'daily_recommendations', name: 'Daily 30',
    songPreview: { firstSong: firstDaily },
}];
const sections = (): OmniExploreSection[] => [{
    id: 'featured', title: 'For you', items: collections().map(collection => ({ kind: 'collection', collection })),
}, { id: 'ordinary', title: 'Other songs', items: [{ kind: 'song', song: current }] }];
const playback = (patch: Partial<ExplorePreviewPlayback> = {}): ExplorePreviewPlayback => ({
    song: null, queue: [], acceptedFmPlayback: null, playingFrom: null, ...patch,
});
const shown = (value: OmniExploreSection[], index: number) => {
    const item = value[0].items[index];
    if (item.kind !== 'collection') throw new Error('Expected a collection');
    return item.collection;
};
const dailySource = { source: 'online' as const, providerId: 'probe', type: 'daily_recommendations', id: 'daily' };

describe('Explore recommendation song previews', () => {
    it('follows a station across its modes without claiming the distinct Personal FM', () => {
        const original = sections();
        shown(original, 0).personalFm = { mode: 'DEFAULT', scene: null, station: 'station-a' };
        const choice = { mode: 'SCENE_RCMD' as const, scene: 'rain', station: 'station-a' };
        const station = { ...acceptedFm(), selection: choice };
        const currentView = withExploreSongPreviews(original, playback({ song: current, queue: [current], acceptedFmPlayback: station }));
        expect(shown(currentView, 0).songPreview?.currentSong).toBe(current);
        expect(shown(currentView, 0).personalFm).toEqual(choice);
        const changedMode = { ...station, selection: { mode: 'FAMILIAR' as const, scene: null, station: 'station-a' } };
        expect(shown(withExploreSongPreviews(currentView, playback({ song: current, queue: [current], acceptedFmPlayback: changedMode })), 0).personalFm).toEqual(changedMode.selection);
        expect(shown(original, 0).personalFm).toEqual({ mode: 'DEFAULT', scene: null, station: 'station-a' });
        const privateFm = withExploreSongPreviews(original, playback({ song: current, queue: [current], acceptedFmPlayback: acceptedFm() }));
        expect(shown(privateFm, 0).songPreview?.currentSong).toBeUndefined();
        expect(shown(withExploreSongPreviews(original, playback()), 0).songPreview?.firstSong).toBe(firstFm);
    });

    it('keeps provider first songs and existing object references before playback', () => {
        const original = sections();
        expect(withExploreSongPreviews(original, playback())).toBe(original);
        expect(shown(original, 0).songPreview).toEqual({ firstSong: firstFm });
        expect(shown(original, 1).songPreview).toEqual({ firstSong: firstDaily });
    });

    it('follows the current FM song without changing the card identity, first preview or other entries', () => {
        const original = sections();
        const next = withExploreSongPreviews(original, playback({ song: current, queue: [firstFm, current], acceptedFmPlayback: acceptedFm() }));
        expect(shown(next, 0)).toMatchObject({
            id: 'personal_fm', type: 'radio', name: 'Recommended for You',
            personalFm: { mode: 'DEFAULT', scene: null }, songPreview: { firstSong: firstFm, currentSong: current },
        });
        expect(shown(original, 0).songPreview).toEqual({ firstSong: firstFm });
        expect(next[0].items[1]).toBe(original[0].items[1]);
        expect(next[1]).toBe(original[1]);
        // Pausing changes no ownership input, so the same current-song preview remains in place.
        expect(withExploreSongPreviews(next, playback({ song: current, queue: [current], acceptedFmPlayback: acceptedFm() }))).toBe(next);
    });

    it('uses FM playback when no first preview was available', () => {
        const original = sections();
        shown(original, 0).songPreview = {};
        expect(shown(withExploreSongPreviews(original, playback({ song: current, queue: [current], acceptedFmPlayback: acceptedFm() })), 0).songPreview)
            .toEqual({ currentSong: current });
    });

    it.each([
        { name: 'an ordinary queue or a pending FM request', patch: { acceptedFmPlayback: null } },
        { name: 'another provider', patch: { song: song('current', 'other'), queue: [song('current', 'other')] } },
        { name: 'a held outgoing song outside the new FM queue', patch: { queue: [firstFm] } },
        { name: 'another FM scene', patch: { acceptedFmPlayback: { ...acceptedFm(), selection: { mode: 'SCENE_RCMD' as const, scene: 'rain' } } } },
        { name: 'an unrelated accepted FM batch', patch: { acceptedFmPlayback: acceptedFm([firstFm]) } },
    ])('does not replace FM with a song from $name', ({ patch }) => {
        const original = sections();
        expect(withExploreSongPreviews(original, playback({ song: current, queue: [current], acceptedFmPlayback: acceptedFm(), ...patch }))).toBe(original);
    });

    it('follows Daily 30 only when that exact provider collection owns playback', () => {
        const original = sections();
        const next = withExploreSongPreviews(original, playback({ song: current, queue: [current], playingFrom: dailySource }));
        expect(shown(next, 1).songPreview).toEqual({ firstSong: firstDaily, currentSong: current });
        expect(next[0].items[0]).toBe(original[0].items[0]);
        for (const source of [null, { ...dailySource, id: 'another' }, { ...dailySource, providerId: 'other' }, { ...dailySource, type: 'playlist' }]) {
            expect(withExploreSongPreviews(original, playback({ song: current, queue: [current], playingFrom: source }))).toBe(original);
        }
    });

    it('clears a previous current preview after ownership ends and keeps the first song', () => {
        const original = sections();
        const playing = withExploreSongPreviews(original, playback({ song: current, queue: [current], playingFrom: dailySource }));
        const ended = withExploreSongPreviews(playing, playback({ song: current, queue: [current] }));
        expect(shown(ended, 1).songPreview).toEqual({ firstSong: firstDaily, currentSong: undefined });
        expect(shown(playing, 1).songPreview?.currentSong).toBe(current);
    });

    it('leaves collections that did not opt into song previews untouched', () => {
        const original = sections();
        delete shown(original, 0).songPreview;
        delete shown(original, 1).songPreview;
        expect(withExploreSongPreviews(original, playback({ song: current, queue: [current], acceptedFmPlayback: acceptedFm() }))).toBe(original);
    });

    it('normalizes a legacy current song before exposing it as a unified preview', () => {
        const legacy: SongResult = { ...current, sourceRef: undefined };
        const original = sections();
        shown(original, 0).providerId = 'netease';
        const next = withExploreSongPreviews(original, playback({ song: legacy, queue: [legacy], acceptedFmPlayback: acceptedFm([legacy], 'netease') }));
        expect(shown(next, 0).songPreview?.currentSong?.sourceRef).toEqual({ kind: 'online', providerId: 'netease', mediaId: 'current' });
        expect(legacy.sourceRef).toBeUndefined();
    });

    it('updates a held wall while keeping the raw entries and section geometry unchanged', () => {
        const entries = buildExploreTiles(sections(), key => key);
        const held = { read: 1, entries };
        const geometry = sectionsOfTiles(entries);
        // A refresh or further read deliberately holds the previous tile array.
        expect(handedEntriesOf(held, 1, [], 'wait')).toBe(held);
        const next = withExploreTileSongPreviews(held.entries, playback({ song: current, queue: [current], acceptedFmPlayback: acceptedFm() }), key => key);
        expect(next[0]).toMatchObject({ title: 'Recommended for You', coverUrl: current.album.coverUrl, collection: { songPreview: { currentSong: current } } });
        expect(next[0].artist).toContain('Song current');
        expect(next.map(tile => [tile.id, tile.queueIndex, tile.sectionKey, tile.entryKind])).toEqual(entries.map(tile => [tile.id, tile.queueIndex, tile.sectionKey, tile.entryKind]));
        expect(sectionsOfTiles(next)).toEqual(geometry);
        expect(next[1]).toBe(entries[1]);
        expect(next[2]).toBe(entries[2]);
        expect(entries[0].kind === 'collection' && entries[0].collection.songPreview?.currentSong).toBeUndefined();
    });

    it('uses the unchanged raw wall after another playback source takes over', () => {
        const entries = buildExploreTiles(sections(), key => key);
        expect(withExploreTileSongPreviews(entries, playback({ song: current, queue: [current] }), key => key)).toBe(entries);
        expect(withExploreTileSongPreviews(entries, playback({ song: current, queue: [current], playingFrom: dailySource }), key => key)[1]).toMatchObject({ coverUrl: current.album.coverUrl });
    });

    it('updates a kept Daily 30 card from a newer independent daily read without refreshing its section', () => {
        const original = sections();
        shown(original, 1).songPreview!.dailySongs = true;
        const today = song('today');
        const next = withExploreSongPreviews(original, playback({ dailySongs: { providerId: 'probe', firstSong: today } }));
        expect(shown(next, 1).songPreview?.firstSong).toBe(today);
        expect(shown(next, 1).id).toBe('daily');
        expect(faceOf(next[0].items[1], key => key)).toMatchObject({ coverUrl: today.album.coverUrl, subtitle: 'Song today — Artist' });
        expect(next[0].items[0]).toBe(original[0].items[0]);
        expect(next[1]).toBe(original[1]);
        expect(shown(original, 1).songPreview?.firstSong).toBe(firstDaily);
    });

    it('keeps owned daily playback on top of the updated first song and returns to that new first song afterward', () => {
        const original = sections();
        shown(original, 1).songPreview!.dailySongs = true;
        const today = song('today');
        const dailySongs = { providerId: 'probe', firstSong: today };
        const playing = withExploreSongPreviews(original, playback({ dailySongs, song: current, queue: [current], playingFrom: dailySource }));
        expect(shown(playing, 1).songPreview).toMatchObject({ firstSong: today, currentSong: current });
        expect(faceOf(playing[0].items[1], key => key).coverUrl).toBe(current.album.coverUrl);
        const ended = withExploreSongPreviews(playing, playback({ dailySongs, song: current, queue: [current] }));
        expect(faceOf(ended[0].items[1], key => key).coverUrl).toBe(today.album.coverUrl);
        expect(shown(ended, 1).songPreview?.currentSong).toBeUndefined();
        expect(withExploreSongPreviews(ended, playback({ dailySongs, song: current, queue: [current] }))).toBe(ended);
    });

    it('does not sync another provider, a non-opted-in daily card or an FM reservation to a default daily read', () => {
        const original = sections();
        const today = song('today');
        expect(withExploreSongPreviews(original, playback({ dailySongs: { providerId: 'probe', firstSong: today } }))).toBe(original);
        shown(original, 1).songPreview!.dailySongs = true;
        expect(withExploreSongPreviews(original, playback({ dailySongs: { providerId: 'other', firstSong: today } }))).toBe(original);
        const next = withExploreSongPreviews(original, playback({ dailySongs: { providerId: 'probe', firstSong: today } }));
        expect(next[0].items[0]).toBe(original[0].items[0]);
        expect(shown(next, 0).songPreview?.firstSong).toBe(firstFm);
    });

    it('clears an old daily first-song cover after a successful empty read while retaining the entry', () => {
        const original = sections();
        shown(original, 1).songPreview!.dailySongs = true;
        const next = withExploreSongPreviews(original, playback({ dailySongs: { providerId: 'probe' } }));
        expect(shown(next, 1).songPreview?.firstSong).toBeUndefined();
        expect(faceOf(next[0].items[1], key => key)).toMatchObject({ title: 'Daily 30', coverUrl: '' });
    });

    it('updates a held daily wall poster without replacing its raw entries or moving its geometry', () => {
        const original = sections();
        shown(original, 1).songPreview!.dailySongs = true;
        const entries = buildExploreTiles(original, key => key);
        const held = { read: 1, entries };
        expect(handedEntriesOf(held, 1, [], 'wait')).toBe(held);
        const today = song('today');
        const next = withExploreTileSongPreviews(held.entries, playback({ dailySongs: { providerId: 'probe', firstSong: today } }), key => key);
        expect(next[1]).toMatchObject({ coverUrl: today.album.coverUrl, artist: 'Song today — Artist', collection: { songPreview: { firstSong: today } } });
        expect(next.map(tile => [tile.id, tile.queueIndex, tile.sectionKey, tile.entryKind])).toEqual(entries.map(tile => [tile.id, tile.queueIndex, tile.sectionKey, tile.entryKind]));
        expect(sectionsOfTiles(next)).toEqual(sectionsOfTiles(entries));
        expect(next[0]).toBe(entries[0]);
        expect(next[2]).toBe(entries[2]);
        expect(entries[1].kind === 'collection' && entries[1].collection.songPreview?.firstSong).toBe(firstDaily);
    });
});
