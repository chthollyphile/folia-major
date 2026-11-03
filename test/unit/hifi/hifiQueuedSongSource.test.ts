import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';

// test/unit/hifi/hifiQueuedSongSource.test.ts
// loadQueuedSongHifiSource（components/app/playback/source/songAudioSource.ts）：无缝接播预载下一首时读它的 HiFi 源。本地歌按曲库里的
// 记录拿到文件本身（不做封面资源，那归认领它的那次播放），Navidrome 歌按此刻的配置拿原文件的 stream 地址；别的歌、读不到的文件、
// 没配置的服务器都答 null。文件访问、曲库和服务器都是假的。

const env = vi.hoisted(() => ({
    asked: [] as string[],
    records: new Map<string, { id: string; fileName: string }>(),
    unreadable: false,
    config: { serverUrl: 'https://navi.test' } as { serverUrl: string } | null,
}));

vi.mock('@/services/db', () => ({
    getLocalSong: async (id: string) => { env.asked.push(`record ${id}`); return env.records.get(id); },
}));
vi.mock('@/services/localMusicService', () => ({
    getAudioFromLocalSong: async () => null,
    getFileFromLocalSong: async (song: { id: string }) => { env.asked.push(`file ${song.id}`); return env.unreadable ? null : { name: `${song.id}.flac` }; },
    ensureLocalSongCoverAsset: async (song: { id: string }) => { env.asked.push(`cover asset ${song.id}`); return song; },
}));
vi.mock('@/services/navidromeService', () => ({
    getNavidromeConfig: () => env.config,
    navidromeApi: {
        getStreamUrl: (config: { serverUrl: string }, id: string, format?: string) => `${config.serverUrl}/stream/${id}${format ? `?format=${format}` : ''}`,
        getSong: async () => null,
    },
}));

const { loadQueuedSongHifiSource } = await import('@/components/app/playback/source/songAudioSource');

const localQueued = { id: 'l1', name: 'L', isLocal: true, localRef: { songId: 'l1' } } as unknown as SongResult;
const navidromeCarrier = { id: 'n1', name: 'N', isNavidrome: true, navidromeData: { id: 'n1', suffix: 'flac' } };
const onlineQueued = { id: 'x1', name: 'X', sourceRef: { kind: 'online', providerId: 'netease', mediaId: 'x1' } } as unknown as SongResult;

beforeEach(() => {
    env.asked.length = 0;
    env.records.clear();
    env.records.set('l1', { id: 'l1', fileName: 'l1.flac' });
    env.unreadable = false;
    env.config = { serverUrl: 'https://navi.test' };
});

describe('loadQueuedSongHifiSource', () => {
    it('reads a local song\'s library record and its file, and leaves the cover asset to the play', async () => {
        expect(await loadQueuedSongHifiSource(localQueued)).toEqual({
            kind: 'local',
            localSong: { id: 'l1', fileName: 'l1.flac' },
            file: { name: 'l1.flac' },
        });
        expect(env.asked).toEqual(['record l1', 'file l1']);
    });

    it('answers null for a local song without a record or whose file cannot be read', async () => {
        env.unreadable = true;
        expect(await loadQueuedSongHifiSource(localQueued)).toBeNull();
        env.records.clear();
        expect(await loadQueuedSongHifiSource(localQueued)).toBeNull();
    });

    it('gives a Navidrome song the stream of its original file with the configuration of now, the carrier as it is', async () => {
        const unified = { id: 'n1', name: 'N', isNavidrome: true, navidromeData: navidromeCarrier } as unknown as SongResult;
        const source = await loadQueuedSongHifiSource(unified);
        expect(source).toEqual({ kind: 'navidrome', carrier: navidromeCarrier, streamUrl: 'https://navi.test/stream/n1?format=raw' });
        expect((source as { carrier: unknown }).carrier).toBe(navidromeCarrier);

        env.config = null;
        expect(await loadQueuedSongHifiSource(unified)).toBeNull();
    });

    it('answers null for an online song', async () => {
        expect(await loadQueuedSongHifiSource(onlineQueued)).toBeNull();
        expect(env.asked).toEqual([]);
    });
});
