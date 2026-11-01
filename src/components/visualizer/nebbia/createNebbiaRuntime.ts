import type { LyricRenderScale, Theme } from '../../../types';
import { resolveLyricPixelRatio } from '../../../utils/lyricRenderQuality';
import { loadLucideIcons, resolveLucideIconNames } from '../../../services/lucideIconResolver';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import { buildNebbiaLines, collectEmojiIcons, NEBBIA_DEFAULT_DOODLES } from './nebbiaChars';
import { appendNebbiaCredits } from './nebbiaCredits';
import { NEBBIA_FIXED } from './nebbiaConstants';
import { NebbiaGlassMotion } from './nebbiaDrops';
import { NebbiaGl } from './nebbiaGl';
import { NebbiaGlyphCache } from './nebbiaGlyphs';
import { NebbiaHits, VocalEnergy } from './nebbiaHits';
import { NebbiaMask } from './nebbiaMask';
import { resolveNebbiaPalette } from './nebbiaPalette';
import { buildNebbiaScene, type LaidLine } from './nebbiaScene';
import { NebbiaSpot } from './nebbiaSpot';
import { loadNebbiaStrokes } from './nebbiaStrokes';
import type { NebbiaRuntimeInput, NebbiaSong, NebbiaTuning } from './types';
import { hashVisualizerSeed } from '../visualizerSeedHash';
import type { VocalEnvelope } from '../../../services/analysis/vocalEnvelope';
import { NebbiaDrizzleRide } from './nebbiaDrizzleRide';
import { nebbiaFrameUniforms } from './nebbiaFrameUniforms';
import { NebbiaSceneClock } from './nebbiaSceneClock';
import { NebbiaCondensation } from './nebbiaCondensation';
import { NebbiaAquarium, type NebbiaAquaBeats } from './nebbiaAquarium';
import { BEAT_EFFECT_IDS, beatEffectPartId } from '../../../services/beatFx/beatEffects';
import { getBeatEffectStrength, getBeatFxEvents, getBeatFxHeard, isBeatEffectPlaying, isBeatFxReady } from '../../../services/beatFx/beatFxLive';

const AQUA_BEAT = BEAT_EFFECT_IDS.nebbiaAquaBeat;
const AQUA_JELLY = beatEffectPartId(AQUA_BEAT, 'jelly'), AQUA_WEED = beatEffectPartId(AQUA_BEAT, 'weed'), AQUA_BUBBLE = beatEffectPartId(AQUA_BEAT, 'bubble');
const AQUA_SPOT = beatEffectPartId(AQUA_BEAT, 'spot');

// src/components/visualizer/nebbia/createNebbiaRuntime.ts
// 雾笺的运行时：一块画布、一个 WebGL2 上下文，自己的 rAF 循环。React 外壳把歌、tuning、主题、暂停推进来，
// 每帧的播放时间和人声能量只在循环里读，不进 React state。暂停时不跑循环，只在需要时补画一帧；
// 静态模式照常跟着歌词写字，窗外按车速匀速走，但不颠簸、没有小雨点。着色器在后台编（nebbiaPrograms.ts），编好之前循环空转、不画。
// 窗外是水族箱时每帧推着水母、跟拍的水草和大泡走（nebbiaAquarium.ts），智能动感模式的「舞潮踏拍」开着就跟拍；
// 水族箱里没有雨打窗、车也不颠（疏雨轻车不算）。

// 改了要重排整首的 tuning 项
const LAYOUT_KEYS: (keyof NebbiaTuning)[] = ['appear', 'fade', 'layouts', 'credits', 'jitter', 'warp', 'hold', 'refog', 'writeSpeed', 'doodle'];
// 开关组是数组，每次合并都是新的一份：按内容比
const sameValue = (a: unknown, b: unknown) => (Array.isArray(a) && Array.isArray(b) ? a.join() === b.join() : a === b);

