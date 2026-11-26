import type { Full6Glyph } from '../../src/services/analysis/strokesWgsl/full6';
import type { NodeFs, NodePath } from './node';

// dev/strokes-wgsl/refData.ts
// The torch reference data (~/bihua tools/mnn/build/ref: index.json + ref.bin, arrays 64-byte aligned,
// written by mnn_ref.py) read by name in place, plus the two comparison helpers the checks use.

interface Entry { dtype: 'u8' | 'f32' | 'i32' | 'f16'; shape: number[]; offset: number }

export class RefData {
    private readonly index: Record<string, Entry>;
    private readonly fd: number;
    private readonly cache = new Map<string, ArrayBufferView>();

    constructor(dir: string, private readonly fs: NodeFs, path: NodePath) {
        this.index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')) as Record<string, Entry>;
        this.fd = fs.openSync(path.join(dir, 'ref.bin'), 'r');
    }

    shape(name: string): number[] {
        return this.entry(name).shape;
    }

    private entry(name: string): Entry {
        const entry = this.index[name] as Entry | undefined;
        if (!entry) throw new Error(`reference has no ${name}`);
        return entry;
    }

    private bytes(name: string, size: number): Uint8Array {
        const entry = this.entry(name);
        const count = entry.shape.reduce((a, b) => a * b, 1);
        const out = new Uint8Array(count * size);
        this.fs.readSync(this.fd, out, 0, out.length, entry.offset);
        return out;
    }

    private typed<T extends ArrayBufferView>(name: string, size: number, make: (b: ArrayBuffer) => T): T {
        let found = this.cache.get(name) as T | undefined;
        if (!found) this.cache.set(name, found = make(this.bytes(name, size).buffer as ArrayBuffer));
        return found;
    }

    f32(name: string): Float32Array { return this.typed(name, 4, b => new Float32Array(b)); }
    i32(name: string): Int32Array { return this.typed(name, 4, b => new Int32Array(b)); }
    u8(name: string): Uint8Array { return this.typed(name, 1, b => new Uint8Array(b)); }
    /** f16 arrays as their raw bits. */
    f16(name: string): Uint16Array { return this.typed(name, 2, b => new Uint16Array(b)); }
}

/** max |a - b| over the shorter length (NaN counts as infinite). */
export const maxAbsDiff = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
    let max = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i += 1) {
        const d = Math.abs(a[i] - b[i]);
        if (!(d <= max)) max = Number.isNaN(d) ? Infinity : d;
    }
    return max;
};

/** The q-quantile (nearest rank, as main.cpp's pct). */
export const percentile = (values: number[], q: number): number => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1) + 0.5))];
};

/** The reference's glyphs as runtime inputs. */
export const glyphsOf = (ref: RefData, count: number): Full6Glyph[] => {
    const img = ref.u8('img_u8');
    const q = ref.f32('ref_q');
    const m = ref.u8('ref_m');
    return Array.from({ length: count }, (_, i) => ({
        img: Float32Array.from(img.subarray(i * 3 * 65536, (i + 1) * 3 * 65536), v => Math.fround(v / 255)),
        refQ: q.subarray(i * 40 * 32, (i + 1) * 40 * 32),
        refM: m.subarray(i * 40, (i + 1) * 40),
    }));
};
