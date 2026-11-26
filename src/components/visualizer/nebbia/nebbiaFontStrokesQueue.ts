import { runStrokesGpu, STROKES_GPU_BATCH } from '../../../services/analysis/beatThisGpu';
import { buildGlyph, glyphFeatures, isModelChar, renderCanon } from './nebbiaFontStrokes';
import type { Glyph } from './nebbiaGlyphs';

// src/components/visualizer/nebbia/nebbiaFontStrokesQueue.ts
// 雾笺字体笔画的缓存和推理队列（光栅、特征、字块在 nebbiaFontStrokes.ts）：一个实例跨运行时共用。
// 每个运行时 attach 一份「要哪些字」（按歌词顺序，标出马上要写的几句）；队列把所有运行时的需求合起来，
// 马上要写的字用 onScreen 紧迫度、其余用 background，一批 STROKES_GPU_BATCH 个地算，每批到了通知一次。
// 需求整份替换：换歌、换字体、拖进度时运行时重新报一份，旧的没算的字就自然丢掉；没有运行时 attach 时不再算。
// 字体还没加载好时不画（canvas 会用回退字体画，还按自定义字体的名字存进缓存）：等 document.fonts 加载完这些字再算。

/** 内存里最多留多少个字。 */
const CACHE_MAX = 1500;
/** 等字体加载最久多少毫秒；到点还没好的字先放下，字体 loadingdone 时再算。 */
const FONT_WAIT_MS = 4000;

type Entry = { glyph: Glyph | null } | 'pending';

export interface FontDemandChar {
    ch: string;
    /** 马上要写（onScreen）；否则后台算。 */
    near: boolean;
}

/** 一个运行时和队列的连接。 */
export interface NebbiaFontStrokesHandle {
    /** 整份替换这个运行时要的字（按优先顺序，已算的会跳过）。 */
    want(chars: FontDemandChar[], family: string, weight: number): void;
    detach(): void;
}

interface Demand { chars: FontDemandChar[]; family: string; weight: number }
interface Job { key: string; ch: string; family: string; weight: number; near: boolean }

class NebbiaFontStrokesQueue {
    private readonly cache = new Map<string, Entry>();
    private readonly demands = new Map<symbol, Demand>();
    private readonly listeners = new Map<symbol, () => void>();
    private running = false;
    /** 需求每换一份加一：等字体、等推理的时候换了，这一批作废重选。 */
    private version = 0;
    /** 这一次没跑出来（没有模型、没有 WebGPU）：本会话不再试。 */
    private unavailable = false;
    /** 字体没加载好、先放下的字，loadingdone 后再算。 */
    private readonly blocked = new Set<string>();

    private keyOf(ch: string, family: string, weight: number) {
        return `${weight} ${family}|${ch}`;
    }

    /** 算好的字形；还没算、算不出来时 null。 */
    get(ch: string, family: string, weight: number): Glyph | null {
        const hit = this.cache.get(this.keyOf(ch, family, weight));
        if (!hit || hit === 'pending') return null;
        // 最近用过的挪到最后，超出上限时从最前面丢
        const key = this.keyOf(ch, family, weight);
        this.cache.delete(key);
        this.cache.set(key, hit);
        return hit.glyph;
    }

    /** 接上一个运行时：listener 每批算完时调用。 */
    attach(listener: () => void): NebbiaFontStrokesHandle {
        const id = Symbol('nebbia-font-strokes');
        this.listeners.set(id, listener);
        if (this.listeners.size === 1) globalThis.document?.fonts?.addEventListener('loadingdone', this.handleFontsLoaded);
        return {
            want: (chars, family, weight) => {
                if (this.unavailable) return;
                this.demands.set(id, { chars, family, weight });
                this.version += 1;
                void this.pump();
            },
            detach: () => {
                this.demands.delete(id);
                this.listeners.delete(id);
                if (!this.listeners.size) globalThis.document?.fonts?.removeEventListener('loadingdone', this.handleFontsLoaded);
            },
        };
    }

    private handleFontsLoaded = () => {
        if (!this.blocked.size) return;
        this.blocked.clear();
        void this.pump();
    };

