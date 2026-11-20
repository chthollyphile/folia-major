import { vi } from 'vitest';
import type { UnifiedSong } from '@/types';
import type { OnlineMusicProvider, ProviderCollection } from '@/types/onlineMusic';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { toHostCollection, toHostSong } from '@/mods/folium/registries/sourceDtos';
import { spotifyAlbumOf, spotifyArtistOf, spotifyPlaylistOf, spotifySongOf } from '../../../sources/spotify/client/spotifyNormalize';
import type { SpotifyAlbum, SpotifyArtistRow, SpotifyPlaylist, SpotifyTrack } from '../../../sources/spotify/client/spotifyNormalize';
import { setBuiltinSourceRpc } from './builtinSources';
// test/unit/helpers/spotifySource.ts
// Spotify 音源模组（sources/spotify/）在单测里的样子，照 ytmSource.ts：它由 setupFiles（builtinSources.ts）经适配层注册，
// 测试拿到的是宿主的 provider。到 main 入口的 `request` 由 answerSpotifyRequests 的 vi.fn 接住：回的值当作桥的 data，抛的错当作桥的
// { code, message, reason? }（没有 code 的算 invalid-response），和 spotifyApiBridge.cjs 交给窗口的一样。

const SOURCE_ID = 'spotify';

/** 注册着的 Spotify provider（适配层组装的那一个）。 */
export const spotifyProvider = (): OnlineMusicProvider => {
    const provider = getOnlineMusicProvider(SOURCE_ID);
    if (!provider) throw new Error('[spotifySource] spotify 没有注册：测试文件要写一行 // @builtin-sources（helpers/builtinSources.ts），并且在用例或 beforeAll 里取');
    return provider;
};

/** 注册着的 Spotify provider 本身，在第一次用到时才去取（内置音源在 setup 的 beforeAll 里注册）。 */
export const lazySpotifyProvider = (): OnlineMusicProvider => new Proxy({} as OnlineMusicProvider, {
    get: (_target, key) => Reflect.get(spotifyProvider(), key),
    has: (_target, key) => Reflect.has(spotifyProvider(), key),
});

/** 桥拒绝时交给窗口的错：code、原话，以及它自己说的原因（有的时候）。 */
export const spotifyRefusal = (code: string, message: string, reason?: string) => (
    Object.assign(new Error(message), { code, ...(reason ? { reason } : {}) })
);

// 用方法的写法声明，参数按双向比较：测试的替身可以把 params 写成它自己读的形状。
interface SpotifyRequestAnswer { answer(operation: string, params: Record<string, unknown>): unknown }

/** 接住 client 到 main 入口的请求；交回记下每次 (operation, params) 的 vi.fn。 */
export const answerSpotifyRequests = () => {
    const request = vi.fn<SpotifyRequestAnswer['answer']>();
    const off = setBuiltinSourceRpc(SOURCE_ID, {
        request: async (...args: unknown[]) => {
            try {
                return { ok: true, data: await request(args[0] as string, (args[1] ?? {}) as Record<string, unknown>) ?? null };
            } catch (error) {
                const failed = error as { code?: unknown; message?: unknown; reason?: unknown };
                return { ok: false, error: {
                    code: typeof failed.code === 'string' ? failed.code : 'invalid-response', message: String(failed.message),
                    ...(typeof failed.reason === 'string' ? { reason: failed.reason } : {}),
                } };
            }
        },
    });
    return { request, off };
};

/** 迁之前 normalizeSpotifySong 的宿主形状：查询答复里的一行经模组变成 DTO，再经适配层变成宿主的歌。不是歌的行抛错。 */
export const hostSpotifySong = (raw: unknown): UnifiedSong => {
    const song = spotifySongOf(raw as SpotifyTrack);
    if (!song) throw new Error('[spotifySource] the row is not a song');
    return toHostSong(SOURCE_ID, song);
};

/** 迁之前 normalizeSpotifyCollection 的宿主形状：按 `type` 读一行歌单、专辑或歌手。 */
export const hostSpotifyCollection = (raw: unknown, type: 'playlist' | 'album' | 'artist'): ProviderCollection => {
    const collection = type === 'album' ? spotifyAlbumOf(raw as SpotifyAlbum)
        : type === 'artist' ? spotifyArtistOf(raw as SpotifyArtistRow)
            : spotifyPlaylistOf(raw as SpotifyPlaylist);
    if (!collection) throw new Error(`[spotifySource] the row is not a ${type}`);
    return toHostCollection(SOURCE_ID, collection);
};
