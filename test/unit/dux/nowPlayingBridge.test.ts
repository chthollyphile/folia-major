import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// 桥把 MPRIS 播放器变成 now-playing 协议的 Track/Lyric：字段名要和 Folia 的读取端一致
// （艺人是 author，不是 artist），封面走本机代理，曲目身份变化时歌词也要重新取。

const require = createRequire(import.meta.url);
const { createDuxNowPlayingBridge, lyricPayload, sameTrack, trackForWire, trackFromPlayer } = require('../../../electron/dux/nowPlayingBridge.cjs') as {
    lyricPayload: (result: unknown, track: { title: string; author: string; duration: number | null } | null) => Record<string, unknown> | null;
    sameTrack: (left: unknown, right: unknown) => boolean;
    trackForWire: (track: Record<string, unknown> | null) => Record<string, unknown> | null;
    createDuxNowPlayingBridge: (options: Record<string, unknown>) => { start: () => Promise<boolean>; stop: () => Promise<void> };
    trackFromPlayer: (player: unknown, artwork: { register: (url: string, key: string) => string | null }, port: number) => {
        id: string;
        title: string;
        author: string;
        album: string;
        cover: string | null;
        duration: number | null;
        lookupOriginal: boolean;
    } | null;
};

const player = {
    name: 'org.mpris.MediaPlayer2.Valent.Player4',
    identity: 'Apple Music',
    title: 'spiral',
    artists: ['LONGMAN'],
    album: 'spiral - Single',
    lengthSec: 231,
    artUrl: 'file:///tmp/cover',
    trackId: '/track/1',
};

describe('trackFromPlayer', () => {
    it('names the artist author and routes the cover through the local proxy', () => {
        const track = trackFromPlayer(player, { register: () => 'a'.repeat(32) }, 9863);
        expect(track).toMatchObject({
            title: 'spiral',
            author: 'LONGMAN',
            album: 'spiral - Single',
            duration: 231,
            cover: `http://127.0.0.1:9863/art/${'a'.repeat(32)}`,
        });
        expect(track?.id).toContain('spiral');
        expect(track?.lookupOriginal).toBe(true);
    });

    it('falls back to the player identity for a missing artist and keeps no cover without art', () => {
        const track = trackFromPlayer({ ...player, artists: [], artUrl: null }, { register: () => null }, 9863);
        expect(track).toMatchObject({ author: 'Apple Music', cover: null });
    });

    it('is null without a player', () => {
        expect(trackFromPlayer(null, { register: () => null }, 9863)).toBeNull();
    });
});

describe('lyricPayload', () => {
    it('carries the author and duration the now-playing normalizer expects', () => {
        const payload = lyricPayload({
            found: true,
            synced: [{ t: 1, e: 2, x: 'hi', w: [{ t: 1, e: 2, x: 'hi' }] }],
        }, { title: 'spiral', author: 'LONGMAN', duration: 231 });
        expect(payload).toMatchObject({
            source: 'dux',
            title: 'spiral',
            author: 'LONGMAN',
            duration: 231,
            hasKaraokeLyric: true,
        });
        expect(String(payload?.karaokeLyric)).toContain('[1000,1000]');
    });

    it('is null when Dux found nothing', () => {
        expect(lyricPayload({ found: false }, null)).toBeNull();
    });
});

describe('trackForWire', () => {
    it('drops the internal lookup artist from the protocol payload', () => {
        const track = trackFromPlayer(player, { register: () => null }, 9863);
        expect(trackForWire(track)).toEqual({
            id: track!.id,
            title: 'spiral',
            author: 'LONGMAN',
            album: 'spiral - Single',
            cover: null,
            duration: 231,
        });
        expect(trackForWire(null)).toBeNull();
    });
});

describe('sameTrack', () => {
    it('compares the fields that select a new lyric lookup', () => {
        const track = trackFromPlayer(player, { register: () => null }, 9863);
        expect(sameTrack(track, { ...track })).toBe(true);
        expect(sameTrack(track, { ...track, title: 'other' })).toBe(false);
        expect(sameTrack(track, { ...track, author: 'other' })).toBe(false);
    });
});

