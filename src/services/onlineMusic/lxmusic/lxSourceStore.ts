// src/services/onlineMusic/lxmusic/lxSourceStore.ts
// 洛雪音源的持久化与运行注册表：
// - 音源的「元信息 + 原始脚本」存 IndexedDB（db.ts 的 cache），进程重启后还在；
// - 加载后的脚本（request 回调）放在内存里，用来实时续歌；
// - 提供 resolveMusicUrl / resolveLyric 给 lxmusicProvider 调用。

import { getFromCache, saveToCache } from '../../../services/db';
import type { LxLoadedSource, LxPlatformKey, LxSource } from './lxTypes';
import { loadLxSource } from './lxRuntime';
import { parseLxHeader } from './lxSourceParser';
import { raceCandidates, withTimeout, type LxRaceTask } from './lxRace';
import { cooldownLeftMs, noteSourceFailure, noteSourceSuccess, resetSourceHealth, sourceRank } from './lxSourceHealth';

const STORAGE_KEY = 'lxmusic_sources_v1';

type Listener = () => void;

/** 音源 callback 可能给字符串、{ url } 或 { url, headers }，统一成后两种之外的形式由调用方再判。 */
const normalizeMusicUrl = (
    raw: unknown,
): string | { url: string; headers?: Record<string, string> } | null => {
    if (typeof raw === 'string') return raw.length > 0 ? raw : null;
    if (raw && typeof raw === 'object' && 'url' in (raw as Record<string, unknown>)) {
        const record = raw as { url?: unknown; headers?: Record<string, string> };
        if (typeof record.url === 'string' && record.url.length > 0) {
            return { url: record.url, headers: record.headers };
        }
    }
    return null;
};

class LxSourceStore {
    private sources: LxSource[] = [];
    private loaded = new Map<string, LxLoadedSource>();
    private listeners = new Set<Listener>();
    private initPromise: Promise<void> | null = null;

    init(): Promise<void> {
        if (this.initPromise) return this.initPromise;
        this.initPromise = (async () => {
            const stored = await getFromCache<LxSource[]>(STORAGE_KEY);
            this.sources = Array.isArray(stored) ? stored : [];
            await this.reloadAll();
            this.notify();
        })();
        return this.initPromise;
    }

