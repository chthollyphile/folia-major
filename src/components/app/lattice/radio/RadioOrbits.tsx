import { memo, useEffect, useRef, type RefObject } from 'react';
import type { MotionValue } from 'framer-motion';
import { bass } from '../../../../stores/motionSignals';
import { RADIO_WAVE_TURN_DEG, radioUpperRings, radioWaveCenter, type RadioMetrics } from './radioWallModel';

// src/components/app/lattice/radio/RadioOrbits.tsx
// 电台墙上半屏的动态装饰，画在一块 canvas 上（只占窗口上半）：
// - 信号包：一小截带渐隐尾巴的弧，沿上部轨道（radioUpperRings）慢慢滑过去，相邻两道方向相反；跟着同心圆一起随卡牌
//   的轨道转（读 rail，和 SVG 那一层同一个转角）。
// - 发射点的电波：从左上角发射点一圈圈往外扩散、变淡，跟着低频（motionSignals.bass）的起伏发出，太久没发时补一圈。
// - 发射点外的两道小轨道，上面几颗卫星点慢慢绕；其中一颗用强调色。
// 只在播放时跑 requestAnimationFrame，最多 60 帧；暂停、降低动态效果时停在一帧上，浏览（轨道转动）时重画这一帧。
// 不进 React state；颜色读 CSS（墨色、强调色），尺寸变时重量。

/**
 * 两帧之间至少隔多久（ms）：最多 60 帧。60Hz 的屏每帧都画，高刷屏隔一帧画一次。留 4ms 余量：帧间隔会有抖动，
 * 卡着整 16.7ms 判的话 60Hz 屏上会时不时跳过一帧，看着一顿一顿的。
 */
const FRAME_MS = 1000 / 60 - 4;
/** 画布的像素比上限：都是细线和小点，再高只是多传像素。 */
const MAX_PIXEL_RATIO = 1.5;

/** 信号包：每道轨道几个，弧长（px），速度（px/s，按轨道递增）。 */
const PACKETS_PER_RING = 2;
const PACKET_LENGTH_PX = 64;
const PACKET_SPEED_PX = [16, 24, 20] as const;
/** 尾巴分几段画（越往后越淡）。 */
const PACKET_SEGMENTS = 6;

/** 发射点的电波：从发射点半径的几倍扩到几倍、用多久（s）；两圈至少隔多久，最多多久补一圈（ms）。 */
const RIPPLE_FROM = 0.33;
const RIPPLE_TO = 1.65;
const RIPPLE_SECONDS = 2.6;
const RIPPLE_MIN_GAP_MS = 700;
const RIPPLE_IDLE_GAP_MS = 3200;
/** 低频比它最近的平均高出这么多、而且至少这么响，才算一下鼓点。 */
const RIPPLE_BASS_RISE = 1.3;
const RIPPLE_BASS_FLOOR = 0.35;
const MAX_RIPPLES = 6;

/** 卫星轨道：半径（发射点半径的倍数）、绕一圈的秒数、卫星的起始角（度），以及哪一颗是强调色。 */
const SATELLITE_ORBITS = [
    { scale: 1.22, period: 38, dots: [40], accent: 0 },
    { scale: 1.5, period: 64, dots: [160, 340], accent: -1 },
] as const;

type Transmitter = { x: number; y: number; r: number };

type RadioOrbitsProps = {
    metrics: RadioMetrics;
    /** 卡牌的轨道位置（RadioWall）：信号包和同心圆一起按它转。 */
    rail: MotionValue<number>;
    playing: boolean;
    reducedMotion: boolean;
    /** 发射点那一块（RadioBackdrop）：它用 vw / vh 摆，位置大小在这里量出来。 */
    transmitterRef: RefObject<HTMLDivElement | null>;
};

