import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { animate, motion, motionValue, useAnimationFrame, useMotionValue, useTransform } from 'framer-motion';
import type { AnimationPlaybackControls, MotionValue, Transition } from 'framer-motion';
import { useReducedMotionFor } from '../../hooks/useReducedMotionFor';

// 加载指示：四根跳动的竖条，结束时同样四笔变形成对勾（成功）或叉号（失败）。

export type LoadingBarsStatus = 'loading' | 'success' | 'error';

/**
  * A tiny loader drawn from four strokes. The bars, and the check and cross they end on, is the same four strokes in a new pose,
  * so status changes morph one shape into the next.
  */
export interface LoadingBarsProps {
    /** 成功变为对勾，失败变为叉号，载入中显示四根 bars。 */
    status?: LoadingBarsStatus;
    /** Rendered size in px. The drawing is a 24 unit grid, so 16, 20, 24, and 32 stay crisp. */
    size?: number;
    /** Stroke thickness in grid units. */
    strokeWidth?: number;
    className?: string;
}

/** One stroke: a center, a chord length, a direction in degrees, a bend (1 / radius), a width, and an opacity. */
interface Pose { cx: number; cy: number; len: number; ang: number; bend: number; w: number; o: number }
type Key = keyof Pose;
const KEYS: Key[] = ['cx', 'cy', 'len', 'ang', 'bend', 'w', 'o'];
const COUNT = 4;

const deg = (radians: number) => radians * 180 / Math.PI;
const rad = (degrees: number) => degrees * Math.PI / 180;
/** A straight stroke between two points. */
const line = (x1: number, y1: number, x2: number, y2: number, w: number): Pose =>
    ({ cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, len: Math.hypot(x2 - x1, y2 - y1), ang: deg(Math.atan2(y2 - y1, x2 - x1)), bend: 0, w, o: 1 });
function poses(shape: 'bars' | 'success' | 'error', stroke: number): Pose[] {
    switch (shape) {
        case 'bars': return [4.5, 9.5, 14.5, 19.5].map(x => line(x, 6, x, 18, stroke));
        case 'success': return [line(5, 12.5, 7.6, 15.1, stroke), line(7.6, 15.1, 10.2, 17.7, stroke), line(10.2, 17.7, 14.6, 12.6, stroke), line(14.6, 12.6, 19, 7.5, stroke)];
        case 'error': return [line(6.5, 6.5, 12, 12, stroke), line(12, 12, 17.5, 17.5, stroke), line(17.5, 6.5, 12, 12, stroke), line(12, 12, 6.5, 17.5, stroke)];
    }
}

/** Draws one stroke. A bend near zero is a straight line; anything more is an arc through the same end points. */
function draw(p: Pose) {
    const half = Math.max(p.len, .01) / 2, a = rad(p.ang), dx = Math.cos(a) * half, dy = Math.sin(a) * half;
    const x1 = (p.cx - dx).toFixed(3), y1 = (p.cy - dy).toFixed(3), x2 = (p.cx + dx).toFixed(3), y2 = (p.cy + dy).toFixed(3);
    if (Math.abs(p.bend) < .004) return `M${x1} ${y1}L${x2} ${y2}`;
    const r = (1 / Math.abs(p.bend)).toFixed(3);
    return `M${x1} ${y1}A${r} ${r} 0 0 ${p.bend > 0 ? 1 : 0} ${x2} ${y2}`;
}

/** The shortest turn to a new direction. Straight strokes look the same reversed, so they may also flip by 180 degrees. */
function nearestAngle(from: number, to: number, symmetric: boolean) {
    const period = symmetric ? 180 : 360;
    return to + Math.round((from - to) / period) * period;
}

/** Stroke characters restated as stiffness and damping so a retarget keeps its velocity mid flight. */
const physical = (visualDuration: number, bounce: number): Transition => {
    const root = 2 * Math.PI / (visualDuration * 1.2);
    return { type: 'spring', stiffness: root * root, damping: 2 * (1 - bounce) * root, mass: 1, restDelta: .001, restSpeed: .01 };
};
const MORPH = physical(.46, 0), SETTLE = physical(.52, 0);

