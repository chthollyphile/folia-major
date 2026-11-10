import { isBlob } from '../../../../utils/blobGuards';
import { putCacheEntry, readCacheEntriesByPrefix, removeCacheEntry } from '../../../../services/repositories/cacheRepository';
import type { LocalCollectionCoverOrigin } from './localCollectionCover';

// src/library/core/collection/cover/localCollectionCovers.service.ts
// 本地集合自定义封面的存储与运行时 URL：一个集合一条记录（键见 localCollectionCover 的 localCollectionCoverKey），
// 存的是设置那一刻的图片字节（缩过的 Blob），不是对歌曲或 poster 文件的引用——设好之后集合封面固定不变。
// 记录放在 IndexedDB 的通用缓存表里（键前缀 local_collection_cover_，与 Tempera 的图层图片同一种做法）：
// 这个前缀不属于任何缓存类别（与 lyricSeg_ 同理），「按类别清缓存」不会清掉它；清除全部缓存 / 全部数据时会，那本来就是整个重置。
// 运行时每条记录一个 object URL，替换或恢复默认时释放旧的；第一个订阅者到来时才读一遍存储。

export type LocalCollectionCoverRecord = {
    key: string;
    blob: Blob;
    origin: LocalCollectionCoverOrigin;
    updatedAt: number;
};

/** 记录怎么存（单测注入内存版）。写和删失败要抛出来：设置对话框据此告诉用户没存上。 */
export type LocalCollectionCoverPersistence = {
    readAll: () => Promise<LocalCollectionCoverRecord[]>;
    write: (record: LocalCollectionCoverRecord) => Promise<void>;
    remove: (key: string) => Promise<void>;
};

export type LocalCollectionCoverRegistry = {
    /** 键 → 封面 URL。内容变了才换新的 Map（可以直接当 useSyncExternalStore 的快照）。 */
    getSnapshot: () => ReadonlyMap<string, string>;
    /** 第一个订阅者到来时开始读存储。返回退订函数。 */
    subscribe: (listener: () => void) => () => void;
    /** 读一遍存储（只读一次；重复调用拿到同一个 Promise）。 */
    hydrate: () => Promise<void>;
    /** 存下这张图并换上；存失败时抛错，显示的不变。 */
    set: (key: string, blob: Blob, origin: LocalCollectionCoverOrigin) => Promise<void>;
    /** 恢复默认：删掉记录，回到自动封面。 */
    clear: (key: string) => Promise<void>;
};

export const LOCAL_COLLECTION_COVER_STORAGE_PREFIX = 'local_collection_cover_';

const isCoverRecord = (value: unknown): value is LocalCollectionCoverRecord => {
    if (!value || typeof value !== 'object') return false;
    const record = value as Partial<LocalCollectionCoverRecord>;
    return typeof record.key === 'string' && isBlob(record.blob) && record.blob.size > 0;
};

/** 应用里的存储：通用缓存表（Dexie），键是前缀 + 集合键。 */
export const cacheTableLocalCollectionCoverPersistence: LocalCollectionCoverPersistence = {
    readAll: async () => {
        const entries = await readCacheEntriesByPrefix<unknown>(LOCAL_COLLECTION_COVER_STORAGE_PREFIX);
        return entries.flatMap(entry => (isCoverRecord(entry.data) ? [entry.data] : []));
    },
    write: record => putCacheEntry(`${LOCAL_COLLECTION_COVER_STORAGE_PREFIX}${record.key}`, record),
    remove: key => removeCacheEntry(`${LOCAL_COLLECTION_COVER_STORAGE_PREFIX}${key}`),
};

export const createLocalCollectionCoverRegistry = ({
    persistence,
    createUrl,
    revokeUrl,
    now = Date.now,
}: {
    persistence: LocalCollectionCoverPersistence;
    createUrl: (blob: Blob) => string;
    revokeUrl: (url: string) => void;
    now?: () => number;
}): LocalCollectionCoverRegistry => {
    let urls: ReadonlyMap<string, string> = new Map();
    const listeners = new Set<() => void>();
    // 这次运行里设过或清过的键：读存储晚于它们回来时，不拿旧记录盖掉。
    const touched = new Set<string>();
    let hydration: Promise<void> | null = null;

    const commit = (next: Map<string, string>) => {
        urls = next;
        listeners.forEach(listener => listener());
    };

    const hydrate = () => {
        if (!hydration) {
            hydration = persistence.readAll()
                .then(records => {
                    const next = new Map(urls);
                    let loaded = 0;
                    records.forEach(record => {
                        if (touched.has(record.key) || next.has(record.key)) return;
                        next.set(record.key, createUrl(record.blob));
                        loaded += 1;
                    });
                    if (loaded > 0) commit(next);
                    console.info(`[LocalCollectionCover] Loaded ${loaded} custom collection cover(s).`);
                })
                .catch(error => {
                    console.warn('[LocalCollectionCover] Failed to read custom collection covers:', error);
                });
        }
        return hydration;
    };

    return {
        getSnapshot: () => urls,
        subscribe: listener => {
            listeners.add(listener);
            void hydrate();
            return () => {
                listeners.delete(listener);
            };
        },
        hydrate,
        set: async (key, blob, origin) => {
            await persistence.write({ key, blob, origin, updatedAt: now() });
            touched.add(key);
            const next = new Map(urls);
            const previous = next.get(key);
            next.set(key, createUrl(blob));
            commit(next);
            if (previous) revokeUrl(previous);
            console.info(`[LocalCollectionCover] Set the cover of ${key} from ${origin} (${blob.type}, ${blob.size} bytes).`);
        },
        clear: async key => {
            await persistence.remove(key);
            touched.add(key);
            const previous = urls.get(key);
            if (previous) {
                const next = new Map(urls);
                next.delete(key);
                commit(next);
                revokeUrl(previous);
            }
            console.info(`[LocalCollectionCover] Removed the custom cover of ${key}.`);
        },
    };
};

/** 应用里唯一的一份。 */
export const localCollectionCovers = createLocalCollectionCoverRegistry({
    persistence: cacheTableLocalCollectionCoverPersistence,
    createUrl: blob => URL.createObjectURL(blob),
    revokeUrl: url => URL.revokeObjectURL(url),
});