    /** 下一批：马上要写的字在前，各运行时的顺序各自保留；已算的、在算的、放下的跳过。 */
    private nextBatch(): Job[] {
        const near: Job[] = [], far: Job[] = [], seen = new Set<string>();
        for (const demand of this.demands.values()) {
            for (const { ch, near: isNear } of demand.chars) {
                if (!isModelChar(ch)) continue;
                const key = this.keyOf(ch, demand.family, demand.weight);
                if (seen.has(key) || this.cache.has(key) || this.blocked.has(key)) continue;
                seen.add(key);
                (isNear ? near : far).push({ key, ch, family: demand.family, weight: demand.weight, near: isNear });
            }
            if (near.length >= STROKES_GPU_BATCH) break;
        }
        return [...near, ...far].slice(0, STROKES_GPU_BATCH);
    }

    /** 这批字的字体都加载好了才返回它们；没好的等一等（最多 FONT_WAIT_MS），还没好就放下。 */
    private async withFontsReady(batch: Job[]): Promise<Job[]> {
        const fonts = globalThis.document?.fonts;
        if (!fonts) return batch;
        const ready: Job[] = [];
        const byFont = new Map<string, Job[]>();
        for (const q of batch) {
            const font = `${q.weight} 16px ${q.family}`;
            byFont.set(font, [...(byFont.get(font) ?? []), q]);
        }
        for (const [font, group] of byFont) {
            const text = group.map(q => q.ch).join('');
            const check = () => { try { return fonts.check(font, text); } catch { return true; } };
            if (!check()) {
                try { await Promise.race([fonts.load(font, text), new Promise(resolve => setTimeout(resolve, FONT_WAIT_MS))]); } catch { /* 加载失败：下面照 check 处理 */ }
            }
            if (check()) ready.push(...group);
            else for (const q of group) this.blocked.add(q.key);
        }
        return ready;
    }

    private async pump() {
        if (this.running) return;
        this.running = true;
        try {
            while (this.demands.size && !this.unavailable) {
                const version = this.version;
                const picked = await this.withFontsReady(this.nextBatch());
                if (!picked.length) {
                    // 这一批全放下了：还有别的要算就接着来，没有就停
                    if (this.blocked.size && this.nextBatch().length) continue;
                    break;
                }
                // 等字体的时候需求换了（换歌、拖进度）：这一批作废，按新的顺序重选
                if (version !== this.version) continue;
                const batch = picked;
                const inputs: { key: string; canon: NonNullable<ReturnType<typeof renderCanon>> }[] = [];
                for (const q of batch) {
                    const canon = renderCanon(q.ch, q.family, q.weight);
                    if (canon) { inputs.push({ key: q.key, canon }); this.cache.set(q.key, 'pending'); }
                    else this.cache.set(q.key, { glyph: null });
                }
                if (!inputs.length) continue;
                const started = performance.now();
                const results = await runStrokesGpu(inputs.map(i => glyphFeatures(i.canon.img)), { urgency: batch.some(q => q.near) ? 'onScreen' : 'background' });
                if (!results) {
                    // 没有模型或 WebGPU：这些字退回原来的笔顺，本会话不再要
                    for (const i of inputs) this.cache.delete(i.key);
                    this.unavailable = true;
                    console.info('[Nebbia] font strokes unavailable, keeping the stroke-order data');
                    break;
                }
                inputs.forEach((input, i) => this.cache.set(input.key, { glyph: buildGlyph(input.canon, results[i]) }));
                console.info(`[Nebbia] font strokes: ${inputs.length} glyphs in ${Math.round(performance.now() - started)} ms`);
                this.trim();
                for (const listener of this.listeners.values()) listener();
            }
        } finally {
            this.running = false;
        }
    }

    private trim() {
        for (const key of this.cache.keys()) {
            if (this.cache.size <= CACHE_MAX) break;
            if (this.cache.get(key) !== 'pending') this.cache.delete(key);
        }
    }
}

export const nebbiaFontStrokes = new NebbiaFontStrokesQueue();
