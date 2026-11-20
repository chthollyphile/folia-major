// src/services/onlineMusic/lxmusic/lxDiagnostics.ts
//
// 「为什么这首歌放不了」的现场记录。
//
// 洛雪的取地址链路上有音源脚本、跨平台搜索、探活、回环代理好几段，任何一段出问题
// 在外表现都是同一句「播放失败」。用户在手机上又看不到控制台，只能靠猜。
// 这里把每次取地址的结果（成败、耗时、胜出来源、地址主机、失败原因）留一圈在本地，
// 音源页可以一键复制出来 —— 下次再排查就不用让他描述现场了。

const STORAGE_KEY = 'lxmusic_play_diag_v1';
const LIMIT = 40;

export type LxPlaybackDiag = {
    at: number;
    platform: string;
    songId: string;
    name?: string;
    quality: string;
    ok: boolean;
    ms: number;
    /** 胜出来的候选来自哪个音源 / 哪条链路。 */
    via?: string;
    /** 地址的主机名 —— 不看完整 URL 也能判断是不是 CDN。 */
    host?: string;
    error?: string;
};

const read = (): LxPlaybackDiag[] => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed as LxPlaybackDiag[] : [];
    } catch {
        return [];
    }
};

export const notePlaybackAttempt = (entry: Omit<LxPlaybackDiag, 'at'>): void => {
    try {
        const list = read();
        const host = entry.host ?? (() => {
            try {
                return entry.via?.startsWith('http') ? new URL(entry.via).host : undefined;
            } catch {
                return undefined;
            }
        })();
        list.push({ ...entry, host, at: Date.now() });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(-LIMIT)));
    } catch {
        // 记录本身不能影响播放。
    }
};

export const readPlaybackDiagnostics = (): LxPlaybackDiag[] => read();

export const clearPlaybackDiagnostics = (): void => {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        // 忽略。
    }
};

/** 一键复制用：按时间顺序、一行一条，人也能直接读。 */
export const formatPlaybackDiagnostics = (): string => {
    const list = read();
    if (list.length === 0) return '（还没有播放记录）';
    const version = typeof __APP_VERSION__ === 'undefined' ? '?' : __APP_VERSION__;
    const build = typeof __COMMIT_HASH__ === 'undefined' ? '?' : __COMMIT_HASH__.slice(0, 7);
    const lines = list.map((item) => {
        const time = new Date(item.at).toLocaleString('zh-CN', { hour12: false });
        return `${time} ${item.platform}:${item.songId} ${item.name ?? ''} [${item.quality}] `
            + `${item.ok ? 'OK' : 'FAIL'} ${item.ms}ms`
            + `${item.via ? ` via=${item.via}` : ''}`
            + `${item.host ? ` host=${item.host}` : ''}`
            + `${item.error ? ` err=${item.error}` : ''}`;
    });
    return [`Folia v${version} · build ${build}`, ...lines].join('\n');
};
