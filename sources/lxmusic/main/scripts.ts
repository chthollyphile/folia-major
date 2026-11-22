import type { LxScriptInfo } from './sandbox/runtime.ts';

// sources/lxmusic/main/scripts.ts
// 洛雪自定义源脚本的静态处理和脚本库：读头注释、基本校验、把 { script } 这类 JSON 包装剥掉，校验脚本在
// inited 里声明的平台，以及把脚本存进模组自己的 api.storage。这里不运行脚本（运行在 sandboxHost.ts）。
// 头注释的解析、校验规则和 JSON 包装的处理取自 PR #1177（作者 baixiao0919）的 lxSourceParser.ts。

/** 洛雪脚本用的平台键里这个模组有曲库的四家。 */
export const LX_PLATFORMS = ['kw', 'kg', 'tx', 'wy'] as const;
export type LxPlatform = typeof LX_PLATFORMS[number];
/** 洛雪的音质档，从低到高。 */
export const LX_QUALITIES = ['128k', '320k', 'flac', 'flac24bit'] as const;
export type LxQuality = typeof LX_QUALITIES[number];
const LX_ACTIONS = ['musicUrl', 'lyric', 'pic'] as const;
export type LxAction = typeof LX_ACTIONS[number];

/** 单个脚本的大小上限（UTF-8 字节）。 */
export const MAX_SCRIPT_BYTES = 2 * 1024 * 1024;
/** 脚本库里最多存几个。 */
export const MAX_SCRIPTS = 16;

export const isLxPlatform = (value: unknown): value is LxPlatform => (LX_PLATFORMS as readonly unknown[]).includes(value);

/** 脚本对一家平台声明的能力。 */
export interface LxPlatformSupport {
    actions: LxAction[];
    qualities: LxQuality[];
}
export type LxDeclaredSources = Partial<Record<LxPlatform, LxPlatformSupport>>;

/** 脚本库里的一条（不含脚本原文）。 */
export interface LxScriptRecord {
    id: string;
    info: LxScriptInfo;
    sources: LxDeclaredSources;
    importedAt: number;
    /** 导入时的文件名，只是给人看的。 */
    fileName: string;
}

/** 导入失败的原因，client 按它给出本地化的提示。 */
export type LxImportFailure = 'too-large' | 'not-a-script' | 'no-platform' | 'too-many' | 'load-failed' | 'unreadable';

export class LxImportError extends Error {
    readonly code: LxImportFailure;
    constructor(code: LxImportFailure, detail = '') {
        super(detail ? `${code}: ${detail}` : code);
        this.name = 'LxImportError';
        this.code = code;
    }
}

const clip = (value: string, max: number) => value.trim().slice(0, max);

/** 从脚本开头的块注释里读 @name 等信息。 */
export const parseLxHeader = (code: string, fallbackName: string): LxScriptInfo => {
    const info: LxScriptInfo = { name: clip(fallbackName, 48) || 'script' };
    const header = code.slice(0, 4000);
    // 只扫开头的块注释，免得命中正文里的 @xxx。
    const block = /\/\*\*?([\s\S]*?)\*\//.exec(header);
    const pattern = /@(\w+)[ \t]+(.+)/g;
    for (let match = pattern.exec(block ? block[1] : ''); match; match = pattern.exec(block ? block[1] : '')) {
        const value = match[2];
        if (match[1] === 'name' && value.trim()) info.name = clip(value, 48);
        else if (match[1] === 'description') info.description = clip(value, 120);
        else if (match[1] === 'version') info.version = clip(value, 32);
        else if (match[1] === 'author') info.author = clip(value, 48);
        else if (match[1] === 'homepage') info.homepage = clip(value, 256);
    }
    return info;
};

/** 把文件内容规整成脚本文本：有的「音源」以 JSON 分发（{ name, script }）。 */
export const normalizeLxScript = (raw: string): string => {
    const text = raw.replace(/^\uFEFF/, '').trim();
    if (text.startsWith('{') && text.endsWith('}')) {
        try {
            const wrapped = JSON.parse(text) as Record<string, unknown>;
            for (const key of ['script', 'source', 'code', 'js', 'rawScript']) {
                const value = wrapped[key];
                if (typeof value === 'string' && value.length > 0) return value.trim();
            }
        } catch {
            // 不是 JSON，当脚本看。
        }
    }
    return text;
};

/**
 * 不运行脚本的基本检查。不要求字面的 `globalThis.lx`：混淆过的脚本写的是 `globalThis['\x6c\x78']`，
 * 真正的判定是运行时它有没有 send('inited')。
 */
