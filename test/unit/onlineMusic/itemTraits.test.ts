import { afterEach, describe, expect, it, vi } from 'vitest';
import { omni } from '@/services/onlineMusic/omni';
import { itemTraits, soundsInHost } from '@/services/onlineMusic/itemTraits';
import { registerOnlineMusicProvider, unregisterOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { buildRouteOf, dispatchExternal, itemKindsOf } from '@/mods/folium/registries/sourceAdapter/playback';
import { createSourceAdapterKit } from '@/mods/folium/registries/sourceAdapter/kit';
import { createFoliumSourceTextBook } from '@/mods/folium/registries/sourceText';
import { markFoliumSourceMod } from '@/mods/runtime/guard';
import type { SongResult, UnifiedSong } from '@/types';
import type { OnlineExternalPlaybackProvider, OnlineMusicProvider, ProviderExternalPlaybackStatus } from '@/types/onlineMusic';

// test/unit/onlineMusic/itemTraits.test.ts
// Folium 2 plan §4.2 and §4.4 on the host's side: what an item's kind says (lyrics, likes, reports) and which way
// it sounds are asked in one place (itemTraits), and omni's like and report gates follow it; the adapter's
// `routeOf` keeps to the ways a source has, and a source with two players of its own steers each call to the
// right one.

const providerId = 'item-traits-test';

const song = (mediaId: string, itemKind?: string): UnifiedSong => ({
    id: mediaId, name: mediaId, artists: [], album: { id: '', name: '' }, durationMs: 1,
    ...(itemKind ? { itemKind } : {}),
    sourceRef: { kind: 'online', providerId, mediaId },
});

const player = (name: string, calls: string[]): OnlineExternalPlaybackProvider => ({
    play: async (target, startSec) => { calls.push(`${name} play ${String(target.id)} ${startSec}`); },
    pause: async () => { calls.push(`${name} pause`); },
    resume: async () => { calls.push(`${name} resume`); },
    seek: async (seconds) => { calls.push(`${name} seek ${seconds}`); },
    getStatus: async (target): Promise<ProviderExternalPlaybackStatus> => ({ mediaId: `${name}:${String(target.id)}`, isPlaying: false, positionMs: 0, durationMs: 0, ended: false }),
    isStatusForSong: () => true,
});

const register = (extra: Partial<OnlineMusicProvider>) => {
    registerOnlineMusicProvider({
        id: providerId,
        displayName: providerId,
        capabilities: {
            search: false, playback: true, lyrics: false, auth: false, userLibrary: false, playlists: false, albums: false,
            artists: false, recommendations: false, mutations: true, likes: true, wordByWordLyrics: false,
            playbackReports: true, externalPlayback: true,
        },
        normalizeSong: (raw) => raw as UnifiedSong,
        playback: { getSongDetail: async () => null, getAudioSource: async () => null },
        mutations: { likeSong: async () => undefined },
        playbackReports: { reportPlayback: async () => undefined },
        externalPlayback: player('external', []),
        ...extra,
    });
};

afterEach(() => {
    unregisterOnlineMusicProvider(providerId);
});

describe('itemTraits', () => {
    it('gives a song, an item that is not online and a kind its source does not declare a song\'s traits', () => {
        register({});
        expect(itemTraits(song('a'))).toEqual({ kind: 'song', lyrics: 'match', likable: true, reported: true, route: 'external' });
        expect(itemTraits(song('a', 'podcast'))).toEqual({ kind: 'song', lyrics: 'match', likable: true, reported: true, route: 'external' });
        const local = { id: 'l', name: 'l', artists: [], album: { id: '', name: '' }, durationMs: 1, sourceRef: { kind: 'local', localId: 'l' } } as unknown as SongResult;
        expect(itemTraits(local)).toMatchObject({ kind: 'song', route: 'audio' });
    });

    it('reads a declared kind, a trait left out being a song\'s, and gates likes and reports by it', () => {
        register({
            itemKinds: { video: { lyrics: 'none', likable: false, reported: false }, clip: { lyrics: 'own' } },
            routeOf: (target) => (target.itemKind === 'video' ? 'surface' : 'audio'),
            externalPlayback: { ...player('surface', []), mount: () => () => undefined },
        });
        const video = song('v', 'video');
        expect(itemTraits(video)).toEqual({ kind: 'video', lyrics: 'none', likable: false, reported: false, route: 'surface' });
        // The same object while nothing changed: rows ask as they draw.
        expect(itemTraits(video)).toBe(itemTraits(song('v2', 'video')));
        expect(itemTraits(song('c', 'clip'))).toEqual({ kind: 'clip', lyrics: 'own', likable: true, reported: true, route: 'audio' });
        expect(omni.canLikeSong(video)).toBe(false);
        expect(omni.canReportPlayback(video)).toBe(false);
        expect(omni.canLikeSong(song('c', 'clip'))).toBe(true);
        expect(omni.canReportPlayback(song('c', 'clip'))).toBe(true);
        // routeOf decides the route: the clip is the host's audio, the video the provider's player with a picture.
        expect(soundsInHost(song('c', 'clip'))).toBe(true);
        expect(omni.canPlayExternally(song('c', 'clip'))).toBe(false);
        expect(omni.playsOnSurface(video)).toBe(true);
    });

    it('never says surface for a player without a picture', () => {
        register({ routeOf: () => 'surface', externalPlayback: player('external', []) });
        expect(itemTraits(song('x')).route).toBe('external');
        expect(omni.playsOnSurface(song('x'))).toBe(false);
        expect(omni.mountSurface(song('x'), {} as HTMLElement)).toBeNull();
    });
});

describe('the adapter: routeOf, itemKinds and two players', () => {
    const kit = () => createSourceAdapterKit({
        modId: 'mod-a', hostId: 'folium.mod-a.s', text: createFoliumSourceTextBook('mod-a', 'folium.mod-a.s'), tells: new Set(),
    });

    it('routeOf keeps to the ways the source has; no answer, a wrong one or a throw is its first way', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        markFoliumSourceMod('mod-a', true);
        expect(buildRouteOf(kit(), {}, [])).toBeUndefined();
        expect(buildRouteOf(kit(), {}, ['surface', 'audio'])!(song('a'))).toBe('surface');
        const answers = buildRouteOf(kit(), { routeOf: (target) => (target.id === 'e' ? 'external' : target.id === 'x' ? (() => { throw new Error('no'); })() : 'audio') }, ['surface', 'audio'])!;
        expect(answers(song('a'))).toBe('audio');
        expect(answers(song('e'))).toBe('surface');
        expect(answers(song('x'))).toBe('surface');
        markFoliumSourceMod('mod-a', false);
    });

    it('itemKinds takes the traits it knows and leaves out a kind named song', () => {
        expect(itemKindsOf(undefined)).toBeUndefined();
        expect(itemKindsOf({ song: { lyrics: 'none' }, video: { lyrics: 'none', likable: false, extra: 1 }, odd: { lyrics: 'sometimes', reported: 'no' } })).toEqual({
            video: { lyrics: 'none', likable: false },
            odd: {},
        });
    });

    it('steers each call to the player of its song, and pauses the one a start leaves', async () => {
        const calls: string[] = [];
        const surface = { ...player('surface', calls), mount: () => { calls.push('surface mount'); return () => undefined; } };
        const both = dispatchExternal(kit(), (target) => (target.itemKind === 'video' ? 'surface' : 'external'), player('external', calls), surface, 'external');
        both.mount?.({} as HTMLElement, song('v', 'video'));
        await both.play(song('v', 'video'), 3);
        await both.seek(4);
        await both.pause();
        expect((await both.getStatus(song('s'))).mediaId).toBe('external:s');
        await both.play(song('s'), 0);
        await both.resume();
        expect(calls).toEqual([
            'surface mount', 'external pause', 'surface play v 3', 'surface seek 4', 'surface pause',
            'surface pause', 'external play s 0', 'external resume',
        ]);
    });

    it('sends a call that names its song to the player of that song, whatever played last', async () => {
        const calls: string[] = [];
        // As after the source told the host it changed: a fresh dispatcher whose last player is the surface one.
        const both = dispatchExternal(kit(), (target) => (target.itemKind === 'video' ? 'surface' : 'external'), player('external', calls), { ...player('surface', calls), setVolume: async (volume) => { calls.push(`surface volume ${volume}`); } }, 'surface');
        const audio = song('s');
        await both.pause(audio);
        await both.resume(audio);
        await both.seek(5, audio);
        await both.setVolume?.(0.5, audio);
        await both.setVolume?.(0.5, song('v', 'video'));
        expect(calls).toEqual(['external pause', 'external resume', 'external seek 5', 'surface volume 0.5']);
    });

    it('pauses a start that another start in the other player overtook while it waited', async () => {
        const calls: string[] = [];
        let release: () => void = () => undefined;
        const slow: OnlineExternalPlaybackProvider = {
            ...player('external', calls),
            play: async (target) => {
                calls.push(`external play ${String(target.id)}`);
                await new Promise<void>((resolve) => { release = resolve; });
                calls.push(`external sounding ${String(target.id)}`);
            },
        };
        const both = dispatchExternal(kit(), (target) => (target.itemKind === 'video' ? 'surface' : 'external'), slow, { ...player('surface', calls), mount: () => () => undefined }, 'external');
        const first = both.play(song('s'), 0);
        await both.play(song('v', 'video'), 0);
        release();
        await first;
        expect(calls).toEqual(['external play s', 'external pause', 'surface play v 0', 'external sounding s', 'external pause']);
    });
});
