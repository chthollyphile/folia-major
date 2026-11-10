// src/services/onlineMusic/lxmusic/lxSourceHealth.ts
// 音源健康度：别每次都把时间浪费在已经死掉的源上。
//
// 用户的音源列表往往有十几条，真正还能出地址的只有两三条。没有这层记忆时，每次播放都要
// 重新在死源上等到超时；有了它，连续失败的源会进入冷却期（指数退避，最长 30 分钟），
// 竞速时直接排到最后甚至跳过，而好源会被排到最前面先发出去。
//
// 只记录「结果」，不记录原因：失败一次可能只是那首歌没有版权，所以冷却门槛是连续 2 次，
// 且成功后失败计数会衰减回 0 —— 一个源偶尔抽风不会被打死。

const STORAGE_KEY = 'lxmusic_source_health_v1';

/** 连续失败多少次之后开始冷却。 */
const COOLDOWN_FAIL_THRESHOLD = 2;
/** 第一次冷却 1 分钟，之后翻倍，最长 30 分钟。 */
const COOLDOWN_BASE_MS = 60_000;
const COOLDOWN_MAX_MS = 30 * 60_000;

export interface LxSourceHealth {
    /** 连败次数（成功会衰减）。 */
    fail: number;
    /** 累计成功次数，用来在都没冷却时也排出个先后。 */
    ok: number;
    lastFailAt: number;
    lastOkAt: number;
    /** 成功出地址的平均耗时（毫秒），快的先发。 */
    avgMs: number;
}

type HealthMap = Record<string, LxSourceHealth>;

const emptyHealth = (): LxSourceHealth => ({ fail: 0, ok: 0, lastFailAt: 0, lastOkAt: 0, avgMs: 0 });

const readStored = (): HealthMap => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as HealthMap;
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
};

let map: HealthMap = readStored();
let saveTimer: number | null = null;

const persistSoon = () => {
    if (saveTimer !== null) return;
    saveTimer = window.setTimeout(() => {
        saveTimer = null;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
        } catch {
            // 配额满了就算了，健康度丢了只是慢一点。
        }
    }, 1500);
};

/** 冷却剩余毫秒数；0 表示现在可以用。 */
export const cooldownLeftMs = (sourceId: string): number => {
    const entry = map[sourceId];
    if (!entry || entry.fail < COOLDOWN_FAIL_THRESHOLD) return 0;
    const span = Math.min(COOLDOWN_MAX_MS, COOLDOWN_BASE_MS * 2 ** Math.min(entry.fail - COOLDOWN_FAIL_THRESHOLD, 5));
    return Math.max(0, entry.lastFailAt + span - Date.now());
};

export const noteSourceSuccess = (sourceId: string, elapsedMs: number): void => {
    const entry = map[sourceId] ?? emptyHealth();
    entry.ok += 1;
    // 成功一次就把连败折半：偶发失败不该永久压着这个源。
    entry.fail = Math.max(0, entry.fail - 1);
    entry.lastOkAt = Date.now();
    entry.avgMs = entry.avgMs > 0 ? Math.round(entry.avgMs * 0.7 + elapsedMs * 0.3) : Math.round(elapsedMs);
    map[sourceId] = entry;
    persistSoon();
};

export const noteSourceFailure = (sourceId: string): void => {
    const entry = map[sourceId] ?? emptyHealth();
    entry.fail += 1;
    entry.lastFailAt = Date.now();
    map[sourceId] = entry;
    persistSoon();
};

/** 排序权重：没冷却的在前，失败少的、历史更快的、最近成功过的在前。 */
export const sourceRank = (sourceId: string): number => {
    const entry = map[sourceId];
    const cooling = cooldownLeftMs(sourceId) > 0 ? 1 : 0;
    if (!entry) return cooling * 1000 + 500;
    const failPenalty = entry.fail * 40;
    const speedPenalty = Math.min(300, entry.avgMs / 20); // 6s → 300
    const recencyBonus = entry.lastOkAt > 0 ? 0 : 120;
    return cooling * 1000 + failPenalty + speedPenalty + recencyBonus;
};

/** 给设置页看的：这个源现在是不是在冷却。 */
export const sourceHealthOf = (sourceId: string): (LxSourceHealth & { coolingMs: number }) | null => {
    const entry = map[sourceId];
    if (!entry) return null;
    return { ...entry, coolingMs: cooldownLeftMs(sourceId) };
};

/** 清空（重新导入 / 手动重置时用）。 */
export const resetSourceHealth = (sourceId?: string): void => {
    if (sourceId) delete map[sourceId];
    else map = {};
    persistSoon();
};
