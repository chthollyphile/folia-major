import { vi } from 'vitest';
import type { UnifiedSong } from '@/types';
import type { OnlineMusicProvider, ProviderCollection } from '@/types/onlineMusic';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { toHostCollection } from '@/mods/folium/registries/sourceDtos';
import { normalizeQqCollection, normalizeQqSong } from '../../../sources/qq/core/qqNormalize';
import { setBuiltinSourceRpc } from './builtinSources';
// test/unit/helpers/qqSource.ts
// QQ 音乐音源模组（sources/qq/）在单测里的样子，照 kugouSource.ts。两种用法：
//   - 经注册的模组（测试文件写一行 // @builtin-sources）：setupFiles（builtinSources.ts）用 core 的 createSource(测试 env)
//     经适配层注册它，测试拿到的是宿主的 provider（qqProvider / lazyQq），走桌面版的 transport：到 main 入口的调用由
//     answerQqBackend 接住，照 main/index.ts 的样子答 —— `status` 答内嵌后端的端口（请求随后发到 http://127.0.0.1:<端口>，
//     测试照旧替换 fetch），`musicu` 答 QQ 的状态与正文，`diagnostics` / `selfCheck` 答快照与自检。
//   - 只测 core（transport、归一化这些模块级的函数，常和 vi.resetModules 一起用）：createQqCore 现载 core/index.ts，用一份
//     轻量的 env 调 createSource（不注册），默认是网页版（VITE_QQ_API_BASE 每次现读 process.env），desktop() 换成桌面版。
// 窗口里的会话（opaque 的 qqmusic_session）在页面存储 online_provider:qq:cookie，由 signInQq 写。

/** 注册着的 QQ provider（适配层组装的那一个）。 */
export const qqProvider = (): OnlineMusicProvider => {
    const provider = getOnlineMusicProvider('qq');
    if (!provider) throw new Error('[qqSource] qq 没有注册：测试文件要写一行 // @builtin-sources（helpers/builtinSources.ts），并且在用例或 beforeAll 里取');
    return provider;
};

/** 注册着的 QQ provider，在第一次用到时才去取（内置音源在 setup 的 beforeAll 里注册）。 */
export const lazyQq = (): OnlineMusicProvider => new Proxy({} as OnlineMusicProvider, {
    get: (_target, key) => Reflect.get(qqProvider(), key),
});

/** 迁之前 normalizeQqSong 的宿主形状：原始记录经模组变成 DTO，再经宿主的 normalizeSong 变成宿主的歌。 */
export const hostQqSong = (raw: unknown): UnifiedSong => qqProvider().normalizeSong(normalizeQqSong(raw));

/** 迁之前 normalizeQqCollection 的宿主形状：原始条目经模组变成 DTO，再按宿主的样子换成宿主的集合。 */
export const hostQqCollection = (raw: unknown, type?: string): ProviderCollection => toHostCollection('qq', normalizeQqCollection(raw, type));

/** A host song's numeric QQ songid: the source mod keeps it in the song's data (`sourceRef.providerData.songId`). */
export const songIdOf = (song: UnifiedSong): unknown => (song.sourceRef?.kind === 'online' ? song.sourceRef.providerData?.songId : undefined);

export const QQ_SESSION_KEY = 'online_provider:qq:cookie';