export const validateLxScript = (code: string): void => {
    if (Buffer.byteLength(code, 'utf8') > MAX_SCRIPT_BYTES) throw new LxImportError('too-large');
    if (code.length < 40 || /^\s*<(!doctype|html)/i.test(code)) throw new LxImportError('not-a-script');
    if (!/globalThis|EVENT_NAMES|\brequest\b|\bsend\b|\blx\b/.test(code)) throw new LxImportError('not-a-script');
};

/** 脚本在 inited 里声明的 `sources`：只留认得的平台、动作、音质，别的都丢掉（它是第三方代码给的数据）。 */
export const sanitizeDeclaredSources = (raw: unknown): LxDeclaredSources => {
    const out: LxDeclaredSources = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const platform of LX_PLATFORMS) {
        const entry = (raw as Record<string, unknown>)[platform];
        if (!entry || typeof entry !== 'object') continue;
        const { actions, qualitys } = entry as { actions?: unknown; qualitys?: unknown };
        const kept: LxPlatformSupport = {
            actions: LX_ACTIONS.filter(action => Array.isArray(actions) && actions.includes(action)),
            qualities: LX_QUALITIES.filter(quality => Array.isArray(qualitys) && qualitys.includes(quality)),
        };
        if (!kept.actions.includes('musicUrl')) continue;
        // 没写音质的脚本按最低一档算。
        if (kept.qualities.length === 0) kept.qualities = ['128k'];
        out[platform] = kept;
    }
    return out;
};

/** 模组 storage 里这里用到的那几个方法。 */
export interface ScriptStorage {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
}

const INDEX_KEY = 'scripts';
const ACTIVE_KEY = 'activeScript';
const PLATFORM_KEY = 'platform';
const codeKey = (id: string) => `script:${id}`;

const isRecord = (value: unknown): value is LxScriptRecord => (
    !!value && typeof value === 'object'
    && typeof (value as LxScriptRecord).id === 'string'
    && typeof (value as LxScriptRecord).info?.name === 'string'
);

/** 脚本库：清单、原文、当前用哪个、搜哪家平台。都在模组自己的 storage 里。 */
export const createScriptLibrary = (storage: ScriptStorage) => {
    let cache: { records: LxScriptRecord[]; activeId: string | null; platform: LxPlatform | null } | null = null;

    const read = async () => {
        if (cache) return cache;
        const [index, activeId, platform] = await Promise.all([storage.get(INDEX_KEY), storage.get(ACTIVE_KEY), storage.get(PLATFORM_KEY)]);
        const records = (Array.isArray(index) ? index.filter(isRecord) : [])
            .map(record => ({ ...record, sources: sanitizeDeclaredSources(record.sources) }));
        cache = {
            records,
            activeId: records.some(record => record.id === activeId) ? activeId as string : records[0]?.id ?? null,
            platform: isLxPlatform(platform) ? platform : null,
        };
        return cache;
    };

    return {
        /** 清单、当前的脚本和当前的搜索平台（脚本不支持存着的那家时落到它支持的第一家）。 */
        async state() {
            const { records, activeId, platform } = await read();
            const active = records.find(record => record.id === activeId) ?? null;
            const supported = active ? LX_PLATFORMS.filter(key => active.sources[key]) : [];
            return {
                scripts: records,
                active,
                platform: platform && supported.includes(platform) ? platform : supported[0] ?? null,
                platforms: supported,
            };
        },
        async code(id: string): Promise<string | null> {
            const code = await storage.get(codeKey(id));
            return typeof code === 'string' ? code : null;
        },
        /** 存一个脚本并设为当前的。 */
        async add(record: LxScriptRecord, code: string) {
            const state = await read();
            if (state.records.length >= MAX_SCRIPTS) throw new LxImportError('too-many');
            await storage.set(codeKey(record.id), code);
            state.records = [...state.records, record];
            state.activeId = record.id;
            await storage.set(INDEX_KEY, state.records);
            await storage.set(ACTIVE_KEY, record.id);
        },
        async select(id: string): Promise<boolean> {
            const state = await read();
            if (!state.records.some(record => record.id === id)) return false;
            state.activeId = id;
            await storage.set(ACTIVE_KEY, id);
            return true;
        },
        async remove(id: string): Promise<boolean> {
            const state = await read();
            if (!state.records.some(record => record.id === id)) return false;
            state.records = state.records.filter(record => record.id !== id);
            if (state.activeId === id) state.activeId = state.records[0]?.id ?? null;
            await storage.set(INDEX_KEY, state.records);
            if (state.activeId) await storage.set(ACTIVE_KEY, state.activeId);
            else await storage.delete(ACTIVE_KEY);
            await storage.delete(codeKey(id));
            return true;
        },
        async setPlatform(platform: LxPlatform) {
            const state = await read();
            state.platform = platform;
            await storage.set(PLATFORM_KEY, platform);
        },
    };
};

export type ScriptLibrary = ReturnType<typeof createScriptLibrary>;