export class NebbiaRuntime {
    private readonly canvas = document.createElement('canvas');
    private readonly gl: NebbiaGl;
    private readonly mask = new NebbiaMask();
    private readonly motion = new NebbiaGlassMotion();
    private readonly spot = new NebbiaSpot();
    private readonly energy = new VocalEnergy();
    private readonly fieldInst: number[] = [];
    /** 玻璃是凝露时雾上的细小冷凝水珠（代替 motion 的凝结水珠）；雨窗时 null。 */
    private readonly condensation: NebbiaCondensation | null;
    private readonly observer: ResizeObserver | null = null;
    private readonly glyphs: NebbiaGlyphCache;
    private hits = new NebbiaHits(0);
    private laid: LaidLine[] = [];
    private words: number[][][] = [];
    /** 大雨点排好时用的人声轨包络（智能动感模式「疏雨轻车」的雨点跟人声），没有时 null、退回频段。 */
    private vocalEnv: VocalEnvelope | null = null;
    private readonly drizzleRide = new NebbiaDrizzleRide();
    private readonly clock = new NebbiaSceneClock();
    /** 窗外是水族箱时的水母；街景时 null。 */
    private readonly aquarium: NebbiaAquarium | null;
    /** aquaBeats() 每帧改写的那一份。 */
    private readonly aquaBeatsOut: NebbiaAquaBeats = { events: [], heard: 0, jelly: 0, weed: 0, bubble: 0, spot: 0 };
    private song: NebbiaSong = { lines: [], seed: 'nebbia' };
    private theme: Theme;
    private tuning: NebbiaTuning;
    private fontScale = 1;
    /** 分辨率倍数（#929）：外壳从全局挡位和 tuning.render 合出来，预览时是 1。 */
    private renderScale: LyricRenderScale;
    private showText = true;
    private paused = false;
    private still = false;
    private W = 0; private H = 0;
    private raf = 0;
    private buildToken = 0;
    private firstDrawn = false;
    private dead = false;
    /** 主题字体上次看时是否已加载：从没加载变成加载了，骨架才要重追。 */
    private fontReady = true;
    /** 建运行时的时刻和着色器编好是否已记日志：看预热有没有命中缓存。 */
    private readonly startedAt = performance.now();
    private shadersLogged = false;

    constructor(private readonly input: NebbiaRuntimeInput, theme: Theme, tuning: NebbiaTuning, renderScale: LyricRenderScale = 1) {
        this.theme = theme;
        this.tuning = tuning;
        this.renderScale = renderScale;
        this.aquarium = input.scene === 'aquarium' ? new NebbiaAquarium() : null;
        this.condensation = input.glass === 'dew' ? new NebbiaCondensation() : null;
        // setTuning 只在 tuning 变了才调：上下文恢复后重建的运行时要自己带上颠簸强度
        this.motion.bump = tuning.bump;
        this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
        this.glyphs = new NebbiaGlyphCache(resolveThemeFontStack(theme), resolveThemeFontWeight(theme, 600));
        input.host.appendChild(this.canvas);
        try {
            this.gl = new NebbiaGl(this.canvas, input.seeThrough, input.scene, input.glass);
            this.gl.onSpriteReady = () => this.requestFrame();
            this.canvas.addEventListener('webglcontextlost', this.handleContextLost);
            this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
            this.observer = new ResizeObserver(() => this.resize());
            this.observer.observe(input.host);
            this.applyTheme();
            this.resize();
        } catch (error) {
            // 着色器编不过之类：画布、上下文、监听都收回，外壳退回只显示当前这句
            this.dead = true;
            this.observer?.disconnect();
            this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
            this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
            this.canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
            this.canvas.remove();
            throw error;
        }
        // 主题字体晚到：骨架是对着回退字体追的，作废重排
        this.fontReady = this.glyphs.fontReady();
        document.fonts?.addEventListener('loadingdone', this.handleFontsLoaded);
        // 笔顺数据只读一次；到了以后字形缓存作废，下一次排版用上
        void loadNebbiaStrokes().then(data => { if (data && !this.dead) { this.glyphs.clear(); this.rebuild(); } });
    }

    setSong(song: NebbiaSong) {
        if (song.seed !== this.song.seed) this.clock.songChanged();
        this.song = song;
        this.rebuild();
    }
    setFontScale(scale: number) { if (scale !== this.fontScale) { this.fontScale = scale; this.rebuild(); } }
    setShowText(show: boolean) { if (show !== this.showText) { this.showText = show; this.rebuild(); } }
    /** 透明时雾的颜色跟主题日夜：日间乳白，夜间深色（像夜里起雾的车窗）。 */
    setDaylight(daylight: boolean) { this.gl.mistTint = daylight ? [0.86, 0.89, 0.92] : [0.07, 0.08, 0.1]; this.requestFrame(); }

