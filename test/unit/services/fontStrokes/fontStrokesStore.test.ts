import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { FontStrokesStore } from '../../../../src/services/fontStrokes/fontStrokesStore';
import type { FontStrokesGlyph } from '../../../../src/services/fontStrokes/fontStrokesOutline';

// test/unit/services/fontStrokes/fontStrokesStore.test.ts
// 存储：批量读写往返、占用统计、按 lastUsed 淘汰、按字体 / 全部清除、IndexedDB 打不开时的静默退化（fake-indexeddb）。

let seq = 0;
const stores: FontStrokesStore[] = [];
const make = (options: ConstructorParameters<typeof FontStrokesStore>[0] = {}) => {
    const s = new FontStrokesStore({ name: `test-font-strokes-${seq++}`, ...options });
    stores.push(s);
    return s;
};
afterEach(() => { while (stores.length) stores.pop()!.close(); });

/** 一个大约 bytes 字节的字：中线点数决定大小。 */
const glyph = (seed: number, points = 50): FontStrokesGlyph => {
    const pen = new Int16Array(points * 2);
    for (let i = 0; i < points; i += 1) { pen[2 * i] = seed * 100 + i * 13; pen[2 * i + 1] = (i * 997 + seed) % 3000; }
    return { pens: [pen], outlines: [[]], brush: new Uint8Array([seed % 255]) };
};

describe('FontStrokesStore', () => {
    it('批量写读往返，没存的字不在结果里', async () => {
        const store = make();
        await store.putGlyphs('f1', '字体一', new Map([['永', glyph(1)], ['鬱', glyph(2)]]));
        const got = await store.getGlyphs('f1', ['永', '鬱', '十']);
        expect([...got.keys()].sort()).toEqual(['永', '鬱']);
        expect(got.get('永')!.pens[0]).toEqual(glyph(1).pens[0]);
        expect((await store.getGlyphs('other', ['永'])).size).toBe(0);
    });

    it('占用按字体统计，重复写同一个字不重复计数', async () => {
        const store = make();
        await store.putGlyphs('f1', 'a', new Map([['永', glyph(1)]]));
        await store.putGlyphs('f1', 'a', new Map([['永', glyph(1)], ['十', glyph(3)]]));
        await store.putGlyphs('f2', 'b', new Map([['口', glyph(4)]]));
        const usage = await store.usage();
        expect(usage.glyphs).toBe(3);
        expect(usage.fonts.map(f => [f.key, f.count]).sort()).toEqual([['f1', 2], ['f2', 1]]);
        expect(usage.bytes).toBeGreaterThan(0);
    });

    it('超过上限时按 lastUsed 淘汰最旧的，最新写的留着', async () => {
        let t = 1000;
        const store = make({ maxBytes: 3000, now: () => t });
        const chars = Array.from('一二三四五六七八九十');
        for (const ch of chars) {
            t += 10;
            await store.putGlyphs('f1', 'a', new Map([[ch, glyph(ch.charCodeAt(0) % 200, 100)]]));
        }
        const usage = await store.usage();
        expect(usage.bytes).toBeLessThanOrEqual(3000);
        const left = await store.getGlyphs('f1', chars);
        expect(left.has('十')).toBe(true);
        expect(left.has('一')).toBe(false);
        expect(usage.glyphs).toBe(left.size);
    });

    it('读到的字刷新 lastUsed，淘汰时留下', async () => {
        const hour = 3600 * 1000;
        let t = 0;
        const store = make({ maxBytes: 900, now: () => t });
        await store.putGlyphs('f1', 'a', new Map([['甲', glyph(1, 100)]]));
        t += 5 * hour;
        await store.putGlyphs('f1', 'a', new Map([['乙', glyph(2, 100)]]));
        t += 5 * hour;
        expect((await store.getGlyphs('f1', ['甲'])).has('甲')).toBe(true);
        await store.usage();
        t += 5 * hour;
        await store.putGlyphs('f1', 'a', new Map([['丙', glyph(3, 100)]]));
        const left = await store.getGlyphs('f1', ['甲', '乙', '丙']);
        expect(left.has('乙')).toBe(false);
        expect(left.has('甲')).toBe(true);
        expect(left.has('丙')).toBe(true);
    });

    it('按字体清除、全部清除', async () => {
        const store = make();
        await store.putGlyphs('f1', 'a', new Map([['永', glyph(1)]]));
        await store.putGlyphs('f2', 'b', new Map([['永', glyph(2)]]));
        await store.clearFont('f1');
        expect((await store.getGlyphs('f1', ['永'])).size).toBe(0);
        expect((await store.getGlyphs('f2', ['永'])).size).toBe(1);
        expect((await store.usage()).fonts.map(f => f.key)).toEqual(['f2']);
        await store.clearAll();
        expect(await store.usage()).toEqual({ bytes: 0, glyphs: 0, fonts: [] });
    });

    it('IndexedDB 不可用时静默退化：读空、写丢、不抛', async () => {
        const store = make({ dexie: { indexedDB: undefined, IDBKeyRange: undefined } });
        await expect(store.putGlyphs('f1', 'a', new Map([['永', glyph(1)]]))).resolves.toBeUndefined();
        expect((await store.getGlyphs('f1', ['永'])).size).toBe(0);
        expect(await store.usage()).toEqual({ bytes: 0, glyphs: 0, fonts: [] });
        await expect(store.clearAll()).resolves.toBeUndefined();
        expect(store.available).toBe(false);
    });
});
