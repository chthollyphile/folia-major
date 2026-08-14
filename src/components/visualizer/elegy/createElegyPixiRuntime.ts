import type { MotionValue } from 'framer-motion';
import type { Line, Theme } from '../../../types';
import { buildLineGraphemeTimeline } from '../../../utils/lyrics/graphemeTiming';
import { ElegyGlyphCache } from './elegyGlyphCache';
import {
    buildElegyLineScene,
    layoutElegyLineScene,
    type ElegyLineScene,
    updateElegyLineScene,
} from './elegyScene';

// src/components/visualizer/elegy/createElegyPixiRuntime.ts
// Owns the bounded Pixi scene and mutates handwriting masks from absolute playback time.
type PixiModule = typeof import('pixi.js');

export interface ElegyRuntimeOptions {
    host: HTMLDivElement;
    currentTime: MotionValue<number>;
    theme: Theme;
    fontFamily: string;
    fontWeight: string | number;
    lyricsFontScale: number;
    staticMode: boolean;
    paused: boolean;
    initialLine: Line | null;
    signal?: AbortSignal;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const destroyChildren = (container: import('pixi.js').Container) => {
    container.removeChildren().forEach(child => child.destroy({ children: true }));
};

export class ElegyPixiRuntime {
    private readonly glyphCache: ElegyGlyphCache;
    private readonly textures = new Map<string, import('pixi.js').Texture>();
    private readonly fallbackContainer: import('pixi.js').Container;
    private readonly handwritingContainer: import('pixi.js').Container;
    private activeLine: Line | null = null;
    private activeScene: ElegyLineScene | null = null;
    private fallbackText: import('pixi.js').Text | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private unsubscribeTime: (() => void) | null = null;
    private requestVersion = 0;
    private lastWidth = 0;
    private lastHeight = 0;
    private destroyed = false;

    private constructor(
        private readonly pixi: PixiModule,
        private readonly options: ElegyRuntimeOptions,
        private readonly app: import('pixi.js').Application,
    ) {
        this.glyphCache = new ElegyGlyphCache({
            fontFamily: options.fontFamily,
            fontWeight: options.fontWeight,
            color: options.theme.primaryColor,
        });
        this.fallbackContainer = new pixi.Container();
        this.handwritingContainer = new pixi.Container();
        app.stage.addChild(this.fallbackContainer, this.handwritingContainer);
    }

    static async create(options: ElegyRuntimeOptions) {
        const pixi = await import('pixi.js');
        const app = new pixi.Application();
        const width = Math.max(options.host.clientWidth, 320);
        const height = Math.max(options.host.clientHeight, 240);
        await app.init({
            width,
            height,
            backgroundAlpha: 0,
            antialias: true,
            autoDensity: true,
            resolution: Math.min(window.devicePixelRatio || 1, 2),
            autoStart: false,
            sharedTicker: false,
            preference: 'webgl',
            powerPreference: 'high-performance',
        });
        const runtime = new ElegyPixiRuntime(pixi, options, app);
        if (options.signal?.aborted) {
            runtime.destroy();
            throw new DOMException('Elegy runtime creation was cancelled', 'AbortError');
        }

        options.host.appendChild(app.canvas);
        app.canvas.style.cssText = 'width:100%;height:100%;display:block';
        runtime.install();
        runtime.setLine(options.initialLine);
        return runtime;
    }

    setLine(line: Line | null) {
        if (this.destroyed || this.activeLine === line) return;
        this.activeLine = line;
        this.requestVersion += 1;
        const version = this.requestVersion;
        this.activeScene = null;
        destroyChildren(this.handwritingContainer);
        this.drawFallback(line);
        this.renderOnce();
        if (!line) return;

        void this.prepareLineScene(line).then(scene => {
            if (this.destroyed || version !== this.requestVersion || this.activeLine !== line) {
                scene.container.destroy({ children: true });
                return;
            }
            destroyChildren(this.handwritingContainer);
            this.handwritingContainer.addChild(scene.container);
            this.activeScene = scene;
            this.layoutScene(scene);
            this.fallbackContainer.visible = false;
            this.renderOnce();
        }).catch(error => {
            if (!this.destroyed) console.warn('[Elegy] Glyph tracing failed; using fade fallback', error);
        });
    }

