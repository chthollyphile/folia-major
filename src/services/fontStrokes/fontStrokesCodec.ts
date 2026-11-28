import type { FontStrokesGlyph } from './fontStrokesOutline';

// src/services/fontStrokes/fontStrokesCodec.ts
// 一个字的存盘记录 ↔ 二进制。坐标都是 em × EM_UNITS 的 Int16：每条折线存首点和后面各点的差，差用 zigzag + varint
// （相邻点差通常 < 64 个单位，一个字节）。格式变了要同时加 FONT_STROKES_FORMAT（fontStrokesKey.ts），旧数据不再命中。
//
// 布局：[笔数 varint] 然后每笔 [中线点数 varint, 点…] [环数 varint, (环点数 varint, 点…)…] [笔刷 u8]。

/** 一个字最多多少笔（Int8 归属图的上限）；解码时超出视为坏数据。 */
const MAX_STROKES = 127;
/** 折线最多多少个点；解码时超出视为坏数据。 */
const MAX_POINTS = 1 << 16;

class Writer {
    private buf = new Uint8Array(1024);
    private len = 0;

    private ensure(extra: number) {
        if (this.len + extra <= this.buf.length) return;
        const next = new Uint8Array(Math.max(this.buf.length * 2, this.len + extra));
        next.set(this.buf.subarray(0, this.len));
        this.buf = next;
    }

    byte(v: number) { this.ensure(1); this.buf[this.len++] = v; }

    varint(v: number) {
        let n = v >>> 0;
        while (n >= 0x80) { this.byte((n & 0x7f) | 0x80); n >>>= 7; }
        this.byte(n);
    }

    zigzag(v: number) { this.varint(((v << 1) ^ (v >> 31)) >>> 0); }

    /** flat [x, y] 折线：点数 + 首点 + 各点和前一点的差。 */
    poly(p: Int16Array) {
        const n = p.length >> 1;
        this.varint(n);
        let px = 0, py = 0;
        for (let i = 0; i < n; i += 1) {
            this.zigzag(p[2 * i] - px);
            this.zigzag(p[2 * i + 1] - py);
            px = p[2 * i];
            py = p[2 * i + 1];
        }
    }

    finish(): Uint8Array<ArrayBuffer> { return this.buf.slice(0, this.len); }
}

class Reader {
    private at = 0;
    constructor(private readonly buf: Uint8Array) {}

    get done() { return this.at >= this.buf.length; }

    byte(): number {
        if (this.at >= this.buf.length) throw new Error('eof');
        return this.buf[this.at++];
    }

    varint(): number {
        let v = 0, shift = 0;
        for (;;) {
            const b = this.byte();
            v += (b & 0x7f) * 2 ** shift;
            if (!(b & 0x80)) return v;
            shift += 7;
            if (shift > 28) throw new Error('varint');
        }
    }

    zigzag(): number {
        const v = this.varint();
        return (v >>> 1) ^ -(v & 1);
    }

    poly(): Int16Array {
        const n = this.varint();
        if (n > MAX_POINTS) throw new Error('points');
        const p = new Int16Array(n * 2);
        let px = 0, py = 0;
        for (let i = 0; i < n; i += 1) {
            px += this.zigzag();
            py += this.zigzag();
            p[2 * i] = px;
            p[2 * i + 1] = py;
        }
        return p;
    }
}

/** 记录 → 二进制。 */
export const encodeFontStrokesGlyph = (g: FontStrokesGlyph): Uint8Array<ArrayBuffer> => {
    const w = new Writer();
    w.varint(g.pens.length);
    for (let k = 0; k < g.pens.length; k += 1) {
        w.poly(g.pens[k]);
        w.varint(g.outlines[k].length);
        for (const ring of g.outlines[k]) w.poly(ring);
        w.byte(g.brush[k]);
    }
    return w.finish();
};

/** 二进制 → 记录；数据坏了（截断、数值超界、多余字节）时 null，调用方当没存过处理。 */
export const decodeFontStrokesGlyph = (bytes: Uint8Array): FontStrokesGlyph | null => {
    try {
        const r = new Reader(bytes);
        const n = r.varint();
        if (n > MAX_STROKES) return null;
        const pens: Int16Array[] = [], outlines: Int16Array[][] = [];
        const brush = new Uint8Array(n);
        for (let k = 0; k < n; k += 1) {
            pens.push(r.poly());
            const rings = r.varint();
            if (rings > MAX_POINTS) return null;
            const list: Int16Array[] = [];
            for (let i = 0; i < rings; i += 1) list.push(r.poly());
            outlines.push(list);
            brush[k] = r.byte();
        }
        return r.done ? { pens, outlines, brush } : null;
    } catch {
        return null;
    }
};
