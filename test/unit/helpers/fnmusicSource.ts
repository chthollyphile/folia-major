import { vi } from 'vitest';
import type { OnlineMusicProvider } from '@/types/onlineMusic';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { setBuiltinSourceRpc } from './builtinSources';
// test/unit/helpers/fnmusicSource.ts
// 飞牛音源模组（sources/fnmusic/）在单测里的样子，照 qishuiSource.ts：它由 setupFiles（builtinSources.ts）经适配层注册，测试
// 拿到的是宿主的 provider。到 main 入口的 `request` 由 answerFnMusicRequests 的 vi.fn 接住：它回的就是桥的答复
// （{ ok, data } 或 { ok: false, status?, error }），和 fnmusicApiBridge.cjs 交给窗口的一样。

/** 注册着的飞牛 provider（适配层组装的那一个）。 */
export const fnmusicProvider = (): OnlineMusicProvider => {
    const provider = getOnlineMusicProvider('fnmusic');
    if (!provider) throw new Error('[fnmusicSource] fnmusic 没有注册：测试文件要写一行 // @builtin-sources（helpers/builtinSources.ts），并且在用例或 beforeAll 里取');
    return provider;
};

/** 接住 client 到 main 入口的请求；交回记下每次 (operation, params) 的 vi.fn，默认答 { ok: true, data: null }。 */
export const answerFnMusicRequests = () => {
    const request = vi.fn<(operation: string, params?: Record<string, unknown>) => unknown>()
        .mockResolvedValue({ ok: true, data: null });
    const off = setBuiltinSourceRpc('fnmusic', {
        request: (...args: unknown[]) => request(args[0] as string, args[1] as Record<string, unknown> | undefined),
    });
    return { request, off };
};
