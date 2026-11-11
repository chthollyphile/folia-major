import React from 'react';
import type { MotionValue } from 'framer-motion';
import type { Line, Theme } from '../../../types';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import { getRelativeLuminance } from '../../../utils/themeColorMath';
import type { TesseraFill } from './tesseraBackdrop';
import { drawTesseraFrame, tesseraFrameMoving, type TesseraPalette } from './tesseraDraw';
import { buildTesseraPlan, type TesseraMeasure } from './tesseraPlan';

// src/components/visualizer/tessera/TesseraBoard.tsx
// 方块字的画布：整首歌排一次（字体加载完再排一次），之后每帧读 currentTime 画到 canvas 上，不经过 React state。
// 播放时由 requestAnimationFrame 一直画；暂停时停掉循环，只在拖进度、换输入、改尺寸时补画一帧。

export interface TesseraBoardProps {
    lines: Line[];
    currentTime: MotionValue<number>;
    theme: Theme;
    showGrid?: boolean;
    /** 画布自己铺多大的背景色（tesseraBackdrop.ts）。 */
    fill?: TesseraFill;
    showText?: boolean;
    paused?: boolean;
}

const FALLBACK_FONT_WEIGHT = 600;
const MEASURE_LIMIT = 4096;

/** 用离屏 canvas 量 em 宽，按字缓存。 */
const createMeasure = (fontStack: string, fontWeight: number): TesseraMeasure => {
    const ctx = document.createElement('canvas').getContext('2d');
    const cache = new Map<string, number>();
    if (ctx) ctx.font = `${fontWeight} 100px ${fontStack}`;
    return text => {
        const cached = cache.get(text);
        if (cached !== undefined) return cached;
        // 量不了时按全角算，排出来只会偏宽。
        const width = ctx ? ctx.measureText(text).width / 100 : text.length;
        if (cache.size >= MEASURE_LIMIT) cache.clear();
        cache.set(text, width);
        return width;
    };
};

const TesseraBoard: React.FC<TesseraBoardProps> = ({
    lines,
    currentTime,
    theme,
    showGrid = false,
    fill = 'none',
    showText = true,
    paused = false,
}) => {
    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    const fontStack = resolveThemeFontStack(theme);
    const fontWeight = resolveThemeFontWeight(theme, FALLBACK_FONT_WEIGHT);
    // 字体加载完以后再排一次：之前量的可能是后备字体的宽度。
    const [fontsVersion, setFontsVersion] = React.useState(0);
    React.useEffect(() => {
        // 挂上时字体已经都到了（切样式、换主题时通常如此）：不用再排第二遍。
        if (document.fonts.status === 'loaded') return;
        let cancelled = false;
        void document.fonts.ready.then(() => {
            if (!cancelled) setFontsVersion(version => version + 1);
        });
        return () => {
            cancelled = true;
        };
    }, [fontStack]);

    const plan = React.useMemo(
        () => buildTesseraPlan(lines, createMeasure(fontStack, fontWeight)),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- fontsVersion 只用来在字体到了以后重排，回调里用不到它。
        [lines, fontStack, fontWeight, fontsVersion],
    );

    const palette = React.useMemo<TesseraPalette>(() => ({
        ink: getRelativeLuminance(theme.backgroundColor) > 0.4 ? '#000000' : '#ffffff',
        text: theme.primaryColor,
        background: theme.backgroundColor,
    }), [theme.backgroundColor, theme.primaryColor]);

    // 每帧要读的东西放进 ref，画布循环只在暂停与否变化时重建；输入一变就补画一帧（暂停时靠它）。
    const frameInput = React.useRef({ plan, palette, fontStack, fontWeight, showGrid, fill, showText });
    const drawRef = React.useRef<(() => void) | null>(null);
    React.useLayoutEffect(() => {
        frameInput.current = { plan, palette, fontStack, fontWeight, showGrid, fill, showText };
        drawRef.current?.();
    }, [plan, palette, fontStack, fontWeight, showGrid, fill, showText]);

    React.useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;
        let width = 0;
        let height = 0;
        let dpr = 1;
        // 上一帧是不是空闲帧（没有方块在动）：连着空闲时画面不变，循环里跳过不画。
        let idleDrawn = false;
        const draw = () => {
            const t = currentTime.get();
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            drawTesseraFrame(ctx, { ...frameInput.current, t, width, height });
            idleDrawn = !tesseraFrameMoving(frameInput.current.plan, t);
        };
        const resize = () => {
            const rect = canvas.getBoundingClientRect();
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            width = rect.width;
            height = rect.height;
            canvas.width = Math.max(1, Math.round(width * dpr));
            canvas.height = Math.max(1, Math.round(height * dpr));
            draw();
        };
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(canvas);
        drawRef.current = draw;

        let frame = 0;
        let unsubscribe: (() => void) | null = null;
        if (paused) {
            unsubscribe = currentTime.on('change', draw);
        } else {
            const loop = () => {
                frame = requestAnimationFrame(loop);
                // 前奏、间奏、纯音乐：画过一帧空闲画面后就不再重画，直到又有方块要动（输入和尺寸变了另有补画）。
                if (idleDrawn && !tesseraFrameMoving(frameInput.current.plan, currentTime.get())) return;
                draw();
            };
            frame = requestAnimationFrame(loop);
        }
        return () => {
            cancelAnimationFrame(frame);
            unsubscribe?.();
            observer.disconnect();
            drawRef.current = null;
        };
    }, [currentTime, paused]);

    return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />;
};

export default TesseraBoard;
