import type { FontStrokesDemand } from './fontStrokesDemand';
import type { FontStrokesMemory } from './fontStrokesMemory';
import type { FontStrokesGlyph } from './fontStrokesOutline';
import type { FontStrokesStore } from './fontStrokesStore';

// src/services/fontStrokes/fontStrokesPlanner.ts
// 预备服务：算什么、什么时候算、存哪都归这里，样式只登记「我要这个字体的笔画」、画的时候同步查内存。
//   顺序  当前歌从播放位置往后 4 句（onScreen）→ 当前歌其余 → 下一首、下下首（background）（需求见 fontStrokesDemand.ts）
//   每轮  先把还没在内存里的字整批去盘上查（一个字体每个字只查一次），查不到的才推理，8 个一批，和 automix 分析共用 GPU 调度器
//         几个字体键（同一字体的几个字重也是不同的键）一起缺字时，先推最急的那一档（马上要画的 → 使用方自己显示的 → 当前歌其余 → 后两首），
//         不让前一个键的后台字把后一个键马上要画的字压住
//   失败  临时失败（模型还没下好、这一批没跑出来、抛异常）5 s / 30 s / 2 min 退避重试；只有没 WebGPU、模型确定加载不了才停
//         推理抛异常或没结果时，卡在「在算」的字一律放掉，下一轮能再选
//   没有使用方登记时：不读需求、不查盘、不推理、不下载模型
// 所有外部依赖都从 deps 注入（单测里用假的）；真实接线在 index.ts。

/** 推理一批的字数（GPU 一次的字数，同 STROKES_GPU_BATCH）。 */
export const PLANNER_BATCH = 8;
/** 一次查盘最多多少个字。 */
const STORE_CHUNK = 256;
/** 临时失败的退避（毫秒）：第 1、2、3 次及以后。 */
export const PLANNER_BACKOFF_MS = [5_000, 30_000, 120_000];
/** 字体还没加载好时，这批字放下多久再试（毫秒）。 */
const FONT_RETRY_MS = 3_000;

/** 一个字光栅化后的结果：交给 infer 的输入特征，和 build 要的网格信息。 */
export interface PlannerRaster<C> { canon: C; features: Float32Array<ArrayBuffer> }

export interface PlannerDeps<C, R> {
    store: Pick<FontStrokesStore, 'getGlyphs' | 'putGlyphs'>;
    memory: FontStrokesMemory;
    /** 现算一份需求。 */
    readDemand(): FontStrokesDemand;
    /** 需求可能变了时回调（换歌、歌词到了、播放换句）；返回取消。只在有使用方时订阅。 */
    subscribeDemand(onChange: () => void): () => void;
    /** 字体键 → 光栅化用的 CSS 字体栈；认不出时 null（这个键的字全部当没有）。 */
    fontStackOf(fontKey: string): string | null;
    /** 字体键 → 推理、光栅化用的字重；认不出时 null（同上）。 */
    fontWeightOf(fontKey: string): number | null;
    labelOf(fontKey: string): string;
    /** 等这个字重的字体加载好；到时间还没好返回 false。 */
    prepareFont(family: string, weight: number, chars: string[]): Promise<boolean>;
    /** 一个字按这个字重 → 模型输入；画不出墨时 null。 */
    rasterize(ch: string, family: string, weight: number): PlannerRaster<C> | null;
    /** 一批输入 → 结果；null = 没跑出来（模型没下好、被调度器丢了、跑挂了）。 */
    infer(features: Float32Array<ArrayBuffer>[], urgency: 'onScreen' | 'background'): Promise<R[] | null>;
    build(canon: C, result: R): FontStrokesGlyph;
    /** 这个会话里模型确定跑不了（没 WebGPU、加载不了）。 */
    permanentlyUnavailable(): boolean;
    /** 哪些字交给模型。 */
    isModelChar(ch: string): boolean;
    /** 测试里可换的退避表和批大小。 */
    backoffMs?: readonly number[];
    batch?: number;
}

