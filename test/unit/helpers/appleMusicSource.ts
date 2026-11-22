import { vi } from 'vitest';
import type { UnifiedSong } from '@/types';
import type { ModRuntimeInfo } from '@/mods/types';
import type { OnlineMusicProvider, ProviderCollection } from '@/types/onlineMusic';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { registerFoliumSource, sourcesRegistry } from '@/mods/folium/registries/sources';
import { toHostCollection, toHostSong } from '@/mods/folium/registries/sourceDtos';
import { createFoliumI18n } from '@/mods/folium/sources/i18n';
import { createAppleMusicSource } from '../../../sources/appleMusic/client/appleMusicProvider';
import {
    normalizeAppleMusicCatalogCollection,
    normalizeAppleMusicLibraryAlbum,
    normalizeAppleMusicPlaylist,
    normalizeAppleMusicSong,
} from '../../../sources/appleMusic/client/appleMusicNormalize';
import { setBuiltinSourceRpc } from './builtinSources';
// test/unit/helpers/appleMusicSource.ts
// Apple Music 音源模组（sources/appleMusic/）在单测里的样子，照 ytmSource.ts / fnmusicSource.ts：它由 setupFiles（builtinSources.ts）
// 经适配层注册，测试拿到的是宿主的 provider。到 main 入口的 `request` 由 answerAppleMusicRequests 的 vi.fn 接住：它回的就是伴侣程序
// 客户端的答复（{ ok, data } 或 { ok: false, error, httpStatus?, playbackStage? }），和 companionClient.cjs 交给窗口的一样。
// 播放、登录的状态在定义的闭包里：要一份新的（以前每个用例 createAppleMusicProvider 一次）用 freshAppleMusicProvider，它把注册着的
// 定义换成新做的一份；系统也由它定（缺省 macOS：jsdom 的 navigator 跟着跑测试的机器走）。

const MOD_ID = 'apple-music';
const SOURCE_ID = 'appleMusic';

/** 注册着的 Apple Music provider（适配层组装的那一个）。 */
export const appleMusicProvider = (): OnlineMusicProvider => {
    const provider = getOnlineMusicProvider(SOURCE_ID);
    if (!provider) throw new Error('[appleMusicSource] appleMusic 没有注册：测试文件要写一行 // @builtin-sources（helpers/builtinSources.ts），并且在用例或 beforeAll 里取');
    return provider;
};

/** 注册着的 Apple Music provider 本身，在第一次用到时才去取（内置音源在 setup 的 beforeAll 里注册）。 */
export const lazyAppleMusicProvider = (): OnlineMusicProvider => new Proxy({} as OnlineMusicProvider, {
    get: (_target, key) => Reflect.get(appleMusicProvider(), key),
    has: (_target, key) => Reflect.has(appleMusicProvider(), key),
});

// 用方法的写法声明，参数按双向比较：替身可以把 params 写成它自己读的形状。
interface AppleMusicRequestAnswer { answer(operation: string, params: Record<string, unknown>): unknown }

/**
 * 接住 client 到 main 入口的请求；交回记下每次 (operation, params) 的 vi.fn，它回的是伴侣程序客户端的答复。
 * 给了 `answer` 就用它，否则默认答 { ok: true, data: {} }。
 */
export const answerAppleMusicRequests = (answer?: AppleMusicRequestAnswer['answer']) => {
    const request = vi.fn<AppleMusicRequestAnswer['answer']>(answer ?? (() => ({ ok: true, data: {} })));
    const off = setBuiltinSourceRpc(MOD_ID, {
        request: (...args: unknown[]) => request(args[0] as string, (args[1] ?? {}) as Record<string, unknown>),
    });
    return { request, off };
};

/**
 * 让到 main 入口的请求交给测试自己的 `request`（迁之前 stubGlobal 的 window.electron.appleMusicRequest）：它拿到
 * (operation, params)，回伴侣程序客户端的答复。交回撤掉它的函数。
 */
export const stubAppleMusicBridge = (request: AppleMusicRequestAnswer['answer']): (() => void) => (
    setBuiltinSourceRpc(MOD_ID, {
        request: (...args: unknown[]) => request(args[0] as string, (args[1] ?? {}) as Record<string, unknown>),
    })
);

const mod = {
    id: MOD_ID,
    sources: [{ id: SOURCE_ID, localId: SOURCE_ID, name: 'Apple Music', state: 'enabled', keepForMatching: false, takeover: false, requires: [] }],
} as unknown as ModRuntimeInfo;

/**
 * 把注册着的 Apple Music 换成新做的一份定义（播放、登录的状态从头来），交回宿主的 provider。`platform` 是 client 交给
 * 定义的系统（`darwin`、`win32`、`linux`），缺省 `darwin`。
 */
export const freshAppleMusicProvider = ({ platform = 'darwin' }: { platform?: string } = {}): OnlineMusicProvider => {
    sourcesRegistry.unregisterAll(MOD_ID);
    const i18n = createFoliumI18n();
    registerFoliumSource({ mod, stopped: () => false }, createAppleMusicSource({ text: key => i18n.key(key), platform }));
    return appleMusicProvider();
};

/** 迁之前 normalizeAppleMusicSong 的宿主形状：伴侣程序的行经模组变成 DTO，再经适配层变成宿主的歌（用例外面也能用）。 */
export const hostAppleMusicSong = (raw: unknown): UnifiedSong => toHostSong(SOURCE_ID, normalizeAppleMusicSong(raw));

/** 迁之前 normalizeAppleMusicPlaylist 的宿主形状。 */
export const hostAppleMusicPlaylist = (raw: unknown): ProviderCollection => toHostCollection(SOURCE_ID, normalizeAppleMusicPlaylist(raw));

/** 迁之前 normalizeAppleMusicLibraryAlbum 的宿主形状。 */
export const hostAppleMusicLibraryAlbum = (raw: unknown): ProviderCollection => toHostCollection(SOURCE_ID, normalizeAppleMusicLibraryAlbum(raw));

/** 迁之前 normalizeAppleMusicCatalogCollection 的宿主形状。 */
export const hostAppleMusicCatalogCollection = (raw: unknown): ProviderCollection => toHostCollection(SOURCE_ID, normalizeAppleMusicCatalogCollection(raw));
