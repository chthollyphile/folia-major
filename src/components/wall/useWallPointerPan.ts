// src/components/wall/useWallPointerPan.ts

import { animate } from 'framer-motion';
import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent, type MouseEvent, type RefObject } from 'react';
import type { Bounds } from './layout';
import type { LatticeCamera } from './useWallCameraPan';
import { createWallWheelClassifier, stepWallWheel, wallWheelDelta, WALL_PAN_INERTIA } from './wallPanMotion';

// Drag and wheel panning. Camera writes bypass React state; only the cull bounds are published.
// 鼠标滚轮平滑、触控板直接跟手（判别与参数见 wallPanMotion.ts）。平滑滚动占用共享的 animationRef，
// 所以 panTo / bravais 的补间、按下拖动、键盘输入一开始就会把它停在原地；降低动效时滚轮也一帧到位。

const DRAG_THRESHOLD_PX = 7;
const CULL_EDGE_MARGIN_PX = 180;
// 两下 wheel 之间隔得比这短就算同一次手势（触控板 / 惯性约 16ms 一下；停手再滚是新手势，按光标下面的东西重新算）。
const WHEEL_LATCH_MS = 160;
// 锁定期间光标挪开超过这么多才算换了目标（墙在光标下滑动时浏览器补发的 pointermove 坐标不变）。
const LATCH_MOVE_PX = 4;

type WallPointerPanOptions = {
    /** pointer 标记拖拽及其释放惯性，供宿主单独合并写入；滚轮不加这一层插值。 */
    applyCamera: (camera: LatticeCamera, updateBounds?: boolean, source?: 'pointer') => void;
    animationRef: MutableRefObject<{ stop: () => void } | null>;
    stopPan: () => void;
    containerRef: RefObject<HTMLDivElement | null>;
    reducedMotion: boolean | null;
    overscan: number;
    bounds: Bounds;
    cameraRef: MutableRefObject<LatticeCamera>;
    getWorldBounds: (camera: LatticeCamera, viewport: { width: number; height: number }) => Bounds;
    viewportRef: MutableRefObject<{ width: number; height: number }>;
};