    /** 等音源初始化完（最多等 timeoutMs），播放前调用；已就绪时几乎零开销。 */
    async ensureReady(timeoutMs = 6000): Promise<void> {
        await Promise.race([
            this.init(),
            new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs)),
        ]);
    }

    private async persist(): Promise<void> {
        await saveToCache(STORAGE_KEY, this.sources);
    }

    /**
     * 重新加载全部音源。
     * 真实音源多半是「先 await 探测接口、再 send(inited)」，所以要等每条 ready 之后再读
     * sources / error；否则会把好好的音源判成「未声明任何平台」。
     */
    private async reloadAll(): Promise<void> {
        this.loaded.clear();
        const pending = this.sources
            .filter((src) => src.enabled)
            .map(async (src) => {
                try {
                    const loaded = await this.loadOne(src.rawScript, src.meta);
                    this.loaded.set(src.id, { ...loaded, id: src.id });
                    src.sources = loaded.sources;
                    src.error = loaded.error;
                } catch (err) {
                    this.loaded.set(src.id, {
                        id: src.id,
                        meta: src.meta,
                        sources: {},
                        requestHandler: async () => null,
                        error: String(err),
                        ready: Promise.resolve(),
                    });
                }
            });
        await Promise.all(pending);
    }

    /** 加载并等初始化完成。 */
    private async loadOne(rawScript: string, meta: LxSource['meta']): Promise<LxLoadedSource> {
        const loaded = loadLxSource(rawScript, meta);
        await loaded.ready;
        return loaded;
    }

    private notify(): void {
        this.listeners.forEach((l) => l());
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    getSources(): LxSource[] {
        return this.sources;
    }

    getLoaded(id: string): LxLoadedSource | undefined {
        return this.loaded.get(id);
    }

    /** 新增一个音源（来自在线导入或本地文件）。已存在同名则覆盖。 */
    async addSource(input: { rawScript: string; sourceUrl?: string }): Promise<LxSource> {
        const meta = parseLxHeader(input.rawScript);
        const id = (globalThis.crypto?.randomUUID?.() ?? `lx_${Date.now()}_${Math.random().toString(36).slice(2)}`);
        // 等初始化结束，才知道这个源到底支持哪些平台、能不能用。
        const loaded = await this.loadOne(input.rawScript, meta);
        const source: LxSource = {
            id,
            meta,
            rawScript: input.rawScript,
            sources: loaded.sources,
            enabled: true,
            importedAt: Date.now(),
            sourceUrl: input.sourceUrl,
            error: loaded.error,
        };
        const idx = this.sources.findIndex((s) => s.meta.name === meta.name);
        if (idx >= 0) this.sources[idx] = source;
        else this.sources.push(source);
        this.loaded.set(id, { ...loaded, id });
        // 重新导入的脚本多半是修过的版本，旧的失败记录不该继续压着它。
        resetSourceHealth(id);
        await this.persist();
        this.notify();
        return source;
    }

    async setEnabled(id: string, enabled: boolean): Promise<void> {
        const src = this.sources.find((s) => s.id === id);
        if (!src) return;
        src.enabled = enabled;
        if (enabled) {
            const loaded = await this.loadOne(src.rawScript, src.meta);
            src.sources = loaded.sources;
            src.error = loaded.error;
            this.loaded.set(id, { ...loaded, id });
        } else {
            this.loaded.delete(id);
        }
        await this.persist();
        this.notify();
    }

    async removeSource(id: string): Promise<void> {
        this.sources = this.sources.filter((s) => s.id !== id);
        this.loaded.delete(id);
        await this.persist();
        this.notify();
    }

    /** 重新加载某个音源（编辑脚本后）。 */
    async reload(id: string): Promise<void> {
        const src = this.sources.find((s) => s.id === id);
        if (!src) return;
        const loaded = await this.loadOne(src.rawScript, src.meta);
        src.sources = loaded.sources;
        src.error = loaded.error;
        if (src.enabled) this.loaded.set(id, { ...loaded, id });
        resetSourceHealth(id);
        await this.persist();
        this.notify();
    }

    /**
     * 能处理某个平台某种 action 的音源，按健康度排序（好的在前，冷却中的排最后）。
     * 竞速的任务表就是从这里出来的。
     */
    private candidatesFor(
        platform: LxPlatformKey,
        action: 'musicUrl' | 'lyric' | 'pic',
    ): Array<{ source: LxSource; loaded: LxLoadedSource }> {
        const out: Array<{ source: LxSource; loaded: LxLoadedSource; rank: number }> = [];
        for (const source of this.sources) {
            if (!source.enabled) continue;
            const platformInfo = source.sources[platform];
            if (!platformInfo || !platformInfo.actions.includes(action)) continue;
            const loaded = this.loaded.get(source.id);
            if (!loaded || !loaded.requestHandler || loaded.error) continue;
            out.push({ source, loaded, rank: sourceRank(source.id) });
        }
        out.sort((a, b) => a.rank - b.rank);
        return out.map(({ source, loaded }) => ({ source, loaded }));
    }

    /**
     * 为某个平台建一批「取播放地址」的任务，一个音源一个。
     * 由调用方和跨平台任务一起丢进 raceCandidates —— 先交出可用地址的赢。
     */
    musicTasksFor(
        platform: LxPlatformKey,
        quality: string,
        musicInfo: Record<string, unknown>,
        accept?: (value: unknown) => Promise<boolean>,
        timeoutMs = 7000,
    ): LxRaceTask<string | { url: string; headers?: Record<string, string> }>[] {
        return this.candidatesFor(platform, 'musicUrl').map(({ source, loaded }) => ({
            label: `${source.meta.name}/${platform}`,
            run: async () => {
                const startedAt = Date.now();
                const raw = await withTimeout(
                    loaded.requestHandler({ source: platform, action: 'musicUrl', info: { type: quality, musicInfo } }),
                    timeoutMs,
                );
                const parsed = normalizeMusicUrl(raw);
                if (!parsed) {
                    // 没地址也算一次失败：这个源在这个平台上确实交不出东西。
                    noteSourceFailure(source.id);
                    return null;
                }
                if (accept && !(await accept(parsed))) {
                    console.warn(`[lx] 音源 ${source.meta.name} 给的 ${platform} 地址打不开，换下一个`);
                    noteSourceFailure(source.id);
                    return null;
                }
                noteSourceSuccess(source.id, Date.now() - startedAt);
                return parsed;
            },
        }));
    }

    /**
     * 取播放地址：本平台所有可用音源同时上，谁先给出能播的地址用谁。
     * 返回 url 字符串，或 { url, headers }。
     */
    async resolveMusicUrl(
        platform: LxPlatformKey,
        quality: string,
        musicInfo: Record<string, unknown>,
        accept?: (value: unknown) => Promise<boolean>,
    ): Promise<string | { url: string; headers?: Record<string, string> } | null> {
        const tasks = this.musicTasksFor(platform, quality, musicInfo, accept);
        if (tasks.length === 0) return null;
        return raceCandidates(tasks, { initial: 3, staggerMs: 200, maxConcurrent: 6 });
    }

    /**
     * 歌词 / 封面：也给竞速，但这些没有「探活」这一步，串行反而省请求，所以两个一起发就够。
     */
    private async resolveFirst(
        platform: LxPlatformKey,
        action: 'lyric' | 'pic',
        info: { type?: string | null; musicInfo: Record<string, unknown> },
    ): Promise<unknown> {
        const tasks: LxRaceTask<unknown>[] = this.candidatesFor(platform, action).map(({ source, loaded }) => ({
            label: `${source.meta.name}/${platform}/${action}`,
            run: () => withTimeout(
                loaded.requestHandler({ source: platform, action, info }).catch((err) => {
                    console.warn(`[lx] 音源 ${source.meta.name} 处理 ${action}/${platform} 失败：`, err);
                    noteSourceFailure(source.id);
                    return null;
                }),
                action === 'lyric' ? 12000 : 8000,
            ),
        }));
        if (tasks.length === 0) return null;
        return raceCandidates(tasks, { initial: 2, staggerMs: 400, maxConcurrent: 2 });
    }

    async resolveLyric(platform: LxPlatformKey, musicInfo: Record<string, unknown>): Promise<unknown> {
        return this.resolveFirst(platform, 'lyric', { musicInfo });
    }

    /** 有没有音源能处理这个平台的某种 action。UI 用它提示「没导入音源就放不了歌」。 */
    canResolve(platform: LxPlatformKey, action: 'musicUrl' | 'lyric' | 'pic' = 'musicUrl'): boolean {
        return this.candidatesFor(platform, action).length > 0;
    }

    /** 这个平台还有没有「没进冷却」的源：跨平台兜底时先挑这些，别去撞已知的死源。 */
    hasLiveSourceFor(platform: LxPlatformKey, action: 'musicUrl' | 'lyric' | 'pic' = 'musicUrl'): boolean {
        return this.candidatesFor(platform, action).some(({ source }) => cooldownLeftMs(source.id) === 0);
    }

    /** 有没有任何音源能处理某种 action（不限定平台）。跨平台兜底时用它判断「还有没有戏」。 */
    canResolveAny(action: 'musicUrl' | 'lyric' | 'pic' = 'musicUrl'): boolean {
        return this.sources.some((src) => {
            if (!src.enabled) return false;
            const loaded = this.loaded.get(src.id);
            if (!loaded?.requestHandler || loaded.error) return false;
            return Object.values(src.sources).some((info) => Boolean(info?.actions.includes(action)));
        });
    }

    /** 统计可用 / 有错误的音源数，给 UI 用。 */
    stats(): { total: number; enabled: number; errors: number } {
        return {
            total: this.sources.length,
            enabled: this.sources.filter((s) => s.enabled).length,
            errors: this.sources.filter((s) => s.error).length,
        };
    }
}

export const lxSourceStore = new LxSourceStore();
