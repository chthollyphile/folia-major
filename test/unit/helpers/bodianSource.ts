import { vi } from 'vitest';
import type { SongResult, UnifiedSong } from '@/types';
import type { OnlineMusicProvider, ProviderCollection, ProviderUser } from '@/types/onlineMusic';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { toHostCollection, toHostUser } from '@/mods/folium/registries/sourceDtos';
import {
    normalizeBodianCollection as toBodianCollection,
    normalizeBodianSong as toBodianSong,
    normalizeBodianUser as toBodianUser,
} from '../../../sources/bodian/client/bodianNormalize';
import { setBuiltinSourceRpc } from './builtinSources';
// test/unit/helpers/bodianSource.ts
// 波点音源模组（sources/bodian/）在单测里的样子：它由 setupFiles（builtinSources.ts）经适配层注册，测试拿到的是宿主的
// provider（和桌面上 omni 拿到的同一个形状）。到 main 入口的 `request` 由 answerBodianRequests 的 vi.fn 接住：
// 回的值当作包的 data，抛的错当作包的 { code, message }（没有 code 的算 invalid-response），和 bodianApiBridge.cjs 交给窗口的一样。

/** 注册着的波点 provider（适配层组装的那一个）。 */
export const bodianProvider = (): OnlineMusicProvider => {
    const provider = getOnlineMusicProvider('bodian');
    if (!provider) throw new Error('[bodianSource] bodian 没有注册：测试文件要写一行 // @builtin-sources（helpers/builtinSources.ts），并且在用例或 beforeAll 里取');
    return provider;
};

/**
 * 注册着的波点 provider 的一部分（`provider => provider.library`），在第一次用到时才去取：内置音源在 setup 的 beforeAll 里注册，
 * 测试文件顶层取的时候它还不在。
 */
export const lazyBodian = <T extends object>(pick: (provider: OnlineMusicProvider) => T | undefined): T => new Proxy({} as T, {
    get: (_target, key) => {
        const part = pick(bodianProvider());
        if (!part) throw new Error(`[bodianSource] bodian 没有这一部分（取 ${String(key)} 时）`);
        return Reflect.get(part, key);
    },
});

/** 接住 client 到 main 入口的请求；交回记下每次 (operation, params) 的 vi.fn。 */
export const answerBodianRequests = () => {
    const request = vi.fn<(operation: string, params?: Record<string, unknown>) => unknown>();
    const off = setBuiltinSourceRpc('bodian', {
        request: async (...args: unknown[]) => {
            try {
                return { ok: true, data: await request(args[0] as string, args[1] as Record<string, unknown> | undefined) };
            } catch (error) {
                const failed = error as { code?: unknown; message?: unknown };
                return { ok: false, error: { code: typeof failed.code === 'string' ? failed.code : 'invalid-response', message: String(failed.message) } };
            }
        },
    });
    return { request, off };
};

/**
 * 迁之前 normalizeBodianSong 的宿主形状：波点的原始记录经模组变成 DTO，再经宿主的 normalizeSong 变成宿主的歌；已经是宿主的歌
 * （缓存里的）原样交回，和迁之前一样。
 */
export const hostBodianSong = (raw: unknown): UnifiedSong => {
    const provider = bodianProvider();
    const loose = raw as Partial<SongResult> | null;
    return provider.normalizeSong(loose?.sourceRef ? raw : toBodianSong(raw));
};

/** 迁之前 normalizeBodianCollection 的宿主形状。 */
export const hostBodianCollection = (raw: unknown, type?: string): ProviderCollection => toHostCollection('bodian', toBodianCollection(raw, type));

/** 迁之前 normalizeBodianUser 的宿主形状。 */
export const hostBodianUser = (raw: unknown): ProviderUser => toHostUser(toBodianUser(raw));