    // 只改配色时只换调色板；字体或涂鸦图标变了才重排整首
    setTheme(theme: Theme) {
        const iconsChanged = String(resolveLucideIconNames(theme.lyricsIcons)) !== String(resolveLucideIconNames(this.theme.lyricsIcons));
        this.theme = theme;
        const fontChanged = this.glyphs.setFont(resolveThemeFontStack(theme), resolveThemeFontWeight(theme, 600));
        if (fontChanged) this.fontReady = this.glyphs.fontReady();
        this.applyTheme();
        if (fontChanged || iconsChanged) this.rebuild();
        else this.requestFrame();
    }

    setTuning(tuning: NebbiaTuning) {
        const prev = this.tuning;
        this.tuning = tuning;
        this.motion.bump = tuning.bump;
        if (LAYOUT_KEYS.some(k => !sameValue(prev[k], tuning[k]))) this.rebuild();
        this.requestFrame();
    }

    /** 分辨率倍数变了：就地换画布和缓冲的尺寸，不重建上下文。 */
    setRenderScale(scale: LyricRenderScale) {
        if (scale === this.renderScale) return;
        this.renderScale = scale;
        this.resize();
    }

    setPlayback(paused: boolean, still: boolean) {
        this.paused = paused;
        this.still = still;
        this.requestFrame();
    }

    /** 补画一帧（暂停时拖进度）；在跑循环时什么都不做。 */
    requestFrame() {
        if (!this.raf && !this.dead) this.raf = requestAnimationFrame(this.frame);
    }

    destroy() {
        this.dead = true;
        cancelAnimationFrame(this.raf);
        this.observer?.disconnect();
        document.fonts?.removeEventListener('loadingdone', this.handleFontsLoaded);
        this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
        this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
        this.gl.destroy();
        this.canvas.remove();
    }

    private handleContextLost = (event: Event) => {
        event.preventDefault();
        cancelAnimationFrame(this.raf);
        this.dead = true;
        this.input.onFailed();
    };

    // 上下文回来了：纹理、程序都没了，整个运行时由外壳重建
    private handleContextRestored = () => {
        this.input.onRestored();
    };

    // 别的字体加载完也会触发：只在主题字体刚变成可用时重排
    private handleFontsLoaded = () => {
        if (this.dead) return;
        const ready = this.glyphs.fontReady();
        const arrived = ready && !this.fontReady;
        this.fontReady = ready;
        if (!arrived) return;
        this.glyphs.clear();
        this.rebuild();
    };

    private applyTheme() {
        const p = resolveNebbiaPalette(this.theme);
        this.gl.setPalette(p.sky0, p.sky1, p.la, p.lb, p.lc);
        this.aquarium?.setPalette(p.la, p.lb, p.lc);
    }

    /** 「舞潮踏拍」：开着、节拍表装好、不是静态模式时给的节拍表和三项强度。 */
    private aquaBeats(): NebbiaAquaBeats | null {
        if (this.still || !isBeatFxReady() || !isBeatEffectPlaying(AQUA_BEAT)) return null;
        // 按听到的时刻走（扣掉输出延迟），和其他跟拍效果一样
        const heard = getBeatFxHeard().time;
        if (heard === null) return null;
        const out = this.aquaBeatsOut;
        out.events = getBeatFxEvents();
        out.heard = heard;
        out.jelly = getBeatEffectStrength(AQUA_JELLY);
        out.weed = getBeatEffectStrength(AQUA_WEED);
        out.bubble = getBeatEffectStrength(AQUA_BUBBLE);
        out.spot = getBeatEffectStrength(AQUA_SPOT);
        return out;
    }

    private resize() {
        // 量排版尺寸，不量 getBoundingClientRect：样式小图和样式窗口的大样张把窗口大的舞台缩小了画（preview/previewScale.ts），
        // 量到缩小后的尺寸，整首就排在小画布上，字小到笔画宽度被 8 像素的下限盖过，调笔画粗细看不出变化（#963）
        const { clientWidth: width, clientHeight: height } = this.input.host;
        if (width < 1 || height < 1) return;
        const sized = width !== this.W || height !== this.H;
        this.W = width;
        this.H = height;
        const dpr = resolveLyricPixelRatio(Math.min(2, window.devicePixelRatio || 1), this.renderScale);
        this.gl.resize(this.W, this.H, dpr);
        this.mask.resize(this.W, this.H);
        if (sized) {
            if (this.condensation) this.condensation.build(this.W, this.H);
            else this.motion.buildField(this.W, this.H);
            this.rebuild();
        }
        this.requestFrame();
    }

