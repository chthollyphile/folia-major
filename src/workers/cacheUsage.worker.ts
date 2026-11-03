/**
 * Cache Usage Web Worker
 *
 * Counts how much of the cache each category holds, the same count
 * getBrowserCacheUsageByCategory makes on the page (src/services/repositories/cacheRepository.ts), so that reading every row back
 * and measuring it does not hold the page.
 *
 * Message API:
 * Request: { databaseName: string, tableNames: string[] }
 * Response: { usage: CacheUsage } | { error: string }
 */

import { countCacheEntry, emptyCacheUsage, type CacheUsage } from '../services/repositories/cacheUsage';

// Opened without a version: the page's connection owns the schema, and an open while the page is
// upgrading waits for the upgrade to finish. A database that is not there is not created from here
// (the upgrade is cancelled): null.
const openExisting = (name: string) => new Promise<IDBDatabase | null>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onupgradeneeded = () => request.transaction?.abort();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => (request.error?.name === 'AbortError' ? resolve(null) : reject(request.error));
});

// One row at a time, so the rows are not all held at once. One transaction per table, so a write the
// page makes to a small table does not wait for the count of the big one.
const countStore = (db: IDBDatabase, name: string, usage: CacheUsage) => new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(name, 'readonly');
    const request = transaction.objectStore(name).openCursor();
    request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        countCacheEntry(usage, cursor.value);
        cursor.continue();
    };
    transaction.oncomplete = () => resolve();
    // A failed request aborts the transaction; `error` is set by then, not yet at the request's error.
    transaction.onabort = () => reject(transaction.error ?? new Error(`counting ${name} was aborted`));
});

/** The usage, or null when there is no such database (the page then counts it itself). */
export const countCacheUsageIn = async (databaseName: string, tableNames: readonly string[]): Promise<CacheUsage | null> => {
    const db = await openExisting(databaseName);
    if (!db) return null;
    // A newer schema opened by the page must not wait on this connection longer than the count.
    db.onversionchange = () => db.close();
    const usage = emptyCacheUsage();
    try {
        // Every transaction is made before the first await, so a close from onversionchange cannot
        // land between them.
        await Promise.all(tableNames.filter(name => db.objectStoreNames.contains(name)).map(name => countStore(db, name, usage)));
    } finally {
        db.close();
    }
    return usage;
};

if (typeof self !== 'undefined') {
    self.onmessage = async (event: MessageEvent<{ databaseName: string; tableNames: string[] }>) => {
        try {
            const usage = await countCacheUsageIn(event.data.databaseName, event.data.tableNames);
            self.postMessage(usage ? { usage } : { error: `no database ${event.data.databaseName} seen from the worker` });
        } catch (error) {
            self.postMessage({ error: String(error) });
        }
    };
}
