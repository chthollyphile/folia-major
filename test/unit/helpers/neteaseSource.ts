import { vi } from 'vitest';
import type { UnifiedSong } from '@/types';
import type { OnlineMusicProvider } from '@/types/onlineMusic';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { setBuiltinSourceRpc } from './builtinSources';
// test/unit/helpers/neteaseSource.ts
// 网易云音乐音源模组（sources/netease/）在单测里的样子，照 qqSource.ts。两种用法：
//   - 经注册的模组（测试文件写一行 // @builtin-sources）：setupFiles（builtinSources.ts）用 core 的 createSource(测试 env)
//     经适配层注册它，测试拿到的是宿主的 provider（neteaseProvider / lazyNetease），走桌面版的 transport：到 main 入口的
//     调用由 answerNeteaseBackend 接住，照 main/index.ts 的样子答 —— `status` / `restart` 答内嵌 API 的状态与端口（请求随后
//     发到 http://127.0.0.1:<端口>，测试照旧替换 fetch，或者 vi.mock 掉 core/netease.ts 的 neteaseApi），`diagnostics` /
//     `selfCheck` 答快照与自检。
//   - 只测 core（模块级的函数，常和 vi.resetModules 一起用）：createNeteaseCore 现载 core/index.ts，用一份轻量的 env 调
//     createSource（不注册），默认是网页版（VITE_NETEASE_API_BASE 每次现读 process.env），desktop() 换成桌面版。
// 登录的 cookie 在页面存储 online_provider:netease:cookie，由 signInNetease 写。

/** 注册着的网易云 provider（适配层组装的那一个）。 */
export const neteaseProvider = (): OnlineMusicProvider => {
    const provider = getOnlineMusicProvider('netease');
    if (!provider) throw new Error('[neteaseSource] netease 没有注册：测试文件要写一行 // @builtin-sources（helpers/builtinSources.ts），并且在用例或 beforeAll 里取');
    return provider;
};

/** 注册着的网易云 provider，在第一次用到时才去取（内置音源在 setup 的 beforeAll 里注册）。 */
export const lazyNetease = (): OnlineMusicProvider => new Proxy({} as OnlineMusicProvider, {
    get: (_target, key) => Reflect.get(neteaseProvider(), key),
});

/** 迁之前 normalizeSong 的宿主形状：网易云的原始歌经模组变成 DTO，再经宿主的 normalizeSong 变成宿主的歌。 */
export const hostNeteaseSong = async (raw: unknown): Promise<UnifiedSong> => {
    const { normalizeNeteaseSong } = await import('../../../sources/netease/core/neteaseProvider');
    return neteaseProvider().normalizeSong(normalizeNeteaseSong(raw));
};

export const NETEASE_SESSION_KEY = 'online_provider:netease:cookie';

/** 窗口里存着的登录 cookie：给了就是登录着，null 就是没有。 */
export const signInNetease = (cookie: string | null = 'MUSIC_U=opaque-token'): void => {
    if (cookie) localStorage.setItem(NETEASE_SESSION_KEY, cookie);
    else localStorage.removeItem(NETEASE_SESSION_KEY);
};

export interface NeteaseBackendStatusAnswer {
    status?: string;
    port?: number | null;
    error?: string | null;
    offline?: boolean;
    updatedAt?: number;
}

const statusOf = (answer: NeteaseBackendStatusAnswer) => ({
    status: answer.status ?? (answer.port === null ? 'error' : 'running'),
    port: answer.port === undefined ? 3000 : answer.port,
    error: answer.error ?? null,
    updatedAt: answer.updatedAt ?? 1,
    ...(answer.offline === undefined ? {} : { offline: answer.offline }),
});

const rpcHandlersOf = (answer: NeteaseBackendStatusAnswer) => {
    const status = vi.fn<() => unknown>(() => statusOf(answer));
    const restart = vi.fn<(reason?: unknown) => unknown>(() => statusOf(answer));
    const diagnostics = vi.fn<() => unknown>(() => null);
    const selfCheck = vi.fn<() => unknown>(() => null);
    const handlers = {
        status: () => status(),
        restart: (...args: unknown[]) => restart(args[0]),
        diagnostics: () => diagnostics(),
        selfCheck: () => selfCheck(),
    };
    return { status, restart, diagnostics, selfCheck, handlers };
};