    // 换歌、改排版相关的设置、换尺寸时重排整首；图标先加载好（图标字形要用 lucide 的节点）
    private rebuild() {
        const token = ++this.buildToken;
        const { lines, seed, title, artist } = this.song;
        const themeIcons = resolveLucideIconNames(this.theme.lyricsIcons);
        const doodles = themeIcons.length ? themeIcons : NEBBIA_DEFAULT_DOODLES;
        void loadLucideIcons([...doodles, ...collectEmojiIcons(lines)]).catch(() => undefined).then(() => {
            if (token !== this.buildToken || this.dead || !this.W) return;
            const source = this.showText ? appendNebbiaCredits(buildNebbiaLines(lines, seed, this.tuning.doodle, doodles), this.tuning.credits ? title : null, artist) : [];
            this.laid = buildNebbiaScene(source, this.glyphs, this.tuning, { W: this.W, H: this.H, fontScale: this.fontScale }, seed);
            this.hits = new NebbiaHits(hashVisualizerSeed(String(seed)));
            this.words = source.map(l => l.words);
            this.rebuildHits();
            this.spot.reset();
            this.requestFrame();
        });
    }

    private rebuildHits() {
        this.hits.buildBig(this.laid, this.words, this.W, this.H, this.vocalEnv);
    }

    // 着色器编好了没有：没编好下一帧再问（暂停时也问，编好补画第一帧）；编不过就和上下文丢了一样，外壳退回只显示当前这句
    private shadersReady(): boolean {
        try {
            if (this.gl.ready) {
                if (!this.shadersLogged) {
                    this.shadersLogged = true;
                    console.info(`[Nebbia] shaders ready ${Math.round(performance.now() - this.startedAt)} ms after start`);
                }
                return true;
            }
        } catch (error) {
            console.warn('[Nebbia] shaders failed to build', error);
            this.dead = true;
            this.input.onFailed();
            return false;
        }
        this.raf = requestAnimationFrame(this.frame);
        return false;
    }

    private frame = () => {
        this.raf = 0;
        if (this.dead || this.gl.isContextLost || !this.shadersReady()) return;
        // 宿主还没尺寸（隐藏、0 大小）时不画，也不报首帧；有尺寸后 resize 会补一帧
        if (!this.W || !this.H) return;
        const now = performance.now() / 1000;
        const frozen = this.paused || this.still;
        const dt = this.clock.tick(now, this.paused);
        const T = this.input.currentTime.get();
        const t = this.tuning;
        // 疏雨轻车：车跟底鼓颠；人声轨包络到了或开关变了，就按它重排整首的雨点，强度每帧乘小雨点密度和大雨点大小
        // 车只在街景里颠（水族箱里不颠），雨只打在雨窗玻璃上（凝露没有雨打窗）
        const ride = this.drizzleRide;
        const rainGlass = !this.condensation;
        if (rainGlass || !this.aquarium) ride.step(this.motion, now, T, frozen, t.bump, !this.aquarium);
        else this.motion.beginFrame(now, frozen, false);
        const vocalStrength = rainGlass ? ride.rain : 0;
        if (rainGlass && ride.env !== this.vocalEnv) {
            this.vocalEnv = ride.env;
            this.rebuildHits();
        }
        const e = this.energy.update(this.input.vocal.get(), Math.max(dt, 1 / 60));
        this.hits.advance(T, e, this.still ? 0 : t.rainHit * vocalStrength, NebbiaHits.lifeOf(t.refog, NEBBIA_FIXED.beadHold), this.W, this.H);
        this.mask.draw(this.laid, T, now, t, this.motion, this.hits, t.rainBig * vocalStrength);
        this.spot.update(this.laid, T, dt);
        const aqua = this.aquarium?.step(dt, this.clock.time, this.W / this.H, t, this.aquaBeats()) ?? null;
        const field = this.condensation ? this.condensation.instances(frozen ? 0 : dt, t.dew, t.dewSize) : this.motion.fieldInstances(this.fieldInst, t.busSpeed);
        this.gl.render(this.mask.ctx, this.mask.breath.active ? this.mask.breath.canvas : null, this.motion.drops, field,
            nebbiaFrameUniforms(t, this.motion.shake(), this.spot, this.W, this.H, this.clock.time, aqua), this.condensation?.changed ?? true);
        if (!this.firstDrawn) { this.firstDrawn = true; this.input.onFirstFrame(); }
        if (!this.paused) this.raf = requestAnimationFrame(this.frame);
    };
}