    prepareLine(line: Line | null | undefined) {
        if (!line || this.destroyed) return;
        const chars = new Set(buildLineGraphemeTimeline(line).map(({ char }) => char));
        chars.forEach(char => {
            void this.glyphCache.prepare(char).catch(() => undefined);
        });
    }

    setPaused(paused: boolean) {
        if (this.destroyed || this.options.paused === paused) return;
        this.options.paused = paused;
        if (paused || this.options.staticMode) {
            this.app.stop();
            this.renderOnce();
        } else {
            this.app.start();
        }
    }

    renderOnce() {
        if (this.destroyed) return;
        this.renderFrame();
        this.app.render();
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.requestVersion += 1;
        this.resizeObserver?.disconnect();
        this.unsubscribeTime?.();
        this.glyphCache.destroy();
        this.textures.forEach(texture => texture.destroy(true));
        this.textures.clear();
        this.app.destroy({ removeView: true }, { children: true, texture: false });
    }

    private install() {
        this.resizeToHost();
        this.app.ticker.add(this.renderFrame);
        this.resizeObserver = new ResizeObserver(() => {
            if (this.resizeToHost()) this.renderOnce();
        });
        this.resizeObserver.observe(this.options.host);
        this.unsubscribeTime = this.options.currentTime.on('change', () => {
            if (this.options.paused || this.options.staticMode) this.renderOnce();
        });
        if (!this.options.paused && !this.options.staticMode) this.app.start();
    }

    private resizeToHost() {
        if (this.destroyed) return false;
        const width = Math.max(this.options.host.clientWidth, 320);
        const height = Math.max(this.options.host.clientHeight, 240);
        if (width === this.lastWidth && height === this.lastHeight) return false;
        this.lastWidth = width;
        this.lastHeight = height;
        this.app.renderer.resize(width, height);
        if (this.activeScene) this.layoutScene(this.activeScene);
        this.layoutFallback();
        return true;
    }

    private drawFallback(line: Line | null) {
        destroyChildren(this.fallbackContainer);
        this.fallbackContainer.visible = true;
        this.fallbackText = null;
        if (!line) return;

        const fontSize = Math.min(Math.max(this.lastWidth * 0.065, 48), 108)
            * this.options.lyricsFontScale;
        const style = new this.pixi.TextStyle({
            fontFamily: this.options.fontFamily,
            fontWeight: String(this.options.fontWeight) as import('pixi.js').TextStyleFontWeight,
            fontSize,
            fill: this.options.theme.primaryColor,
            align: 'center',
            wordWrap: true,
            wordWrapWidth: this.lastWidth * 0.82,
            breakWords: true,
        });
        const text = new this.pixi.Text({ text: line.fullText, style });
        text.anchor.set(0.5);
        this.fallbackContainer.addChild(text);
        this.fallbackText = text;
        this.layoutFallback();
    }

    private layoutFallback() {
        if (!this.fallbackText) return;
        this.fallbackText.position.set(this.lastWidth / 2, this.lastHeight * 0.46);
    }

    private prepareLineScene(line: Line) {
        return buildElegyLineScene(this.pixi, this.glyphCache, this.textures, line);
    }

    private layoutScene(scene: ElegyLineScene) {
        layoutElegyLineScene(
            scene,
            this.lastWidth,
            this.lastHeight,
            this.glyphCache.fontSize,
            this.options.lyricsFontScale,
        );
    }

    private readonly renderFrame = () => {
        const currentTime = this.options.currentTime.get();
        const line = this.activeLine;
        if (this.fallbackText && line) {
            const duration = Math.max(line.endTime - line.startTime, 0.1);
            this.fallbackText.alpha = 0.2 + clamp01((currentTime - line.startTime) / duration) * 0.8;
        }

        const scene = this.activeScene;
        if (!scene) return;
        updateElegyLineScene(scene, currentTime);
    };
}