export const useWallPointerPan = ({
    applyCamera, animationRef, stopPan, containerRef, reducedMotion, overscan,
    bounds, cameraRef, getWorldBounds, viewportRef,
}: WallPointerPanOptions) => {
    const boundsRef = useRef(bounds);
    boundsRef.current = bounds;
    const pointerRef = useRef<{
        id: number;
        start: { x: number; y: number };
        camera: { x: number; y: number };
        last: { x: number; y: number; time: number };
        vx: number;
        vy: number;
        dragged: boolean;
    } | null>(null);
    // Read by the poster click handler so a drag that ends on a card does not open it.
    const didDragRef = useRef(false);

    // Republishing bounds is what triggers a re-cull, so only do it near the edge of what is culled.
    const updateCamera = useCallback((x: number, y: number, source?: 'pointer') => {
        const next = { ...cameraRef.current, x, y };
        const visible = getWorldBounds(next, viewportRef.current);
        const culled = boundsRef.current;
        const padding = overscan - CULL_EDGE_MARGIN_PX;
        const nearCullEdge = visible.left < culled.left - padding
            || visible.right > culled.right + padding
            || visible.top < culled.top - padding
            || visible.bottom > culled.bottom + padding;
        applyCamera(next, nearCullEdge, source);
    }, [applyCamera, cameraRef, getWorldBounds, overscan, viewportRef]);

    const interrupt = useCallback(() => {
        stopPan();
    }, [stopPan]);

    const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || !event.isPrimary || pointerRef.current) return;
        interrupt();
        didDragRef.current = false;
        // Panning stays available while a card is open, but a drag that starts on the open card
        // belongs to its own controls - the progress bar seeks by dragging.
        // Only actual controls are excluded; the cover, title and surrounding space can pan.
        if (event.target instanceof Element && event.target.closest('button, input, select, textarea, a, [contenteditable="true"], [role="slider"]')) return;
        pointerRef.current = {
            id: event.pointerId,
            start: { x: event.clientX, y: event.clientY },
            camera: { x: cameraRef.current.x, y: cameraRef.current.y },
            last: { x: event.clientX, y: event.clientY, time: event.timeStamp },
            vx: 0, vy: 0, dragged: false,
        };
    }, [cameraRef, interrupt]);

    const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
        const pointer = pointerRef.current;
        if (!pointer || pointer.id !== event.pointerId) return;
        const dx = event.clientX - pointer.start.x;
        const dy = event.clientY - pointer.start.y;
        if (!pointer.dragged && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
            pointer.dragged = true;
            didDragRef.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
        }
        const elapsed = event.timeStamp - pointer.last.time;
        if (elapsed > 0) {
            pointer.vx = (event.clientX - pointer.last.x) / elapsed * 1000;
            pointer.vy = (event.clientY - pointer.last.y) / elapsed * 1000;
        }
        pointer.last = { x: event.clientX, y: event.clientY, time: event.timeStamp };
        if (pointer.dragged) updateCamera(pointer.camera.x + dx, pointer.camera.y + dy, 'pointer');
    }, [updateCamera]);

    // Continue along the release velocity; stale samples and cancelled gestures never coast.
    const onPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
        const pointer = pointerRef.current;
        if (!pointer || pointer.id !== event.pointerId) return;
        pointerRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        if (!pointer.dragged || reducedMotion || event.timeStamp - pointer.last.time > WALL_PAN_INERTIA.staleReleaseMs) return;
        const speed = Math.hypot(pointer.vx, pointer.vy);
        if (speed < WALL_PAN_INERTIA.minSpeed) return;
        const from = cameraRef.current;
        const velocity = Math.min(speed, WALL_PAN_INERTIA.maxSpeed);
        animationRef.current = animate(0, velocity * WALL_PAN_INERTIA.power, {
            type: 'inertia', velocity, power: WALL_PAN_INERTIA.power, timeConstant: WALL_PAN_INERTIA.timeConstant,
            restDelta: WALL_PAN_INERTIA.restDelta,
            onUpdate: distance => updateCamera(from.x + distance * pointer.vx / speed, from.y + distance * pointer.vy / speed, 'pointer'),
        });
    }, [animationRef, cameraRef, reducedMotion, updateCamera]);

    const onPointerCancel = useCallback((event: PointerEvent<HTMLDivElement>) => {
        if (pointerRef.current?.id !== event.pointerId) return;
        pointerRef.current = null;
        interrupt();
    }, [interrupt]);

    const onClickCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
        if (!didDragRef.current || event.detail === 0) return;
        didDragRef.current = false;
        event.preventDefault();
        event.stopPropagation();
    }, []);

    // 平滑滚轮的状态：还没走完的屏幕位移、下一帧、上一帧的时刻。运行时它的 handle 就挂在 animationRef 上。
    const wheelRef = useRef<{
        pending: { x: number; y: number };
        frame: number | null;
        lastTime: number | null;
        handle: { stop: () => void };
    } | null>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const classify = createWallWheelClassifier();
        // 交接（翻牌到另一面墙）期间不接滚轮，正在平滑的也停下：交接要按此刻的相机量磁贴位置。
        const inHandoff = () => Boolean(container.closest('[data-wall-handoff]'));
        const stopWheel = () => {
            const wheel = wheelRef.current;
            if (!wheel) return;
            if (wheel.frame !== null) cancelAnimationFrame(wheel.frame);
            wheelRef.current = null;
            if (animationRef.current === wheel.handle) animationRef.current = null;
        };
        const tick = (now: number) => {
            const wheel = wheelRef.current;
            if (!wheel) return;
            wheel.frame = null;
            if (inHandoff()) {
                stopWheel();
                return;
            }
            const dt = wheel.lastTime === null ? 1000 / 60 : now - wheel.lastTime;
            wheel.lastTime = now;
            const { step, pending } = stepWallWheel(wheel.pending, dt);
            const from = cameraRef.current;
            const requested = { x: from.x + step.x, y: from.y + step.y };
            updateCamera(requested.x, requested.y);
            // 宿主钳制了相机（bravais 有限拼贴的边界）：这个轴上剩下的位移作废，免得反向滚动要先抵掉顶在边上的那段。
            const actual = cameraRef.current;
            wheel.pending = {
                x: Math.abs(actual.x - requested.x) > 0.5 ? 0 : pending.x,
                y: Math.abs(actual.y - requested.y) > 0.5 ? 0 : pending.y,
            };
            if (wheel.pending.x === 0 && wheel.pending.y === 0) {
                stopWheel();
                return;
            }
            wheel.frame = requestAnimationFrame(tick);
        };
        // 一次滚动手势锁定在墙上：触控板双指平移时光标不动、墙在动，叠在墙上的东西（bravais 的海报缝）会滑到光标下面，
        // 之后的 wheel 落到它身上、不再经过墙——上一下 wheel 不久之前还在推墙，就接着算墙的（同浏览器原生滚动的锁定）。
        // 锁定时才在 window 上挂监听（平时不拦整页的 wheel）；隔 WHEEL_LATCH_MS 没有 wheel 或光标真的挪开了就解开——
        // 惯性还没停时把光标移到缝里的列表上再滚，滚的是列表，不是墙。
        let latch: { timer: number; x: number; y: number } | null = null;
        const releaseLatch = () => {
            if (!latch) return;
            window.clearTimeout(latch.timer);
            latch = null;
            window.removeEventListener('wheel', onLatchedWheel, { capture: true });
            window.removeEventListener('pointermove', onLatchMove, true);
        };
        const holdLatch = (event: WheelEvent) => {
            if (!latch) {
                latch = { timer: 0, x: event.clientX, y: event.clientY };
                window.addEventListener('wheel', onLatchedWheel, { passive: false, capture: true });
                window.addEventListener('pointermove', onLatchMove, true);
            }
            window.clearTimeout(latch.timer);
            latch.timer = window.setTimeout(releaseLatch, WHEEL_LATCH_MS);
        };
        const onLatchMove = (event: globalThis.PointerEvent) => {
            if (latch && Math.hypot(event.clientX - latch.x, event.clientY - latch.y) > LATCH_MOVE_PX) releaseLatch();
        };
        const onLatchedWheel = (event: WheelEvent) => {
            if (event.target instanceof Node && container.contains(event.target)) return;
            event.stopPropagation();
            onWheel(event);
        };
        const onWheel = (event: WheelEvent) => {
            if (event.ctrlKey || event.metaKey) return;
            event.preventDefault();
            holdLatch(event);
            if (pointerRef.current || inHandoff()) return;
            const source = classify(event);
            const { dx, dy } = wallWheelDelta(event, viewportRef.current.height);
            let wheel = wheelRef.current;
            if (source === 'trackpad' || reducedMotion) {
                // 直接跟手：把还没走完的平滑位移一并补上，当帧到位（滚动总量与输入一致）。
                const carry = wheel && animationRef.current === wheel.handle ? wheel.pending : { x: 0, y: 0 };
                stopPan();
                stopWheel();
                const from = cameraRef.current;
                updateCamera(from.x + carry.x - dx, from.y + carry.y - dy);
                return;
            }
            // 鼠标滚轮：位移叠加到剩余里，正在平滑就接着追；否则先停掉别的相机动画（补间、惯性）再起一段。
            if (!wheel || animationRef.current !== wheel.handle) {
                stopPan();
                stopWheel();
                const next = {
                    pending: { x: 0, y: 0 },
                    frame: null,
                    lastTime: null,
                    handle: { stop: () => { if (wheelRef.current === next) stopWheel(); } },
                };
                wheel = next;
                wheelRef.current = next;
                animationRef.current = next.handle;
            }
            wheel.pending = { x: wheel.pending.x - dx, y: wheel.pending.y - dy };
            if (wheel.frame === null) wheel.frame = requestAnimationFrame(tick);
        };
        const cancel = () => { pointerRef.current = null; interrupt(); };
        // 只按修饰键（按住 Shift 横向滚动时 Shift 会自动重复 keydown）不算键盘输入，不打断平滑滚动。
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta') return;
            cancel();
        };
        const endOutside = (event: globalThis.PointerEvent) => {
            if (pointerRef.current?.id === event.pointerId) cancel();
        };
        window.addEventListener('pointerup', endOutside);
        window.addEventListener('pointercancel', endOutside);
        container.addEventListener('wheel', onWheel, { passive: false });
        container.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('blur', cancel);
        return () => {
            container.removeEventListener('wheel', onWheel);
            releaseLatch();
            container.removeEventListener('keydown', onKeyDown, true);
            window.removeEventListener('blur', cancel);
            window.removeEventListener('pointerup', endOutside);
            window.removeEventListener('pointercancel', endOutside);
            cancel();
            stopWheel();
        };
    }, [animationRef, cameraRef, containerRef, interrupt, reducedMotion, stopPan, updateCamera, viewportRef]);

    return { didDragRef, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture };
};