export class FontStrokesPlanner<C, R> {
    /** 使用方 → 它的字体键和它自己正在显示的字（播放之外的文本：预览、试玩台等）。 */
    private readonly consumers = new Map<symbol, { fontKey: string; chars: string }>();
    private unsubscribeDemand: (() => void) | null = null;
    private running = false;
    /** 跑的过程中又有变化：当前这一步结束后再看一遍。 */
    private again = false;
    /** 本会话确定跑不了。 */
    private unavailable = false;
    private attempts = 0;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    /** 每个字体键下已经查过盘的字（查到没查到都算）。 */
    private readonly storeChecked = new Map<string, Set<string>>();
    /** 在算的字（fontKey + 字）；无论成败都在 finally 里放掉。 */
    private readonly pending = new Set<string>();
    /** 字体没加载好暂时放下的字，到时间自动解除。 */
    private readonly deferred = new Set<string>();
    private deferTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly deps: PlannerDeps<C, R>) {}

    /**
     * 登记一个使用方要这个字体键的笔画；chars 是它自己正在显示的文本（排在播放的马上要画的句子后面、当前歌其余的句子前面）。
     * 返回取消登记。没有使用方时服务什么都不做。
     */
    register(fontKey: string, chars = ''): () => void {
        const id = Symbol('font-strokes-consumer');
        this.consumers.set(id, { fontKey, chars });
        if (this.consumers.size === 1) this.unsubscribeDemand = this.deps.subscribeDemand(() => this.kick());
        this.kick();
        return () => {
            if (!this.consumers.delete(id)) return;
            if (!this.consumers.size) this.stop();
        };
    }

    /** 有没有使用方（测试和 index 用）。 */
    get active(): boolean { return this.consumers.size > 0; }

    /** 清盘之后让下一轮重新查盘、重新算。 */
    reset(): void {
        this.storeChecked.clear();
        this.kick();
    }

    /** 在退避等待中（定时器到点之前不再开跑）。 */
    private get backingOff(): boolean { return this.retryTimer !== null; }

    private stop(): void {
        this.unsubscribeDemand?.();
        this.unsubscribeDemand = null;
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = null;
        if (this.deferTimer) clearTimeout(this.deferTimer);
        this.deferTimer = null;
        this.deferred.clear();
        this.attempts = 0;
    }

    /** 有事可做的信号：没在跑就开跑，在跑就让它这一步结束后再看一遍；退避期间只认定时器。 */
    private kick(): void {
        if (!this.consumers.size) return;
        if (this.running) { this.again = true; return; }
        void this.run();
    }

    /** 推理能不能开：永久不可用、退避等待中都不行（查盘不受影响，盘上已有的字照常读）。 */
    private get canInfer(): boolean { return !this.unavailable && !this.backingOff; }

    /** 跑的过程中有人 kick 过、而且现在还该跑。（单独成方法：TS 看不出 await 期间 again 被改过。） */
    private shouldRunAgain(): boolean { return this.again && this.consumers.size > 0; }

    private async run(): Promise<void> {
        this.running = true;
        try {
            do {
                this.again = false;
                while (this.consumers.size) {
                    if (!(await this.step())) break;
                }
            } while (this.shouldRunAgain());
        } finally {
            this.running = false;
        }
    }

    /**
     * 各登记字体各自还缺的字，按需求顺序；near 标出马上要画的，tiers[i] 是 chars[i] 属于哪一档
     * （0 马上要画、1 使用方自己显示的、2 当前歌其余、3 后两首）。
     */
    private missing(): { fontKey: string; chars: string[]; tiers: number[]; near: Set<string> }[] {
        const demand = this.deps.readDemand();
        const near = new Set(demand.near);
        const extrasOf = new Map<string, string>();
        for (const { fontKey, chars } of this.consumers.values()) extrasOf.set(fontKey, (extrasOf.get(fontKey) ?? '') + chars);
        return [...extrasOf].map(([fontKey, extras]) => {
            const chars: string[] = [], tiers: number[] = [];
            const seen = new Set<string>();
            const groups = [demand.near, Array.from(extras), demand.rest, demand.background];
            groups.forEach((group, tier) => {
                for (const ch of group) {
                    if (seen.has(ch) || !this.deps.isModelChar(ch)) continue;
                    seen.add(ch);
                    if (this.deps.memory.has(fontKey, ch) || this.pending.has(fontKey + '\u0000' + ch) || this.deferred.has(fontKey + '\u0000' + ch)) continue;
                    chars.push(ch);
                    tiers.push(tier);
                }
            });
            return { fontKey, near, chars, tiers };
        });
    }

    /** 做一步：先查盘，没有可查的再推理一批；没事可做返回 false。 */
    private async step(): Promise<boolean> {
        const wants = this.missing();
        for (const { fontKey, chars } of wants) {
            const checked = this.storeChecked.get(fontKey) ?? new Set<string>();
            this.storeChecked.set(fontKey, checked);
            const unchecked = chars.filter(ch => !checked.has(ch)).slice(0, STORE_CHUNK);
            if (!unchecked.length) continue;
            const found = await this.deps.store.getGlyphs(fontKey, unchecked);
            // 只记没查到的：查到的进了内存，内存把它挤出去之后要能再从盘上读回来，不能直接去推理
            for (const ch of unchecked) if (!found.has(ch)) checked.add(ch);
            if (found.size) this.deps.memory.setMany(fontKey, found);
            return true;
        }
        if (!this.canInfer) return false;
        const size = this.deps.batch ?? PLANNER_BATCH;
        // 最急的那个键先推（看它缺的第一个字在哪一档；同档按登记顺序）
        let pick: (typeof wants)[number] | null = null;
        for (const want of wants) if (want.chars.length && (!pick || want.tiers[0] < pick.tiers[0])) pick = want;
        if (!pick) return false;
        const batch = pick.chars.slice(0, size);
        await this.infer(pick.fontKey, batch, batch.some(ch => pick.near.has(ch)));
        return true;
    }

    /** 推理一批：成功就进内存并存盘；失败按临时 / 永久处理。 */
    private async infer(fontKey: string, batch: string[], near: boolean): Promise<void> {
        const family = this.deps.fontStackOf(fontKey);
        const weight = this.deps.fontWeightOf(fontKey);
        if (!family || weight === null) {
            this.deps.memory.setMany(fontKey, batch.map(ch => [ch, null] as [string, null]));
            return;
        }
        if (!(await this.deps.prepareFont(family, weight, batch))) {
            this.defer(fontKey, batch);
            return;
        }
        const inputs: { ch: string; raster: PlannerRaster<C> }[] = [];
        const blank: [string, null][] = [];
        for (const ch of batch) {
            const raster = this.deps.rasterize(ch, family, weight);
            if (raster) inputs.push({ ch, raster }); else blank.push([ch, null]);
        }
        if (blank.length) this.deps.memory.setMany(fontKey, blank);
        if (!inputs.length) return;
        const keys = inputs.map(i => fontKey + '\u0000' + i.ch);
        for (const key of keys) this.pending.add(key);
        try {
            const results = await this.deps.infer(inputs.map(i => i.raster.features), near ? 'onScreen' : 'background');
            if (!results || results.length !== inputs.length) { this.failed(); return; }
            const built = new Map<string, FontStrokesGlyph>();
            inputs.forEach((input, i) => built.set(input.ch, this.deps.build(input.raster.canon, results[i])));
            this.attempts = 0;
            this.deps.memory.setMany(fontKey, built);
            await this.deps.store.putGlyphs(fontKey, this.deps.labelOf(fontKey), built);
            // 存上盘了：之后被内存挤出去时去盘上读，不再重算
            const checked = this.storeChecked.get(fontKey);
            for (const ch of built.keys()) checked?.delete(ch);
        } catch (error) {
            console.warn('[FontStrokes] inference batch failed:', error);
            this.failed();
        } finally {
            for (const key of keys) this.pending.delete(key);
        }
    }

    /** 这一批没出结果：永久不可用就停，否则排一次退避重试。 */
    private failed(): void {
        if (this.deps.permanentlyUnavailable()) {
            this.unavailable = true;
            console.info('[FontStrokes] font strokes unavailable on this machine, not retrying this session');
            return;
        }
        const table = this.deps.backoffMs ?? PLANNER_BACKOFF_MS;
        const delay = table[Math.min(this.attempts, table.length - 1)];
        this.attempts += 1;
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            this.kick();
        }, delay);
    }

    /** 字体没加载好：这批字放下一会儿，到时间解除再试。 */
    private defer(fontKey: string, batch: string[]): void {
        for (const ch of batch) this.deferred.add(fontKey + '\u0000' + ch);
        if (this.deferTimer) return;
        this.deferTimer = setTimeout(() => {
            this.deferTimer = null;
            this.deferred.clear();
            this.kick();
        }, FONT_RETRY_MS);
    }
}
