import { vi } from 'vitest';
import type { UnifiedSong } from '@/types';
import type { OnlineMusicProvider } from '@/types/onlineMusic';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { normalizeKugouSong } from '../../../sources/kugou/core/kugouProvider';
import { setBuiltinSourceRpc } from './builtinSources';
// test/unit/helpers/kugouSource.ts
// 酷狗音源模组（sources/kugou/）在单测里的样子，照 qishuiSource.ts：它由 setupFiles（builtinSources.ts）用 core 的
// createSource(测试 env) 经适配层注册，测试拿到的是宿主的 provider，走桌面版的 transport。到 main 入口的三个调用由
// answerKugouRequests 的 vi.fn 接住，照 main/index.ts 的样子答：
//   - request：回的值当作桥的 data（{ ok: true, data }），抛的错的 message 当作桥的那一行（{ ok: false, message }）；
//   - anonymousSearch / legacyPlayInfo：回的值当作酷狗的正文（{ status: 200, bodyText }）；抛的错带 httpStatus 时是酷狗回的
//     那个状态，不带时是 main 没能问到（{ unreachable: true, message }）。
// 窗口里的账号 id 提示在页面存储（online_provider:kugou:userid），由 signInKugouHint 写。

/** 注册着的酷狗 provider（适配层组装的那一个）。 */
export const kugouProvider = (): OnlineMusicProvider => {
    const provider = getOnlineMusicProvider('kugou');
    if (!provider) throw new Error('[kugouSource] kugou 没有注册：测试文件要写一行 // @builtin-sources（helpers/builtinSources.ts），并且在用例或 beforeAll 里取');
    return provider;
};

/** 注册着的酷狗 provider，在第一次用到时才去取（内置音源在 setup 的 beforeAll 里注册）。 */
export const lazyKugou = (): OnlineMusicProvider => new Proxy({} as OnlineMusicProvider, {
    get: (_target, key) => Reflect.get(kugouProvider(), key),
});

/** 迁之前 normalizeKugouSong 的宿主形状：原始记录经模组变成 DTO，再经宿主的 normalizeSong 变成宿主的歌。 */
export const hostKugouSong = (raw: unknown): UnifiedSong => kugouProvider().normalizeSong(normalizeKugouSong(raw));

/** 窗口里的账号 id 提示（桌面版 transport 的 userid）：给了就是登录着，'' 或 null 就是没有。 */
export const signInKugouHint = (userId: string | null): void => {
    const key = 'online_provider:kugou:userid';
    if (userId) localStorage.setItem(key, userId);
    else localStorage.removeItem(key);
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** 酷狗回的非 2xx（anonymousSearch / legacyPlayInfo 的替身抛它）。 */
export const kugouHttpAnswer = (status: number): Error => Object.assign(new Error(`HTTP ${status}`), { httpStatus: status });

const plainAnswer = async (answer: () => unknown) => {
    try {
        const body = await answer();
        return { status: 200, bodyText: JSON.stringify(body ?? null) };
    } catch (error) {
        const status = (error as { httpStatus?: unknown }).httpStatus;
        return typeof status === 'number' ? { status, bodyText: '' } : { unreachable: true, message: messageOf(error) };
    }
};

/** 接住 client 到 main 入口的三个调用；交回记下每次参数的 vi.fn。 */
export const answerKugouRequests = () => {
    const request = vi.fn<(operation: string, params: Record<string, unknown>) => unknown>();
    const anonymousSearch = vi.fn<(keyword: string, page: number, pagesize: number) => unknown>();
    const legacyPlayInfo = vi.fn<(hash: string) => unknown>();
    const off = setBuiltinSourceRpc('kugou', {
        request: async (...args: unknown[]) => {
            try {
                return { ok: true, data: await request(args[0] as string, (args[1] ?? {}) as Record<string, unknown>) };
            } catch (error) {
                return { ok: false, message: messageOf(error) };
            }
        },
        anonymousSearch: (...args: unknown[]) => plainAnswer(() => anonymousSearch(args[0] as string, args[1] as number, args[2] as number)),
        legacyPlayInfo: (...args: unknown[]) => plainAnswer(() => legacyPlayInfo(args[0] as string)),
    });
    return { request, anonymousSearch, legacyPlayInfo, off };
};