function Stroke({ values, wave }: { values: Record<Key, MotionValue<number>>; wave: MotionValue<Partial<Pose>> }) {
    const d = useTransform(() => {
        const extra = wave.get();
        const pose = {} as Pose;
        for (const key of KEYS) pose[key] = values[key].get() + (extra[key] ?? 0);
        return draw(pose);
    });
    const width = useTransform(() => Math.max(0, values.w.get() + (wave.get().w ?? 0)));
    const opacity = useTransform(() => Math.min(1, Math.max(0, values.o.get())));
    return <motion.path d={d} strokeWidth={width} opacity={opacity} />;
}

export function LoadingBars({
    status = 'loading', size = 32, strokeWidth = 2.5,
    className,
}: LoadingBarsProps) {
    const reduced = useReducedMotionFor('uiMicroMotion');
    const shape = status === 'loading' ? 'bars' : status;

    // Four strokes, seven values each. They spring independently, so an interruption keeps every value's velocity.
    const [strokes] = useState(() => poses(shape, strokeWidth).map(pose =>
        Object.fromEntries(KEYS.map(key => [key, motionValue(pose[key])])) as Record<Key, MotionValue<number>>));
    // Per-stroke offsets and how much of the loading wave remains during a result transition.
    const [waves] = useState(() => Array.from({ length: COUNT }, () => motionValue<Partial<Pose>>({})));
    const amount = useMotionValue(status === 'loading' ? 1 : 0);
    const pop = useMotionValue(1);
    const clock = useRef(0);
    const shapeRef = useRef(shape);
    useLayoutEffect(() => { shapeRef.current = shape; }, [shape]);

    useEffect(() => {
        const target = poses(shape, strokeWidth);
        const controls: AnimationPlaybackControls[] = [];
        const settling = shape === 'success' || shape === 'error';
        target.forEach((pose, index) => {
            const values = strokes[index];
            KEYS.forEach(key => {
                const value = values[key];
                let to = pose[key];
                if (key === 'ang') to = nearestAngle(value.get(), to, pose.bend === 0 && values.bend.get() < .004);
                if (reduced) { value.set(to); return; }
                // The check draws itself in stroke order; loading shapes gather all at once.
                const delay = settling ? index * .035 : 0;
                controls.push(animate(value, to, { ...(settling ? SETTLE : MORPH), delay }));
            });
        });
        if (reduced) {
            amount.set(settling ? 0 : 1);
            waves.forEach(wave => wave.set({}));
            pop.set(1);
            return;
        }
        controls.push(animate(amount, settling ? 0 : 1, settling ? { duration: .2, ease: [.2, .8, .2, 1] } : { duration: .3, ease: [.2, .8, .2, 1] }));
        if (settling) {
            controls.push(animate(pop, [1, 1.14, 1], { duration: .42, times: [0, .35, 1], ease: ['easeOut', 'easeInOut'] }));
        }
        return () => {
            controls.forEach(control => control.stop());
        };
    }, [shape, strokeWidth, reduced, amount, pop, strokes, waves]);

    useAnimationFrame((_, delta) => {
        if (reduced) return;
        const loading = shapeRef.current !== 'success' && shapeRef.current !== 'error';
        const k = amount.get();
        if (!loading && k < .001) return;
        const dt = Math.min(delta, 64) / 1000;
        clock.current += dt * (loading ? 1 : k);
        const t = clock.current;
        const current = shapeRef.current;
        const offsets: Partial<Pose>[] = [{}, {}, {}, {}];
        if (current === 'bars') {
            for (let i = 0; i < COUNT; i += 1) {
                const phase = .5 + .5 * Math.sin((t / .95) * Math.PI * 2 - i * .7);
                offsets[i] = { len: -7.5 * (1 - phase) * k };
            }
        }
        waves.forEach((wave, index) => wave.set(offsets[index]));

    });

    const transform = useTransform(() => `scale(${pop.get().toFixed(4)})`);

    return <span className={`inline-flex shrink-0 items-center justify-center ${className ?? ''}`} data-status={status}
        style={{ width: size, height: size }} aria-hidden='true'>
        <svg className='block' viewBox='0 0 24 24' width={size} height={size} fill='none' stroke='currentColor' strokeLinecap='round' aria-hidden='true' focusable='false'>
            <motion.g style={{ transform, transformOrigin: '12px 12px', transformBox: 'view-box' }}>
                {strokes.map((values, index) => <Stroke key={index} values={values} wave={waves[index]} />)}
            </motion.g>
        </svg>
    </span>;
}