describe('createDuxNowPlayingBridge', () => {
    it('broadcasts the mirrored player and its Dux lyrics', async () => {
        const events: Array<{ event: string; data: unknown }> = [];
        let onPlayers: (players: unknown[]) => void = () => {};
        let serverOptions: Record<string, unknown> = {};
        const server = {
            start: async () => ({ port: 9863, host: '127.0.0.1' }),
            stop: async () => {},
            broadcast: (event: string, data: unknown) => { events.push({ event, data }); },
            clientCount: () => 1,
        };
        let now = 1000;
        const bridge = createDuxNowPlayingBridge({
            platform: 'linux',
            busAddress: 'unix:path=/tmp/does-not-matter',
            now: () => now,
            deps: {
                createArtworkStore: () => ({ register: () => 'a'.repeat(32), get: async () => null }),
                createDmsLyricsClient: () => ({
                    lookup: async () => ({ found: true, synced: [{ t: 1, e: 2, x: 'hi', w: [{ t: 1, e: 2, x: 'hi' }] }] }),
                }),
                createMprisClient: (options: { onPlayers: (players: unknown[]) => void }) => {
                    onPlayers = options.onPlayers;
                    return { start: async () => {}, stop: () => {} };
                },
                createNowPlayingServer: (options: Record<string, unknown>) => {
                    serverOptions = options;
                    return server;
                },
                createTitleResolver: () => ({ resolve: async () => [] }),
            },
            log: { info: () => {}, warn: () => {} },
        });
        await bridge.start();
        onPlayers([{
            name: 'org.mpris.MediaPlayer2.Valent.Player4',
            identity: 'Apple Music',
            playbackStatus: 'Playing',
            canControl: true,
            positionSec: 10,
            trackId: '/track/1',
            title: 'spiral',
            artists: ['LONGMAN'],
            album: 'spiral - Single',
            lengthSec: 231,
            artUrl: 'file:///tmp/cover',
        }]);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(events.find(event => event.event === 'Track')?.data).toMatchObject({
            title: 'spiral',
            author: 'LONGMAN',
            cover: `http://127.0.0.1:9863/art/${'a'.repeat(32)}`,
        });
        const lyric = events.filter(event => event.event === 'Lyric').pop();
        expect(lyric?.data).toMatchObject({
            source: 'dux',
            hasKaraokeLyric: true,
            author: 'LONGMAN',
        });
        // The progress endpoint is asked between MPRIS polls and must report the extrapolated clock.
        now += 2000;
        expect((serverOptions.getProgressMs as () => number)()).toBeGreaterThanOrEqual(11900);
        await bridge.stop();
    });
});

describe('translated Apple Music titles', () => {
    it('retries Dux with the original Japanese title from the catalog', async () => {
        const events: Array<{ event: string; data: unknown }> = [];
        let onPlayers: (players: unknown[]) => void = () => {};
        const lookups: Array<Record<string, unknown>> = [];
        const server = {
            start: async () => ({ port: 9863, host: '127.0.0.1' }),
            stop: async () => {},
            broadcast: (event: string, data: unknown) => { events.push({ event, data }); },
            clientCount: () => 1,
        };
        const bridge = createDuxNowPlayingBridge({
            platform: 'linux',
            busAddress: 'unix:path=/tmp/does-not-matter',
            deps: {
                createArtworkStore: () => ({ register: () => null, get: async () => null }),
                createDmsLyricsClient: () => ({
                    lookup: async (query: Record<string, unknown>) => {
                        lookups.push(query);
                        if (query.title === 'Alka Tail') return { found: false };
                        return { found: true, synced: [{ t: 1, e: 2, x: 'hi', w: [{ t: 1, e: 2, x: 'hi' }] }] };
                    },
                }),
                createMprisClient: (options: { onPlayers: (players: unknown[]) => void }) => {
                    onPlayers = options.onPlayers;
                    return { start: async () => {}, stop: () => {} };
                },
                createNowPlayingServer: () => server,
                createTitleResolver: () => ({
                    resolve: async () => [{ title: 'アルカテイル', artist: '鈴木このみ', album: 'Summer Pockets (Original SoundTrack)', durationSec: 289.88 }],
                }),
            },
            log: { info: () => {}, warn: () => {} },
        });
        await bridge.start();
        onPlayers([{
            name: 'org.mpris.MediaPlayer2.Valent.Player4',
            identity: 'Apple Music',
            playbackStatus: 'Playing',
            canControl: true,
            positionSec: 10,
            title: 'Alka Tail',
            artists: ['Konomi Suzuki'],
            album: 'Summer Pockets (Original SoundTrack)',
            lengthSec: 289.879,
            artUrl: null,
        }]);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(lookups[0]).toMatchObject({ title: 'Alka Tail', artist: 'Konomi Suzuki' });
        expect(lookups[1]).toMatchObject({ title: 'アルカテイル', artist: '鈴木このみ' });
        const lyric = events.filter(event => event.event === 'Lyric').pop();
        expect(lyric?.data).toMatchObject({ source: 'dux', hasKaraokeLyric: true });
        await bridge.stop();
    });
});
