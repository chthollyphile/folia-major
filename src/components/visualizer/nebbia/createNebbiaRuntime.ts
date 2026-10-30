import type { Theme } from '../../../types';
import { loadLucideIcons, resolveLucideIconNames } from '../../../services/lucideIconResolver';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import { buildNebbiaLines, collectEmojiIcons, NEBBIA_DEFAULT_DOODLES } from './nebbiaChars';
import { appendNebbiaCredits } from './nebbiaCredits';
import { NEBBIA_FIXED } from './nebbiaConstants';
import { NebbiaGlassMotion } from './nebbiaDrops';
import { fitNebbiaCanvas, NebbiaGl } from './nebbiaGl';
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

// src/components/visualizer/nebbia/createNebbiaRuntime.ts
// 雾笺的运行时：一块画布、一个 WebGL2 上下文，自己的 rAF 循环。React 外壳把歌、tuning、主题、暂停推进来，
// 每帧的播放时间和人声能量只在循环里读，不进 React state。暂停时不跑循环，只在需要时补画一帧；
// 静态模式照常跟着歌词写字，窗外按车速匀速走，但不颠簸、没有小雨点。着色器在后台编（nebbiaPrograms.ts），编好之前循环空转、不画。

// 改了要重排整首的 tuning 项
const LAYOUT_KEYS: (keyof NebbiaTuning)[] = ['appear', 'fade', 'layouts', 'credits', 'jitter', 'warp', 'hold', 'refog', 'writeSpeed', 'doodle'];
// Chromium 给 WebGL 绘图缓冲定的面积上限：建上下文时只按边长夹，之后改尺寸才按面积夹
const MAX_DRAWING_BUFFER_AREA = 5760 * 5760;
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
    private readonly observer: ResizeObserver | null = null;
    private readonly glyphs: NebbiaGlyphCache;
    private hits = new NebbiaHits(0);
    private laid: LaidLine[] = [];
    private words: number[][][] = [];
    /** 大雨点排好时用的人声轨包络（智能动感模式「疏雨轻车」的雨点跟人声），没有时 null、退回频段。 */
    private vocalEnv: VocalEnvelope | null = null;
    private readonly drizzleRide = new NebbiaDrizzleRide();
    private readonly clock = new NebbiaSceneClock();
    private song: NebbiaSong = { lines: [], seed: 'nebbia' };
    private theme: Theme;
    private tuning: NebbiaTuning;
    private fontScale = 1;
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

    constructor(private readonly input: NebbiaRuntimeInput, theme: Theme, tuning: NebbiaTuning) {
        this.theme = theme;
        this.tuning = tuning;
        // setTuning 只在 tuning 变了才调：上下文恢复后重建的运行时要自己带上颠簸强度
        this.motion.bump = tuning.bump;
        this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
        this.glyphs = new NebbiaGlyphCache(resolveThemeFontStack(theme), resolveThemeFontWeight(theme, 600));
        input.host.appendChild(this.canvas);
        // 建上下文之前先把画布定到宿主的尺寸：着色器提交以后第一次 resize 就不用再改画布尺寸（见 fitNebbiaCanvas）。
        // 超过面积上限的不先定：那样建出来的绘图缓冲比之后 resize 夹出来的大得多
        const size = this.hostSize();
        if (size && size.W * size.H * this.dpr() ** 2 <= MAX_DRAWING_BUFFER_AREA) fitNebbiaCanvas(this.canvas, size.W, size.H, this.dpr());
        try {
            this.gl = new NebbiaGl(this.canvas);
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
        if (prev.resolution !== tuning.resolution) this.resize();
        if (LAYOUT_KEYS.some(k => !sameValue(prev[k], tuning[k]))) this.rebuild();
        this.requestFrame();
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
    }

    // 宿主的 CSS 尺寸（取整）；还没尺寸（隐藏、0 大小）时是 null
    private hostSize(): { W: number; H: number } | null {
        const rect = this.input.host.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return null;
        return { W: Math.round(rect.width), H: Math.round(rect.height) };
    }

    private dpr() {
        return Math.min(2, window.devicePixelRatio || 1) * this.tuning.resolution;
    }

    private resize() {
        const size = this.hostSize();
        if (!size) return;
        const sized = size.W !== this.W || size.H !== this.H;
        this.W = size.W;
        this.H = size.H;
        this.gl.resize(this.W, this.H, this.dpr());
        this.mask.resize(this.W, this.H);
        if (sized) {
            this.motion.buildField(this.W, this.H);
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
        const ride = this.drizzleRide;
        ride.step(this.motion, now, T, frozen, t.bump);
        const vocalStrength = ride.rain;
        if (ride.env !== this.vocalEnv) {
            this.vocalEnv = ride.env;
            this.rebuildHits();
        }
        const e = this.energy.update(this.input.vocal.get(), Math.max(dt, 1 / 60));
        this.hits.advance(T, e, this.still ? 0 : t.rainHit * vocalStrength, NebbiaHits.lifeOf(t.refog, NEBBIA_FIXED.beadHold), this.W, this.H);
        this.mask.draw(this.laid, T, now, t, this.motion, this.hits, t.rainBig * vocalStrength);
        this.spot.update(this.laid, T, dt);
        this.gl.render(this.mask.ctx, this.mask.breath.active ? this.mask.breath.canvas : null, this.motion.drops, this.motion.fieldInstances(this.fieldInst, t.busSpeed),
            nebbiaFrameUniforms(t, this.motion.shake(), this.spot, this.W, this.H, this.clock.time));
        if (!this.firstDrawn) { this.firstDrawn = true; this.input.onFirstFrame(); }
        if (!this.paused) this.raf = requestAnimationFrame(this.frame);
    };
}
