import { useLayoutEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import { buildPlatePath, type PlateBlock, type PlateBlockSet, type PlateRect } from './bravaisBlockPlate';
import { BRAVAIS_BLOCK_SHAPE, shapeSlotFromKey, type BravaisWallShape } from './bravaisWallShape';
import { BRAVAIS_REFLOW_MS, bravaisReflowEase } from './bravaisReflowMotion';

// src/library/suites/bravais/useBravaisReflowDriver.ts
// 聚焦卡块内让位（展开、同块换卡、收起 / 换块时的归位）由这里逐帧驱动：同一个 rAF 回调里先写块里各磁贴外框的
// 位置与尺寸（内联样式，不经过 React），再按它们此刻的矩形重画这些块的透光底板路径（<path d>）。
// 2026-10-09 之前让位是外框上的 CSS 过渡、底板在主线程逐帧跟：transform 过渡跑在合成线程上，visualizer 占着主线程时
// 底板的洞落后好几帧，窗磁贴移出洞外，看上去是一块实心（用户实测）。改成磁贴与洞在同一帧里写，主线程再忙也只是
// 掉帧，两者不会错开。缓动与时长仍是 Lattice 的让位弹簧（bravaisReflowMotion）。
// - 每个动的 slot 一条轨迹：起点是它此刻画着的矩形（被打断时从当时的位置起步），终点是 React 渲染的落定矩形；
//   React 提交后、绘制前（useLayoutEffect）就把外框拉回起点，所以没有闪一下终点。放完写回终点（与 React 渲染的
//   样式是同一个字符串），摘掉标记。
// - 动着的磁贴挂 data-bravais-reflowing，正在逐帧重画的底板挂 data-bravais-plate-live（用例据此等落定）。
// - 降低动态效果时不动：直接是 React 渲染的落定矩形。
// - 轨迹记着排它时墙的形状。墙换了形状（探索页签与别的页签互换、探索页换形状）时，旧形状上还没放完的轨迹作废，
//   磁贴写回 React 此刻渲染的矩形：同一个 slot 键在新形状上是另一块矩形，磁贴也已按新形状重新挂载，接着写会把旧形状
//   的矩形写进新磁贴，React 之后不会改回来。收起的归位（约 650ms）与换形状的整墙出场（约 660ms）几乎一样长，晚一帧
//   就写坏（2026-10-18 用户实测：探索页展开一首歌再换页签，那一块的磁贴叠在一起）。

export const BRAVAIS_REFLOWING_ATTRIBUTE = 'data-bravais-reflowing';
const PLATE_LIVE_ATTRIBUTE = 'data-bravais-plate-live';

export type BravaisReflowRects = ReadonlyMap<string, PlateRect>;
/** shapeId：排这条轨迹时墙的形状（BravaisWallShape.id）。 */
export type ReflowTrack = { from: PlateRect; to: PlateRect; start: number; shapeId: string };

const rectOf = ({ x, y, width, height }: PlateRect): PlateRect => ({ x, y, width, height });
const isSameRect = (a: PlateRect, b: PlateRect) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/** slot 不在任何让位表里时画在哪（墙此刻形状里的原位）。 */
const restingRect = (slotKey: string, shape: BravaisWallShape): PlateRect | null => {
    const slot = shapeSlotFromKey(shape, slotKey);
    return slot ? rectOf(slot) : null;
};

const blockKeyOf = (slotKey: string) => slotKey.split(',').slice(0, 2).join(',');

const isTrackDone = (track: ReflowTrack, now: number) => now - track.start >= BRAVAIS_REFLOW_MS;

/** 一条轨迹在 `now` 时刻的矩形（弹簧不过冲，始终在起止之间）。 */
export const sampleReflowTrack = (track: ReflowTrack, now: number): PlateRect => {
    const progress = Math.min(1, Math.max(0, (now - track.start) / BRAVAIS_REFLOW_MS));
    if (progress >= 1) return track.to;
    const eased = bravaisReflowEase(progress);
    const mix = (from: number, to: number) => from + (to - from) * eased;
    return {
        x: mix(track.from.x, track.to.x),
        y: mix(track.from.y, track.to.y),
        width: mix(track.from.width, track.to.width),
        height: mix(track.from.height, track.to.height),
    };
};

/**
 * 让位表从 `previous` 换成 `next`（`now` 时刻）：两张表里出现过的 slot 各起一条新轨迹，从此刻画着的矩形（还在动就是
 * 它的实时矩形，否则是上一张表 / 原位）到新的落定矩形；起止相同的不动。别的还没放完的轨迹（例如另一块的归位）照旧；
 * 别的形状上排的不算在动（见 splitStaleTracks）。纯函数。
 */
export const planReflowTracks = (
    tracks: ReadonlyMap<string, ReflowTrack>,
    previous: BravaisReflowRects,
    next: BravaisReflowRects,
    now: number,
    shape: BravaisWallShape = BRAVAIS_BLOCK_SHAPE,
): Map<string, ReflowTrack> => {
    const out = new Map<string, ReflowTrack>();
    for (const [key, track] of tracks) {
        if (!isTrackDone(track, now) && track.shapeId === shape.id) out.set(key, track);
    }
    for (const key of new Set([...previous.keys(), ...next.keys()])) {
        const resting = restingRect(key, shape);
        const running = out.get(key);
        const from = running ? sampleReflowTrack(running, now) : previous.get(key) ?? resting;
        const to = next.get(key) ?? resting;
        if (!from || !to || isSameRect(from, to)) {
            out.delete(key);
            continue;
        }
        out.set(key, { from: rectOf(from), to: rectOf(to), start: now, shapeId: shape.id });
    }
    return out;
};

/**
 * 墙换成了 `shape`：别的形状上排的轨迹作废，给出这些 slot 此刻该画的矩形（React 渲染的那份：让位表里的，否则是
 * 这个形状里的原位；这个形状里没有这个 slot 时为 null）。同一形状的轨迹照旧。纯函数。
 */
export const splitStaleTracks = (
    tracks: ReadonlyMap<string, ReflowTrack>,
    reflow: BravaisReflowRects,
    shape: BravaisWallShape,
): { live: Map<string, ReflowTrack>; settled: Map<string, PlateRect | null> } => {
    const live = new Map<string, ReflowTrack>();
    const settled = new Map<string, PlateRect | null>();
    for (const [key, track] of tracks) {
        if (track.shapeId === shape.id) {
            live.set(key, track);
            continue;
        }
        const rect = reflow.get(key);
        settled.set(key, rect ? rectOf(rect) : restingRect(key, shape));
    }
    return { live, settled };
};

const writeTileRect = (tile: HTMLElement, rect: PlateRect) => {
    tile.style.transform = `translate3d(${rect.x}px, ${rect.y}px, 0)`;
    tile.style.width = `${rect.width}px`;
    tile.style.height = `${rect.height}px`;
};

const findPlate = (plates: PlateBlockSet, blockKey: string): PlateBlock | undefined => (
    plates.left.find(block => block.key === blockKey) ?? plates.right.find(block => block.key === blockKey)
);

export const useBravaisReflowDriver = ({
    reflow,
    enabled,
    fieldRef,
    platesRef,
    getShape,
}: {
    /** 聚焦卡所在块的让位矩形（slot key → 落定矩形）；空表示没有聚焦卡。 */
    reflow: BravaisReflowRects;
    /** false = 降低动态效果：不动，直接落定。 */
    enabled: boolean;
    fieldRef: RefObject<HTMLElement | null>;
    /** 此刻渲染的块底板（每次渲染更新）；实色档为空。 */
    platesRef: MutableRefObject<PlateBlockSet>;
    /** 墙此刻的形状（不在让位表里的 slot 回到它的原位）。 */
    getShape: () => BravaisWallShape;
}) => {
    const previousRef = useRef(reflow);
    const tracksRef = useRef<Map<string, ReflowTrack>>(new Map());
    /** 上一帧逐帧重画过的块（这一帧没有动的了就写回落定路径）。 */
    const liveBlocksRef = useRef<Set<string>>(new Set());
    const rafRef = useRef(0);

    /** 墙换了形状：旧形状上的轨迹作废，还在的磁贴写回 React 此刻渲染的矩形、摘掉标记（底板由 draw 写回落定路径）。 */
    const dropStaleTracks = (field: HTMLElement) => {
        // previousRef 在 effect 一开头就换成了这次的让位表，所以此刻就是 React 渲染的那一份。
        const { live, settled } = splitStaleTracks(tracksRef.current, previousRef.current, getShape());
        if (settled.size === 0) return;
        tracksRef.current = live;
        for (const [key, rect] of settled) {
            const tile = field.querySelector<HTMLElement>(`[data-bravais-slot="${key}"]`);
            if (!tile) continue;
            if (rect) writeTileRect(tile, rect);
            tile.removeAttribute(BRAVAIS_REFLOWING_ATTRIBUTE);
        }
    };

    const draw = (now: number) => {
        const field = fieldRef.current;
        if (!field) return;
        dropStaleTracks(field);
        const tracks = tracksRef.current;
        const live = new Map<string, Map<string, PlateRect>>();
        const touched = new Set(liveBlocksRef.current);
        for (const [key, track] of [...tracks]) {
            const done = isTrackDone(track, now);
            const rect = sampleReflowTrack(track, now);
            const tile = field.querySelector<HTMLElement>(`[data-bravais-slot="${key}"]`);
            if (tile) {
                writeTileRect(tile, rect);
                if (done) tile.removeAttribute(BRAVAIS_REFLOWING_ATTRIBUTE);
                else tile.setAttribute(BRAVAIS_REFLOWING_ATTRIBUTE, '');
            }
            const blockKey = blockKeyOf(key);
            touched.add(blockKey);
            if (done) {
                tracks.delete(key);
            } else {
                const rects = live.get(blockKey) ?? new Map<string, PlateRect>();
                rects.set(key, rect);
                live.set(blockKey, rects);
            }
        }
        // 底板：还有在动的块按磁贴此刻的矩形挖洞，放完的块写回落定路径（与 React 渲染的那份是同一个字符串）。
        const plates = platesRef.current;
        for (const blockKey of touched) {
            const plate = findPlate(plates, blockKey);
            const svg = field.querySelector<SVGSVGElement>(`[data-bravais-plate-block="${blockKey}"]`);
            const path = svg?.querySelector('path');
            if (!plate || !svg || !path) continue;
            const rects = live.get(blockKey);
            const d = rects ? buildPlatePath(plate, plate.holes.map(hole => rects.get(hole.key) ?? hole.rect)) : plate.d;
            if (path.getAttribute('d') !== d) path.setAttribute('d', d);
            if (rects) svg.setAttribute(PLATE_LIVE_ATTRIBUTE, '');
            else svg.removeAttribute(PLATE_LIVE_ATTRIBUTE);
        }
        liveBlocksRef.current = new Set(live.keys());
    };

    const tick = (now: number) => {
        rafRef.current = 0;
        draw(now);
        if (tracksRef.current.size > 0) rafRef.current = requestAnimationFrame(tick);
    };

    useLayoutEffect(() => {
        const previous = previousRef.current;
        previousRef.current = reflow;
        if (previous === reflow) return;
        const now = performance.now();
        if (!enabled) {
            // 落定：还在动的写到终点（React 已渲染终点，这里只摘内联样式的中间值与标记）。
            for (const track of tracksRef.current.values()) track.start = now - BRAVAIS_REFLOW_MS;
            draw(now);
            return;
        }
        // 换了形状时旧形状上还在动的先作废，不并进这次的规划。
        if (fieldRef.current) dropStaleTracks(fieldRef.current);
        tracksRef.current = planReflowTracks(tracksRef.current, previous, reflow, now, getShape());
        // React 刚把外框写成终点：绘制前拉回起点。
        draw(now);
        if (tracksRef.current.size > 0 && rafRef.current === 0) rafRef.current = requestAnimationFrame(tick);
    // tick / draw 只读 ref。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, reflow]);

    useLayoutEffect(() => () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
    }, []);
};