/**
 * 接住注册着的模组到 main 入口的调用；交回记下每次参数的 vi.fn（`status` 与 `restart` 缺省答 port 3000 的 running，
 * mockReturnValue 换掉它）。
 */
export const answerNeteaseBackend = (answer: NeteaseBackendStatusAnswer = {}) => {
    const { handlers, ...fns } = rpcHandlersOf(answer);
    const off = setBuiltinSourceRpc('netease', handlers);
    return { ...fns, off };
};

// 页面存储（folium.sources.pageStore）的样子，直接用全局的 localStorage：测试常把它换成一个 Map。
const localPageStore = (sourceId: string) => ({
    get: (key: string) => localStorage.getItem(`online_provider:${sourceId}:${key}`),
    set: (key: string, value: string | null) => {
        if (value === null) localStorage.removeItem(`online_provider:${sourceId}:${key}`);
        else localStorage.setItem(`online_provider:${sourceId}:${key}`, value);
    },
    keys: () => [] as string[],
});

/** 只测 core 时那一份 env 的开关。 */
export interface NeteaseTestCore {
    /** 换成桌面版：请求经 rpc（answer 同 answerNeteaseBackend）。交回那几个 vi.fn。 */
    desktop(answer?: NeteaseBackendStatusAnswer): ReturnType<typeof rpcHandlersOf>;
    /** 换回网页版（VITE_NETEASE_API_BASE）。 */
    web(): void;
    /** createSource 交回的定义。 */
    def: unknown;
    /** 模组交给 handle.notify 的提示。 */
    notices: unknown[];
}

/**
 * 现载 core/index.ts，用一份轻量的 env 调 createSource（不注册）：文字就是键名（带参数的括上参数），错是宿主的 createFoliumSourceError，
 * 页面存储直接读写全局的 localStorage。缺省是网页版；`desktop` 为 true 时一开始就是桌面版。
 */
export const createNeteaseCore = async ({ desktop = false }: { desktop?: boolean } = {}): Promise<NeteaseTestCore> => {
    const [core, errors, folium18n, sharedHelpers] = await Promise.all([
        import('../../../sources/netease/core/index'),
        import('@/mods/folium/sources/errors'),
        import('@/mods/folium/sources/i18n'),
        import('@/mods/folium/sharedHelpers'),
    ]);
    let handlers: Record<string, (...args: unknown[]) => unknown> = {};
    let isDesktop = desktop;
    const notices: unknown[] = [];
    const i18n = folium18n.createFoliumI18n((key, params) => (params && Object.keys(params).length > 0
        ? `${key}(${Object.entries(params).map(([name, value]) => `${name}=${value}`).join(',')})`
        : key));
    const web = {
        get apiBase() {
            return typeof process !== 'undefined' ? process.env.VITE_NETEASE_API_BASE ?? '' : '';
        },
    };
    const env = {
        modId: 'netease',
        call: async <T>(name: string, ...args: unknown[]): Promise<T> => {
            const handler = handlers[name];
            if (!handler) throw new Error(`[neteaseSource] core 调了 main 入口的 ${name}，测试没有接住它`);
            return JSON.parse(JSON.stringify(await handler(...args)) ?? 'null') as T;
        },
        text: (key: string, params?: Record<string, string | number>) => i18n.key(key, params),
        translate: (key: string, params?: Record<string, string | number>) => i18n.text(key, params),
        error: errors.createFoliumSourceError,
        isPureMusicText: (text: string | null | undefined) => sharedHelpers.FOLIUM_LYRICS_HELPERS.isPureMusicText(text ?? null),
        pageStore: localPageStore,
        notify: (notice: unknown) => {
            notices.push(notice);
        },
        get web() {
            return isDesktop ? undefined : web;
        },
    };
    const def = core.createSource(env);
    const result: NeteaseTestCore = {
        desktop: (answer = {}) => {
            isDesktop = true;
            const made = rpcHandlersOf(answer);
            handlers = made.handlers;
            return made;
        },
        web: () => {
            isDesktop = false;
        },
        def,
        notices,
    };
    if (desktop) result.desktop();
    return result;
};
