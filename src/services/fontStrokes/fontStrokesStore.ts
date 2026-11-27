import Dexie, { type Table } from 'dexie';
import { decodeFontStrokesGlyph, encodeFontStrokesGlyph } from './fontStrokesCodec';
import type { FontStrokesGlyph } from './fontStrokesOutline';

// src/services/fontStrokes/fontStrokesStore.ts
// 笔画结果的盘上存储：独立的 Dexie 库 folia-font-strokes（不动主库 schema）。
//   fonts  ：主键 = 字体键，值 { key, label, count, bytes, lastUsed }
//   glyphs ：主键 [fontKey, ch]，值 { fontKey, ch, data（fontStrokesCodec 的二进制）, lastUsed }，fontKey、lastUsed 建索引
// 总量超过上限时按 lastUsed 从旧到新淘汰；读到的字顺手刷新 lastUsed（一小时内不重复写）。
// IndexedDB 不可用（打不开、被禁用）时所有方法静默退化：读返回空、写丢掉，调用方只在内存里工作。

export const FONT_STROKES_DB_NAME = 'folia-font-strokes';
/** 总量上限（字节，按 data 长度加一点行开销估算）。 */
export const FONT_STROKES_MAX_BYTES = 50 * 1024 * 1024;
/** 每行的固定开销估算（键、索引、lastUsed）。 */
const ROW_OVERHEAD = 64;
/** lastUsed 一小时内不重复写。 */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;
/** 淘汰到上限的这个比例再停，避免每写一批就淘汰一次。 */
const EVICT_TARGET = 0.9;

const clearedListeners = new Set<() => void>();
/** 订阅「全部清除」（缓存管理和命令面板都从盘这一层清，内存工作集靠这个跟着清）。返回取消。 */
export const onFontStrokesCleared = (listener: () => void): (() => void) => {
    clearedListeners.add(listener);
    return () => { clearedListeners.delete(listener); };
};

let shared: FontStrokesStore | null = null;
/** 进程内共用的那一份存储（第一次用到才建；不碰 IndexedDB 直到真的读写）。 */
export const getFontStrokesStore = (): FontStrokesStore => (shared ??= new FontStrokesStore());

export interface StoredFont { key: string; label: string; count: number; bytes: number; lastUsed: number }
interface StoredGlyph { fontKey: string; ch: string; data: Uint8Array; lastUsed: number }

/** 缓存管理的占用：总字节、字数、各字体的明细。 */
export interface FontStrokesUsage { bytes: number; glyphs: number; fonts: StoredFont[] }

class FontStrokesDatabase extends Dexie {
    fonts!: Table<StoredFont, string>;
    glyphs!: Table<StoredGlyph, [string, string]>;

    constructor(name: string, options?: ConstructorParameters<typeof Dexie>[1]) {
        super(name, options);
        this.version(1).stores({
            fonts: 'key, lastUsed',
            glyphs: '[fontKey+ch], fontKey, lastUsed',
        });
    }
}

const rowBytes = (g: StoredGlyph) => g.data.byteLength + ROW_OVERHEAD + g.ch.length * 2;

export interface FontStrokesStoreOptions {
    name?: string;
    maxBytes?: number;
    /** 测试里换成可控的时钟。 */
    now?: () => number;
    dexie?: ConstructorParameters<typeof Dexie>[1];
}

export class FontStrokesStore {
    private db: FontStrokesDatabase | null;
    private readonly maxBytes: number;
    private readonly now: () => number;
    /** 打不开时置位，之后所有调用直接退化。 */
    private broken = false;
    /** 写入串行：一次写 + 淘汰是一个事务单元，并发写会互相读到旧的字节数。 */
    private writeChain: Promise<unknown> = Promise.resolve();

    constructor(options: FontStrokesStoreOptions = {}) {
        this.maxBytes = options.maxBytes ?? FONT_STROKES_MAX_BYTES;
        this.now = options.now ?? Date.now;
        try {
            this.db = typeof indexedDB === 'undefined' && !options.dexie ? null : new FontStrokesDatabase(options.name ?? FONT_STROKES_DB_NAME, options.dexie);
        } catch {
            this.db = null;
        }
        if (!this.db) this.broken = true;
    }

    /** 盘能用吗（用过一次失败后就是 false）。 */
    get available(): boolean { return !this.broken; }

    private fail(error: unknown): void {
        if (!this.broken) console.warn('[FontStrokes] store unavailable, working in memory only:', error);
        this.broken = true;
    }

    /** 批量读一个字体的若干字；没存过、数据坏了的字不在结果里。读到的字刷新 lastUsed。 */
    async getGlyphs(fontKey: string, chars: string[]): Promise<Map<string, FontStrokesGlyph>> {
        const out = new Map<string, FontStrokesGlyph>();
        if (this.broken || !this.db || !chars.length) return out;
        try {
            const rows = await this.db.glyphs.bulkGet(chars.map(ch => [fontKey, ch] as [string, string]));
            const now = this.now();
            const stale: StoredGlyph[] = [];
            const bad: [string, string][] = [];
            rows.forEach((row, i) => {
                if (!row) return;
                const glyph = decodeFontStrokesGlyph(row.data);
                if (glyph) {
                    out.set(chars[i], glyph);
                    if (now - row.lastUsed > TOUCH_INTERVAL_MS) stale.push({ ...row, lastUsed: now });
                } else bad.push([fontKey, chars[i]]);
            });
            if (stale.length || bad.length) {
                void this.enqueue(async db => {
                    if (stale.length) await db.glyphs.bulkPut(stale);
                    if (bad.length) await this.deleteRows(db, fontKey, bad);
                    await this.touchFont(db, fontKey);
                });
            }
        } catch (error) {
            this.fail(error);
        }
        return out;
    }