/** 窗口里存着的后端会话：给了就是登录着，null 就是没有。 */
export const signInQq = (session: string | null = 'qqmusic_session=opaque-token'): void => {
    if (session) localStorage.setItem(QQ_SESSION_KEY, session);
    else localStorage.removeItem(QQ_SESSION_KEY);
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** QQ 回的非 2xx（musicu 的替身抛它）。 */
export const qqHttpAnswer = (status: number, retryAfter: string | null = null): Error => (
    Object.assign(new Error(`HTTP ${status}`), { httpStatus: status, retryAfter })
);

/** 替身的答复照 main 入口 `musicu` 的样子包起来：正文、QQ 回的状态，或者问不到。 */
const musicuAnswer = async (answer: () => unknown) => {
    try {
        const body = await answer();
        return { status: 200, text: typeof body === 'string' ? body : JSON.stringify(body ?? null), retryAfter: null };
    } catch (error) {
        const { httpStatus, retryAfter } = error as { httpStatus?: unknown; retryAfter?: unknown };
        return typeof httpStatus === 'number'
            ? { status: httpStatus, text: '', retryAfter: typeof retryAfter === 'string' ? retryAfter : null }
            : { unreachable: true, message: messageOf(error) };
    }
};

export interface QqBackendStatusAnswer {
    status?: string;
    port?: number | null;
    error?: string | null;
    sessionStoreUnreadable?: boolean;
    updatedAt?: number;
}

const statusOf = (answer: QqBackendStatusAnswer) => ({
    status: answer.status ?? (answer.port === null ? 'error' : 'running'),
    port: answer.port === undefined ? 4000 : answer.port,
    error: answer.error ?? null,
    updatedAt: answer.updatedAt ?? 1,
    ...(answer.sessionStoreUnreadable === undefined ? {} : { sessionStoreUnreadable: answer.sessionStoreUnreadable }),
});

const rpcHandlersOf = (answer: QqBackendStatusAnswer) => {
    const status = vi.fn<() => unknown>(() => statusOf(answer));
    const musicu = vi.fn<(payload: unknown) => unknown>();
    const diagnostics = vi.fn<() => unknown>(() => null);
    const selfCheck = vi.fn<() => unknown>(() => null);
    const handlers = {
        status: () => status(),
        musicu: (...args: unknown[]) => musicuAnswer(() => musicu(args[0])),
        diagnostics: () => diagnostics(),
        selfCheck: () => selfCheck(),
    };
    return { status, musicu, diagnostics, selfCheck, handlers };
};

/**
 * 接住注册着的模组到 main 入口的调用；交回记下每次参数的 vi.fn（`status` 缺省答 port 4000 的 running，
 * mockReturnValue 换掉它；`musicu` 回的值当作 QQ 的正文，抛 qqHttpAnswer 是 QQ 回的状态，抛别的是没问到）。
 */
export const answerQqBackend = (answer: QqBackendStatusAnswer = {}) => {
    const { handlers, ...fns } = rpcHandlersOf(answer);
    const off = setBuiltinSourceRpc('qq', handlers);
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
export interface QqTestCore {
    /** 换成桌面版：请求经 rpc（answer 同 answerQqBackend）。交回那几个 vi.fn。 */
    desktop(answer?: QqBackendStatusAnswer): ReturnType<typeof rpcHandlersOf>;
    /** 换回网页版（VITE_QQ_API_BASE）。 */
    web(): void;
    /** createSource 交回的定义。 */
    def: unknown;
}

/**
 * 现载 core/index.ts，用一份轻量的 env 调 createSource（不注册）：文字就是键名（带参数的括上参数），错是宿主的 createFoliumSourceError，
 * 页面存储直接读写全局的 localStorage（同一个键；宿主的那一个在没有 window 的环境里什么都不存）。缺省是网页版；`desktop` 为 true 时一开始就是桌面版。
 */
export const createQqCore = async ({ desktop = false }: { desktop?: boolean } = {}): Promise<QqTestCore> => {
    const [core, errors, folium18n, lyricProxy, sharedHelpers] = await Promise.all([
        import('../../../sources/qq/core/index'),
        import('@/mods/folium/sources/errors'),
        import('@/mods/folium/sources/i18n'),
        import('@/services/lyricProxy'),
        import('@/mods/folium/sharedHelpers'),
    ]);
    let handlers: Record<string, (...args: unknown[]) => unknown> = {};
    let isDesktop = desktop;
    // 文字就是键名；带参数的在后面括上参数（explore.similar(name=某首歌)），好分得出是哪一栏。
    const i18n = folium18n.createFoliumI18n((key, params) => (params && Object.keys(params).length > 0
        ? `${key}(${Object.entries(params).map(([name, value]) => `${name}=${value}`).join(',')})`
        : key));
    const web = {
        get apiBase() {
            return typeof process !== 'undefined' ? process.env.VITE_QQ_API_BASE ?? '' : '';
        },
        relayUrl: lyricProxy.lyricProxyWebUrl,
    };
    const env = {
        modId: 'qq',
        call: async <T>(name: string, ...args: unknown[]): Promise<T> => {
            const handler = handlers[name];
            if (!handler) throw new Error(`[qqSource] core 调了 main 入口的 ${name}，测试没有接住它`);
            return JSON.parse(JSON.stringify(await handler(...args)) ?? 'null') as T;
        },
        text: (key: string, params?: Record<string, string | number>) => i18n.key(key, params),
        translate: (key: string, params?: Record<string, string | number>) => i18n.text(key, params),
        error: errors.createFoliumSourceError,
        isPureMusicText: (text: string | null | undefined) => sharedHelpers.FOLIUM_LYRICS_HELPERS.isPureMusicText(text ?? null),
        pageStore: localPageStore,
        get web() {
            return isDesktop ? undefined : web;
        },
    };
    const def = core.createSource(env);
    const result: QqTestCore = {
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
    };
    if (desktop) result.desktop();
    return result;
};
