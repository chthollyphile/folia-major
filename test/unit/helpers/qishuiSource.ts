import { vi } from 'vitest';
import type { UnifiedSong } from '@/types';
import type { OnlineMusicProvider, ProviderCollection, ProviderUser } from '@/types/onlineMusic';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { toHostCollection, toHostUser } from '@/mods/folium/registries/sourceDtos';
import {
    normalizeQishuiCollection as toQishuiCollection,
    normalizeQishuiSong as toQishuiSong,
    normalizeQishuiUser as toQishuiUser,
} from '../../../sources/qishui/client/qishuiNormalize';
import { setBuiltinSourceRpc } from './builtinSources';
// test/unit/helpers/qishuiSource.ts
// 汽水音源模组（sources/qishui/）在单测里的样子，照 bodianSource.ts：它由 setupFiles（builtinSources.ts）经适配层注册，测试
// 拿到的是宿主的 provider。到 main 入口的 `request` 由 answerQishuiRequests 的 vi.fn 接住：回的值当作包的 data，抛的错当作
// 包的 { code, message, upstreamCode?, stage? }（没有 code 的算 invalid-response），和 qishuiApiBridge.cjs 交给窗口的一样。

/** 注册着的汽水 provider（适配层组装的那一个）。 */
export const qishuiProvider = (): OnlineMusicProvider => {
    const provider = getOnlineMusicProvider('qishui');
    if (!provider) throw new Error('[qishuiSource] qishui 没有注册：测试文件要写一行 // @builtin-sources（helpers/builtinSources.ts），并且在用例或 beforeAll 里取');
    return provider;
};

/** 注册着的汽水 provider 的一部分，在第一次用到时才去取（内置音源在 setup 的 beforeAll 里注册）。 */
export const lazyQishui = <T extends object>(pick: (provider: OnlineMusicProvider) => T | undefined): T => new Proxy({} as T, {
    get: (_target, key) => {
        const part = pick(qishuiProvider());
        if (!part) throw new Error(`[qishuiSource] qishui 没有这一部分（取 ${String(key)} 时）`);
        return Reflect.get(part, key);
    },
});

/** 包拒绝时交给窗口的错：code、原话，以及平台的错误号和登录阶段（有的时候）。 */
export const qishuiRefusal = (code: string, message: string, extra: { upstreamCode?: string; stage?: string } = {}) => (
    Object.assign(new Error(message), { code, ...extra })
);

/** 接住 client 到 main 入口的请求；交回记下每次 (operation, params) 的 vi.fn。`bridge` 给了时整个答复由它出（测真的桥）。 */
export const answerQishuiRequests = (bridge?: (operation: string, params?: Record<string, unknown>) => unknown) => {
    const request = vi.fn<(operation: string, params?: Record<string, unknown>) => unknown>();
    const off = setBuiltinSourceRpc('qishui', {
        request: async (...args: unknown[]) => {
            if (bridge) return bridge(args[0] as string, args[1] as Record<string, unknown> | undefined);
            try {
                return { ok: true, data: await request(args[0] as string, args[1] as Record<string, unknown> | undefined) };
            } catch (error) {
                const failed = error as { code?: unknown; message?: unknown; upstreamCode?: unknown; stage?: unknown };
                return { ok: false, error: {
                    code: typeof failed.code === 'string' ? failed.code : 'invalid-response', message: String(failed.message),
                    ...(typeof failed.upstreamCode === 'string' ? { upstreamCode: failed.upstreamCode } : {}),
                    ...(typeof failed.stage === 'string' ? { stage: failed.stage } : {}),
                } };
            }
        },
    });
    return { request, off };
};

/** 迁之前 normalizeQishuiSong 的宿主形状：原始记录经模组变成 DTO，再经宿主的 normalizeSong 变成宿主的歌。 */
export const hostQishuiSong = (raw: unknown): UnifiedSong => qishuiProvider().normalizeSong(toQishuiSong(raw));

/** 迁之前 normalizeQishuiCollection 的宿主形状。 */
export const hostQishuiCollection = (raw: unknown, type?: string): ProviderCollection => toHostCollection('qishui', toQishuiCollection(raw, type));

/** 迁之前 normalizeQishuiUser 的宿主形状。 */
export const hostQishuiUser = (raw: unknown): ProviderUser => toHostUser(toQishuiUser(raw));
