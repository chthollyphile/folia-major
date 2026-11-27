import type { FontStrokesGlyph } from './fontStrokesOutline';

// src/services/fontStrokes/fontStrokesMemory.ts
// 内存工作集：当前歌和后两首要用的字。样式画字时同步 get(fontKey, ch)，不碰盘、不碰推理；
// 预备服务每批结果到了就 setMany 并通知订阅者。超过上限时丢最久没读的（盘上还有，需要时预备服务会再读回来）。
// 「画不出墨 / 模型没给结果」的字也记一条空结果，免得每帧每轮都重新去算。

/** 内存里最多留多少个字（每个解码后几 KB）。 */
export const FONT_STROKES_MEMORY_MAX = 4000;

interface Entry { glyph: FontStrokesGlyph | null; used: number }

export class FontStrokesMemory {
    private readonly fonts = new Map<string, Map<string, Entry>>();
    private readonly listeners = new Set<(fontKey: string) => void>();
    private size = 0;
    private tick = 0;

    constructor(private readonly max = FONT_STROKES_MEMORY_MAX) {}

    /** 同步取一个字的笔画；还没算好或算不出来时 null。 */
    get(fontKey: string, ch: string): FontStrokesGlyph | null {
        const entry = this.fonts.get(fontKey)?.get(ch);
        if (!entry) return null;
        entry.used = ++this.tick;
        return entry.glyph;
    }

    /** 这个字有没有结果（包括「算过，没有」）。 */
    has(fontKey: string, ch: string): boolean {
        return this.fonts.get(fontKey)?.has(ch) ?? false;
    }

    /** 一批结果（null = 算过没有），写完通知一次；超出上限时丢最久没读的。 */
    setMany(fontKey: string, entries: Iterable<[string, FontStrokesGlyph | null]>): void {
        let map = this.fonts.get(fontKey);
        if (!map) { map = new Map(); this.fonts.set(fontKey, map); }
        let added = 0;
        for (const [ch, glyph] of entries) {
            if (!map.has(ch)) added += 1;
            map.set(ch, { glyph, used: ++this.tick });
        }
        this.size += added;
        this.trim();
        for (const listener of [...this.listeners]) listener(fontKey);
    }

    /** 订阅新结果（参数是哪个字体来了新字）。返回取消。 */
    subscribe(listener: (fontKey: string) => void): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    clearFont(fontKey: string): void {
        this.size -= this.fonts.get(fontKey)?.size ?? 0;
        this.fonts.delete(fontKey);
    }

    clearAll(): void {
        this.fonts.clear();
        this.size = 0;
    }

    private trim(): void {
        if (this.size <= this.max) return;
        const all: { fontKey: string; ch: string; used: number }[] = [];
        for (const [fontKey, map] of this.fonts) for (const [ch, e] of map) all.push({ fontKey, ch, used: e.used });
        all.sort((a, b) => a.used - b.used);
        for (const { fontKey, ch } of all.slice(0, this.size - Math.floor(this.max * 0.9))) {
            this.fonts.get(fontKey)?.delete(ch);
            this.size -= 1;
        }
    }
}
