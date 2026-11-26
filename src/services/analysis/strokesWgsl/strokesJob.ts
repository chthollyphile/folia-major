/// <reference types="@webgpu/types" />
import type { SlicePacing } from '../gpuSlices';
import { Full6Wgsl } from './full6';
import { joinSegments, polylineLength } from './hostMath';
import { Own2Wgsl } from './own2';

// src/services/analysis/strokesWgsl/strokesJob.ts
// 雾笺's font strokes in the GPU worker: full6 then own2 on the same batch, per glyph the joined pens and
// where along the whole writing each ink pixel is reached, by arc length alone (the picture puts its own
// pace and pauses on top). The worker (workers/beatThisGpu.worker.ts) holds one of these on its device.

/** Glyphs a batch: full6's capacity and the taps own2 reads (~1.5 MB a glyph in f16). */
export const STROKES_BATCH = 8;
/** The model grid: glyph features and owner maps are 256 x 256 (HANDOFF_FOLIA.md §2). */
export const STROKES_SIDE = 256;
/** In `along`: off the ink. */
export const STROKES_OFF_INK = 65535;

export interface StrokesGlyphResult {
    /** Pens in writing order, flat [n, 2] each, canvas coordinates (-1..1, y down). */
    pens: Float32Array[];
    /**
     * Per pixel of the 256 x 256 grid: the arc length the writing has covered when it reaches this ink pixel,
     * over the whole glyph's, as 0..65534; STROKES_OFF_INK off the ink.
     */
    along: Uint16Array;
}

export class StrokesJob {
    private constructor(private readonly full6: Full6Wgsl, private readonly own2: Own2Wgsl) {}

    get bytes(): number {
        return this.full6.bytes + this.own2.bytes;
    }

    static async create(device: GPUDevice, full6File: Uint8Array, own2File: Uint8Array, f16: boolean): Promise<StrokesJob> {
        const full6 = await Full6Wgsl.create(device, full6File, { f16, capacity: STROKES_BATCH, taps: true });
        try {
            return new StrokesJob(full6, await Own2Wgsl.create(device, own2File, full6, { f16 }));
        } catch (error) {
            full6.destroy();
            throw error;
        }
    }

    destroy() {
        this.own2.destroy();
        this.full6.destroy();
    }

    /** Up to STROKES_BATCH glyphs' features ([3, 256, 256] each) -> their pens and arc-length maps. */
    async run(imgs: Float32Array[], pacing: SlicePacing): Promise<StrokesGlyphResult[]> {
        if (imgs.length > STROKES_BATCH) throw new Error(`strokes: ${imgs.length} glyphs, at most ${STROKES_BATCH} a run`);
        const generated = await this.full6.generate(imgs.map(img => ({ img })), { useReference: false, pacing });
        const pens = generated.map(r => joinSegments(r.segs, r.cont));
        // A glyph full6 wrote nothing for gets no own2 slot of its own: it is still passed (slot i = glyph i), with one dot pen.
        const owned = await this.own2.run(pens.map(p => ({ pens: p.length ? p : [new Float32Array([0, 0, 0, 0])] })), { pacing });
        return pens.map((p, i) => ({ pens: p, along: alongOf(p, owned[i].pen, owned[i].along) }));
    }
}

/** Per ink pixel: (pens before its owner + its position on the owner) / all the pens, by arc length. */
const alongOf = (pens: Float32Array[], pen: Int16Array, along: Float32Array): Uint16Array => {
    const out = new Uint16Array(pen.length).fill(STROKES_OFF_INK);
    if (!pens.length) return out;
    const lengths = pens.map(polylineLength);
    const before: number[] = [];
    let total = 0;
    for (const l of lengths) { before.push(total); total += l; }
    if (total <= 0) return out;
    for (let p = 0; p < pen.length; p += 1) {
        const k = pen[p];
        if (k < 0 || k >= pens.length) continue;
        out[p] = Math.round(Math.min(1, (before[k] + along[p] * lengths[k]) / total) * 65534);
    }
    return out;
};