    /** 批量写一个字体的若干字，写完检查总量并淘汰最久没用的。 */
    putGlyphs(fontKey: string, label: string, glyphs: Map<string, FontStrokesGlyph>): Promise<void> {
        if (this.broken || !this.db || !glyphs.size) return Promise.resolve();
        return this.enqueue(async db => {
            const now = this.now();
            const rows: StoredGlyph[] = [...glyphs].map(([ch, g]) => ({ fontKey, ch, data: encodeFontStrokesGlyph(g), lastUsed: now }));
            await db.transaction('rw', db.fonts, db.glyphs, async () => {
                const old = await db.glyphs.bulkGet(rows.map(r => [r.fontKey, r.ch] as [string, string]));
                let countDelta = 0, byteDelta = 0;
                rows.forEach((r, i) => {
                    const prev = old[i];
                    byteDelta += rowBytes(r) - (prev ? rowBytes(prev) : 0);
                    if (!prev) countDelta += 1;
                });
                await db.glyphs.bulkPut(rows);
                const font = await db.fonts.get(fontKey);
                await db.fonts.put({ key: fontKey, label, count: (font?.count ?? 0) + countDelta, bytes: (font?.bytes ?? 0) + byteDelta, lastUsed: now });
            });
            await this.evict(db);
        });
    }

    /** 清掉一个字体的全部结果。 */
    clearFont(fontKey: string): Promise<void> {
        if (this.broken || !this.db) return Promise.resolve();
        return this.enqueue(async db => {
            await db.transaction('rw', db.fonts, db.glyphs, async () => {
                await db.glyphs.where('fontKey').equals(fontKey).delete();
                await db.fonts.delete(fontKey);
            });
        });
    }

    /** 清掉全部，清完通知 onFontStrokesCleared 的订阅者（内存工作集、预备服务据此重来）。 */
    async clearAll(): Promise<void> {
        if (!this.broken && this.db) {
            await this.enqueue(async db => {
                await db.transaction('rw', db.fonts, db.glyphs, async () => {
                    await db.glyphs.clear();
                    await db.fonts.clear();
                });
            });
        }
        for (const listener of [...clearedListeners]) listener();
    }

    /** 占用：总字节、字数和各字体的明细（缓存管理「分析」类别用）。 */
    async usage(): Promise<FontStrokesUsage> {
        if (this.broken || !this.db) return { bytes: 0, glyphs: 0, fonts: [] };
        try {
            const fonts = await this.db.fonts.toArray();
            return { bytes: fonts.reduce((s, f) => s + f.bytes, 0), glyphs: fonts.reduce((s, f) => s + f.count, 0), fonts };
        } catch (error) {
            this.fail(error);
            return { bytes: 0, glyphs: 0, fonts: [] };
        }
    }

    /** 关掉库（测试收尾用）。 */
    close(): void { this.db?.close(); }

    /** 写操作排队执行；失败只退化，不抛给调用方。 */
    private enqueue(task: (db: FontStrokesDatabase) => Promise<void>): Promise<void> {
        const run = this.writeChain.then(async () => {
            if (this.broken || !this.db) return;
            try { await task(this.db); } catch (error) { this.fail(error); }
        });
        this.writeChain = run;
        return run;
    }

    private async touchFont(db: FontStrokesDatabase, fontKey: string): Promise<void> {
        await db.fonts.update(fontKey, { lastUsed: this.now() });
    }

    /** 删一批字并把字体行的字数、字节数减掉；字体没有字了就删字体行。 */
    private async deleteRows(db: FontStrokesDatabase, fontKey: string, keys: [string, string][]): Promise<void> {
        await db.transaction('rw', db.fonts, db.glyphs, async () => {
            const rows = (await db.glyphs.bulkGet(keys)).filter((r): r is StoredGlyph => !!r);
            if (!rows.length) return;
            await db.glyphs.bulkDelete(rows.map(r => [r.fontKey, r.ch] as [string, string]));
            const font = await db.fonts.get(fontKey);
            if (!font) return;
            const count = font.count - rows.length;
            if (count <= 0) await db.fonts.delete(fontKey);
            else await db.fonts.put({ ...font, count, bytes: Math.max(0, font.bytes - rows.reduce((s, r) => s + rowBytes(r), 0)) });
        });
    }

    /** 总量超过上限时，按 lastUsed 从旧到新删，直到降到上限的 EVICT_TARGET。 */
    private async evict(db: FontStrokesDatabase): Promise<void> {
        let total = (await db.fonts.toArray()).reduce((s, f) => s + f.bytes, 0);
        if (total <= this.maxBytes) return;
        const target = this.maxBytes * EVICT_TARGET;
        const victims = new Map<string, [string, string][]>();
        await db.glyphs.orderBy('lastUsed').until(() => total <= target).each(row => {
            total -= rowBytes(row);
            const list = victims.get(row.fontKey) ?? [];
            list.push([row.fontKey, row.ch]);
            victims.set(row.fontKey, list);
        });
        for (const [fontKey, keys] of victims) await this.deleteRows(db, fontKey, keys);
    }
}
