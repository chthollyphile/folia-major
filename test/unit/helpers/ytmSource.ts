import { vi } from 'vitest';
import type { UnifiedSong } from '@/types';
import type { OnlineMusicProvider, ProviderCollection, ProviderUser } from '@/types/onlineMusic';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { toHostCollection, toHostUser } from '@/mods/folium/registries/sourceDtos';
import {
    normalizeYtmCollection as toYtmCollection,
    normalizeYtmSong as toYtmSong,
    normalizeYtmUser as toYtmUser,
} from '../../../sources/ytm/client/ytmNormalize';
import { setBuiltinSourceRpc } from './builtinSources';
// test/unit/helpers/ytmSource.ts
// YouTube Music 音源模组（sources/ytm/）在单测里的样子，照 qishuiSource.ts：它由 setupFiles（builtinSources.ts）经适配层注册，
// 测试拿到的是宿主的 provider。到 main 入口的 `request` 由 answerYtmRequests 的 vi.fn 接住：回的值当作桥的 data，抛的错当作桥的
// { code, message, reason? }（没有 code 的算 invalid-response），和 ytmApiBridge.cjs 交给窗口的一样。

/** 注册着的 YouTube Music provider（适配层组装的那一个）。 */
export const ytmProvider = (): OnlineMusicProvider => {
    const provider = getOnlineMusicProvider('ytm');
    if (!provider) throw new Error('[ytmSource] ytm 没有注册：测试文件要写一行 // @builtin-sources（helpers/builtinSources.ts），并且在用例或 beforeAll 里取');
    return provider;
};

/** 注册着的 YouTube Music provider 本身，在第一次用到时才去取（内置音源在 setup 的 beforeAll 里注册）。 */
export const lazyYtmProvider = (): OnlineMusicProvider => new Proxy({} as OnlineMusicProvider, {
    get: (_target, key) => Reflect.get(ytmProvider(), key),
    has: (_target, key) => Reflect.has(ytmProvider(), key),
});

/** 桥拒绝时交给窗口的错：code、原话，以及它自己说的原因（有的时候）。 */
export const ytmRefusal = (code: string, message: string, reason?: string) => (
    Object.assign(new Error(message), { code, ...(reason ? { reason } : {}) })
);

// 用方法的写法声明，参数按双向比较：测试的替身可以把 params 写成它自己读的形状（{ continuation?: string } 之类）。
interface YtmRequestAnswer { answer(operation: string, params: Record<string, unknown>): unknown }

/** 接住 client 到 main 入口的请求；交回记下每次 (operation, params) 的 vi.fn。 */
export const answerYtmRequests = () => {
    const request = vi.fn<YtmRequestAnswer['answer']>();
    const off = setBuiltinSourceRpc('ytm', {
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

/** 迁之前 normalizeYtmSong 的宿主形状：桥的行经模组变成 DTO，再经宿主的 normalizeSong 变成宿主的歌。 */
export const hostYtmSong = (raw: unknown): UnifiedSong => ytmProvider().normalizeSong(toYtmSong(raw));

/** 迁之前 normalizeYtmCollection 的宿主形状。 */
export const hostYtmCollection = (raw: unknown, type?: string): ProviderCollection => toHostCollection('ytm', toYtmCollection(raw, type));

/** 迁之前 normalizeYtmUser 的宿主形状。 */
export const hostYtmUser = (raw: unknown): ProviderUser => toHostUser(toYtmUser(raw));