function RadioOrbits({ metrics, rail, playing, reducedMotion, transmitterRef }: RadioOrbitsProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    // 跨过播放 / 暂停留着：暂停时停在当时的那一帧，继续时接着走，不从头来。
    const elapsedRef = useRef(0);
    const ripplesRef = useRef<number[]>([]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context) return;
        const center = radioWaveCenter(metrics);
        const rings = radioUpperRings(metrics);
        const ripples = ripplesRef.current;
        let width = 0;
        let height = 0;
        let ratio = 1;
        let ink = '#f7f4ee';
        let accent = '#fd5c47';
        let transmitter: Transmitter | null = null;
        let raf = 0;
        let lastFrame = 0;
        let lastTick = 0;
        let lastRipple = elapsedRef.current;
        let bassAverage = 0;

        const measure = () => {
            const box = canvas.getBoundingClientRect();
            ratio = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1);
            width = box.width;
            height = box.height;
            canvas.width = Math.max(1, Math.round(width * ratio));
            canvas.height = Math.max(1, Math.round(height * ratio));
            const style = getComputedStyle(canvas);
            ink = style.color || ink;
            accent = style.getPropertyValue('--radio-accent').trim() || accent;
            const figure = transmitterRef.current;
            if (figure) {
                const rect = figure.getBoundingClientRect();
                transmitter = {
                    x: rect.left - box.left + rect.width / 2,
                    y: rect.top - box.top + rect.height / 2,
                    r: Math.min(rect.width, rect.height) / 2,
                };
            }
        };

        // 角度从圆顶量起（正数在右）换成 canvas 的角度（从 +x 起顺时针）。
        const toCanvasAngle = (fromTop: number) => fromTop - Math.PI / 2;

        const drawPackets = (seconds: number, turn: number) => {
            context.lineCap = 'round';
            context.lineWidth = 2;
            rings.forEach((radius, index) => {
                // 只在窗口宽度以内那一段走，走出去从另一头回来。
                const span = Math.asin(Math.min(1, (width / 2 + PACKET_LENGTH_PX * 2) / radius));
                const sweep = span * 2;
                const speed = (PACKET_SPEED_PX[index] ?? 18) / radius;
                const direction = index % 2 === 0 ? 1 : -1;
                const length = PACKET_LENGTH_PX / radius;
                for (let packet = 0; packet < PACKETS_PER_RING; packet += 1) {
                    const base = (packet / PACKETS_PER_RING + index * 0.37) * sweep;
                    const travelled = (((base + seconds * speed) % sweep) + sweep) % sweep;
                    const head = (direction > 0 ? travelled - span : span - travelled) + turn;
                    for (let segment = 0; segment < PACKET_SEGMENTS; segment += 1) {
                        const from = head - direction * length * (1 - segment / PACKET_SEGMENTS);
                        const to = head - direction * length * (1 - (segment + 1) / PACKET_SEGMENTS);
                        context.globalAlpha = 0.08 + 0.5 * ((segment + 1) / PACKET_SEGMENTS) ** 2;
                        context.beginPath();
                        context.arc(center.x, center.y, radius, toCanvasAngle(Math.min(from, to)), toCanvasAngle(Math.max(from, to)));
                        context.stroke();
                    }
                    context.globalAlpha = 0.75;
                    context.beginPath();
                    context.arc(center.x + radius * Math.sin(head), center.y - radius * Math.cos(head), 2.2, 0, Math.PI * 2);
                    context.fill();
                }
            });
        };

        const drawTransmitter = (seconds: number) => {
            if (!transmitter) return;
            const { x, y, r } = transmitter;
            context.lineWidth = 1;
            for (const birth of ripples) {
                const progress = (seconds - birth) / RIPPLE_SECONDS;
                if (progress < 0 || progress >= 1) continue;
                const eased = 1 - (1 - progress) ** 2;
                context.globalAlpha = 0.32 * (1 - progress) ** 1.5;
                context.beginPath();
                context.arc(x, y, r * (RIPPLE_FROM + (RIPPLE_TO - RIPPLE_FROM) * eased), 0, Math.PI * 2);
                context.stroke();
            }
            SATELLITE_ORBITS.forEach(orbit => {
                const radius = r * orbit.scale;
                context.globalAlpha = 0.12;
                context.setLineDash([2, 8]);
                context.beginPath();
                context.arc(x, y, radius, 0, Math.PI * 2);
                context.stroke();
                context.setLineDash([]);
                orbit.dots.forEach((start, dot) => {
                    const angle = start * Math.PI / 180 + (seconds / orbit.period) * Math.PI * 2;
                    const isAccent = dot === orbit.accent;
                    context.globalAlpha = isAccent ? 1 : 0.55;
                    context.fillStyle = isAccent ? accent : ink;
                    context.beginPath();
                    context.arc(x + radius * Math.cos(angle), y + radius * Math.sin(angle), isAccent ? 3.5 : 2.5, 0, Math.PI * 2);
                    context.fill();
                    context.fillStyle = ink;
                });
            });
        };

        const draw = () => {
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
            context.clearRect(0, 0, width, height);
            if (width === 0 || height === 0) return;
            const seconds = elapsedRef.current;
            const turn = -rail.get() * RADIO_WAVE_TURN_DEG * Math.PI / 180;
            context.strokeStyle = ink;
            context.fillStyle = ink;
            drawPackets(seconds, turn);
            drawTransmitter(seconds);
            context.globalAlpha = 1;
        };

        // 跟着低频发一圈电波：比最近的平均明显高、而且够响才算；太久没发时补一圈，安静的段落也有动静。
        const listen = (seconds: number) => {
            const level = bass.get();
            bassAverage += (level - bassAverage) * 0.05;
            const sinceLast = (seconds - lastRipple) * 1000;
            const beat = level > RIPPLE_BASS_FLOOR && level > bassAverage * RIPPLE_BASS_RISE && sinceLast > RIPPLE_MIN_GAP_MS;
            if (beat || sinceLast > RIPPLE_IDLE_GAP_MS) {
                ripples.push(seconds);
                lastRipple = seconds;
            }
            while (ripples.length > 0 && (ripples.length > MAX_RIPPLES || seconds - ripples[0] > RIPPLE_SECONDS)) ripples.shift();
        };

        const tick = (now: number) => {
            raf = requestAnimationFrame(tick);
            if (now - lastFrame < FRAME_MS) return;
            // 切到别的窗口回来时 rAF 停过：不把那一大段补上，免得信号包一下子跳很远。
            const delta = lastTick === 0 ? 0 : Math.min(0.1, (now - lastTick) / 1000);
            lastTick = now;
            lastFrame = now;
            elapsedRef.current += delta;
            listen(elapsedRef.current);
            draw();
        };

        measure();
        const observer = new ResizeObserver(() => {
            measure();
            draw();
        });
        observer.observe(canvas);
        const animates = playing && !reducedMotion;
        if (animates) raf = requestAnimationFrame(tick);
        else draw();
        // 停着的时候，浏览（轨道转动）要把信号包跟着转过去：轨道一动就排一帧重画（同一帧里只画一次）。
        let pending = 0;
        const unsubscribe = rail.on('change', () => {
            if (animates || pending) return;
            pending = requestAnimationFrame(() => {
                pending = 0;
                draw();
            });
        });
        return () => {
            cancelAnimationFrame(raf);
            cancelAnimationFrame(pending);
            unsubscribe();
            observer.disconnect();
        };
    }, [metrics, playing, rail, reducedMotion, transmitterRef]);

    return <canvas ref={canvasRef} className="lattice-radio-orbits" />;
}

export default memo(RadioOrbits);
