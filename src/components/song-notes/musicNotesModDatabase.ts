// src/components/song-notes/musicNotesModDatabase.ts
// 只读地看一眼 setobox 的「音乐笔记」模组（folium-compound#177）的库 FoliaMusicNotes（同源）：有几首歌，读出全部记录和标签的先后。
// 本体从不写它。不带版本号打开（不触发模组的升级）；库不在时不为了看一眼去建一个空库：先问 indexedDB.databases()，
// 万一还是走到了新建（onupgradeneeded），当场撤掉。模组要升级它的库时（versionchange）立刻让开。
// 这里不引别的模块：「时刻」页的提示也用它，不把导入导出那一串拖进速记簿。

export const MUSIC_NOTES_MOD_DATABASE = 'FoliaMusicNotes';

const exists = async (): Promise<boolean> => {
    try {
        if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return false;
        return (await indexedDB.databases()).some(info => info.name === MUSIC_NOTES_MOD_DATABASE);
    } catch {
        return false;
    }
};

/** 打开模组的库，在一个只读事务里读；库不在、打不开、没有 notes 表、读出错都回 null。 */
const readOnce = async <T>(read: (transaction: IDBTransaction, hasMetadata: boolean) => () => T): Promise<T | null> => {
    if (!(await exists())) return null;
    return new Promise((resolve) => {
        let request: IDBOpenDBRequest;
        try {
            request = indexedDB.open(MUSIC_NOTES_MOD_DATABASE);
        } catch {
            resolve(null);
            return;
        }
        request.onupgradeneeded = () => request.transaction?.abort();
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
        request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => db.close();
            const done = (value: T | null) => {
                db.close();
                resolve(value);
            };
            if (!db.objectStoreNames.contains('notes')) {
                done(null);
                return;
            }
            const hasMetadata = db.objectStoreNames.contains('metadata');
            try {
                const transaction = db.transaction(hasMetadata ? ['notes', 'metadata'] : ['notes'], 'readonly');
                const result = read(transaction, hasMetadata);
                transaction.oncomplete = () => done(result());
                transaction.onerror = () => done(null);
                transaction.onabort = () => done(null);
            } catch {
                done(null);
            }
        };
    });
};

/** 模组的库里有几首歌的笔记（0：没有库，或者是空的）。 */
export const countMusicNotesModSongs = async (): Promise<number> => (
    await readOnce((transaction) => {
        const request = transaction.objectStore('notes').count();
        return () => request.result;
    })
) ?? 0;

/** 模组的全部记录，和排序行（metadata 表 key 为 order）里的 tagOrder（一串标签 key；没有或不成样子是 null）。 */
export const readMusicNotesModRecords = (): Promise<{ records: unknown[]; tagOrder: string[] | null } | null> => readOnce((transaction, hasMetadata) => {
    const records = transaction.objectStore('notes').getAll();
    const order = hasMetadata ? transaction.objectStore('metadata').get('order') : null;
    return () => {
        const row: unknown = order?.result;
        const tagOrder = row && typeof row === 'object' && Array.isArray((row as { tagOrder?: unknown }).tagOrder)
            && ((row as { tagOrder: unknown[] }).tagOrder).every(key => typeof key === 'string')
            ? (row as { tagOrder: string[] }).tagOrder
            : null;
        return { records: Array.isArray(records.result) ? records.result as unknown[] : [], tagOrder };
    };
});
