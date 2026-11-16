import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent,
    type MouseEvent,
    type PointerEvent,
    type WheelEvent,
} from 'react';
import { AnimatePresence, animate, useMotionValue, type AnimationPlaybackControls } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useReducedMotionFor } from '../../../../hooks/useReducedMotionFor';
import { setLatticeCurrentSongPosterVisible } from '../../../../stores/useLatticeControlsStore';
import { usePlayingSongLocatorStore } from '../../../../stores/usePlayingSongLocatorStore';
import { hasBlockingWindow } from '../../../../utils/keyboardTargets';
import type { LatticeTile } from '../latticeModel';
import { answerWallLocate, useWallPageKey } from '../wallLocate';
import RadioBackdrop from './RadioBackdrop';
import RadioCard, { type RadioCardEntry } from './RadioCard';
import {
    buildRadioBrowseCards,
    placeRadioRow,
    radioBrowseRange,
    radioCardInView,
    radioCardRect,
    radioStepPx,
    resolveRadioMetrics,
    type RadioCard as RadioCardModel,
    type RadioRowPlacement,
} from './radioWallModel';
import { useRadioWallHandoff } from './useRadioWallHandoff';
import './RadioWall.css';

// src/components/app/lattice/radio/RadioWall.tsx
// 电台墙：Lattice 的第二种形态（私人 FM 下总是它），播放队列画成一圈带轻微弧度的卡牌（radioWallModel.ts 定哪几张、
// 摆在哪）。正在播放的那张在中间揭开；接下来的几首在私人 FM 里（或设置要求时）背面朝上。往前走时，右边补发新卡，
// 左边最旧的那张翻回背面销毁。手势和队列墙一样：单击一张卡把它带到正中（只看不播），双击才播放它：私人 FM 里
// 仍在电台里播放（不变成普通队列）。
// 卡都排在一条「轨道」上（rail，一个 MotionValue）：切歌是轨道滑到新的正在播放那张；左右浏览（拖动、滚轮、方向键）
// 是轨道滑到别的卡，只看不播——不切歌、不为浏览去向电台要新歌（只在这一行已有的卡之间走），背面朝上的卡浏览到正中
// 也不翻开。拖动时轨道直接跟手，不经过 React。

type RadioWallProps = {
    /** 队列墙的磁贴（Lattice 已经按队列和当前曲目算好）。 */
    tiles: LatticeTile[];
    /** 私人 FM（背景上的字、墙的名字跟着它）。 */
    isFm: boolean;
    /** 接下来的歌背面朝上，轮到或这次打开以来播过才翻开。 */
    hidesUpcoming: boolean;
    /** 列表循环：右边的卡放到队尾之后接上队首。 */
    wrapsAround: boolean;
    onPlay: (tile: LatticeTile) => void;
    onPlayFromWall: (tile: LatticeTile) => void;
    onTogglePlayback: () => void;
    onSeek: (time: number) => void;
    onOpenPlayer: () => void;
    onBack: () => void;
};

const OPENING_STAGGER_S = 0.08;
/**
 * 打开时那一波（整行一张张浮上来，最后一张起步晚 OPENING_STAGGER_S × 5）多久算跑完：之前歌词场景、背面取色、
 * 背景的动画循环都先不起。它们都是一次性的重活（歌词场景要建 WebGL、编译着色器、量字，取色要从画布读回像素），
 * 从资料库墙翻牌进来时正好压在翻牌和这一波上，iOS Safari 上就掉帧。
 */
const OPENING_SETTLE_MS = 1300;
/** 轨道滑动（切歌、浏览、松手吸附）的弹簧：和原来每张卡各自滑动时一样。 */
const RAIL_SPRING = { type: 'spring' as const, stiffness: 240, damping: 30, mass: 0.9 };
/**
 * 一下子回到很远的地方（浏览了很久后按 Esc、定位，或这时切了歌）：轨道先跳到离目标 RAIL_JUMP_LANDING 格处再弹过去。
 * 一路弹过去的话沿途每一张卡都会挂上又翻走，走得越远越多。
 */
const RAIL_JUMP_STEPS = 6;
const RAIL_JUMP_LANDING = 3;
/**
 * 指针挪过这么远才算拖动（之前仍是点击，卡照常倾斜按压），和队列墙一样按直线距离算（useWallPointerPan）：
 * 斜着、竖着划过去的也不再落成一次点击。轨道只跟横向的位移。
 */
const DRAG_START_PX = 8;
/** 拖得不到半格就松手、但拖过这么远：也算往那边走一格（甩一下）。 */
const FLING_PX = 48;
/** 拖出这一行两头之后只跟三成，松手弹回。 */
const RUBBER_BAND = 0.3;
/** 滚轮累计滚过多少算走一格；走了一格之后短暂不再接受，免得触控板的惯性一下子滚过好几张。 */
const WHEEL_STEP = 90;
const WHEEL_IDLE_MS = 200;
const WHEEL_COOLDOWN_MS = 260;
/** 一次滚动事件的增量到这么大，当作鼠标滚轮的一格（触控板的增量通常小得多）。 */
const WHEEL_NOTCH = 50;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const rubberBand = (value: number, min: number, max: number) => {
    if (value < min) return min - (min - value) * RUBBER_BAND;
    if (value > max) return max + (value - max) * RUBBER_BAND;
    return value;
};

type DragState = {
    pointerId: number;
    startX: number;
    startY: number;
    /** 开始拖动那一刻的轨道位置。 */
    from: number;
    /** 挪过了阈值：这次按下不再是点击（松手的 click 吞掉）。 */
    active: boolean;
    /** 横着也挪过了阈值：轨道开始跟手（才算浏览，正中那张收起歌词）。只竖着划的不碰轨道。 */
    railing: boolean;
};

export default function RadioWall({
    tiles,
    isFm,
    hidesUpcoming,
    wrapsAround,
    onPlay,
    onPlayFromWall,
    onTogglePlayback,
    onSeek,
    onOpenPlayer,
    onBack,
}: RadioWallProps) {
    const { t } = useTranslation();
    const containerRef = useRef<HTMLDivElement>(null);
    const reducedMotion = useReducedMotionFor('lattice');
    const [size, setSize] = useState<{ width: number; height: number } | null>(null);
    // 尺寸只在窗口大小变时变：卡的位置由它算，不跟着任何逐帧的值走。
    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const measure = () => {
            const width = container.clientWidth;
            const height = container.clientHeight;
            setSize(previous => (previous?.width === width && previous.height === height ? previous : { width, height }));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(container);
        return () => observer.disconnect();
    }, []);
    const pixelRatio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;

    const metrics = useMemo(() => (size ? resolveRadioMetrics(size.width, size.height) : null), [size]);
    const nowKey = useMemo(() => tiles.find(tile => tile.kind === 'song' && tile.section === 'now')?.id ?? null, [tiles]);
    // 浏览能走多远：队列里已有的歌（列表循环时绕一圈），不为浏览去要新歌。
    const range = useMemo(() => radioBrowseRange(tiles, { wrap: wrapsAround }), [tiles, wrapsAround]);

    // 浏览：离正在播放那张走了几格。正在播放那张一换（切歌、换队列）就回到它。
    const browseKey = nowKey ?? '';
    const [browseState, setBrowseState] = useState({ key: browseKey, value: 0 });
    const browse = browseState.key === browseKey ? clamp(browseState.value, range.min, range.max) : 0;
    // 这次浏览经过的范围（相对正在播放那张）：一下子跳回很远的地方时，沿途的卡要留到轨道真的把它们带出画面。
    // 轨道停稳（或换了正在播放那张）就收回到只剩停下的那一格。
    const [browseSpan, setBrowseSpan] = useState({ key: browseKey, from: 0, to: 0 });
    const span = browseSpan.key === browseKey ? browseSpan : { key: browseKey, from: browse, to: browse };
    const setBrowse = useCallback((value: number) => {
        setBrowseState({ key: browseKey, value });
        setBrowseSpan(previous => {
            const base = previous.key === browseKey ? previous : { key: browseKey, from: 0, to: 0 };
            return { key: browseKey, from: Math.min(base.from, value), to: Math.max(base.to, value) };
        });
    }, [browseKey]);

    const rail = useMotionValue(0);
    const [dragging, setDragging] = useState(false);
    // 轨道停稳了：正中那张的歌词等它停下再挂。
    const [resting, setResting] = useState(true);
    // 轨道此刻落在哪两格之间：挂哪些卡要同时看停下的位置和轨道当前的位置（长拖动时边上的卡要跟着进来；一下子
    // 回到很远的地方时，还在画面里的卡要等轨道真的把它带出去才卸下）。只在跨格时更新，不逐帧进 React。
    const [railSpan, setRailSpan] = useState({ low: 0, high: 0 });
    useEffect(() => rail.on('change', value => {
        const low = Math.floor(value);
        const high = Math.ceil(value);
        setRailSpan(previous => (previous.low === low && previous.high === high ? previous : { low, high }));
    }), [rail]);

    // 这一行摆哪些卡：平时左二右三；浏览到哪边，哪边就多摆到视野之外（拖动途中按轨道实际走到的位置）。
    // 切歌时不按轨道放宽：最旧的那张照旧在滑走的路上翻牌销毁。
    const [placement, setPlacement] = useState<{
        cards: readonly RadioCardModel[];
        row: RadioRowPlacement;
        before: RadioRowPlacement | null;
    }>(() => ({ cards: [], row: placeRadioRow([], null), before: null }));
    const settledAnchor = placement.row.anchor;
    const viewFrom = Math.min(span.from, browse, dragging ? railSpan.low - settledAnchor : browse);
    const viewTo = Math.max(span.to, browse, dragging ? railSpan.high - settledAnchor : browse);
    const cards = useMemo(
        () => buildRadioBrowseCards(tiles, { from: viewFrom, to: viewTo, wrap: wrapsAround }),
        [tiles, viewFrom, viewTo, wrapsAround],
    );

    // 这次打开以来播过的歌：往回点了一首听过的之后，它后面那些也已经听过，仍是正面朝上。
    // 只记还在队列里的（换了模式、队列整个换掉时旧的就丢掉）。浏览不算播过。
    const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
    useEffect(() => {
        if (nowKey === null) return;
        setSeen(previous => {
            if (previous.has(nowKey)) return previous;
            const queued = new Set(tiles.map(tile => tile.id));
            return new Set([...previous].filter(key => queued.has(key))).add(nowKey);
        });
    }, [nowKey, tiles]);

    // 这一行在轨道上的位置：切歌时还在这一行里的卡位置不变，anchor 挪到新的正在播放那张（radioWallModel 的
    // placeRadioRow）。按渲染时记（「随 props 调整 state」）；before 是上一次的位置，用来分辨新补的卡和一直在、
    // 只是先前在窗口外没挂的卡。
    let { row, before } = placement;
    if (placement.cards !== cards) {
        // 打开电台墙时还没有上一次：在 0 格摆，轨道也从 0 起。
        before = placement.cards.length > 0 ? placement.row : null;
        row = placeRadioRow(cards, before);
        setPlacement({ cards, row, before });
    }
    const anchor = row.anchor;
    const target = anchor + browse;

    const railAnimation = useRef<AnimationPlaybackControls | null>(null);
    const settleRail = useCallback((to: number) => {
        railAnimation.current?.stop();
        railAnimation.current = null;
        const from = rail.get();
        if (Math.abs(to - from) > RAIL_JUMP_STEPS) rail.set(to + Math.sign(from - to) * RAIL_JUMP_LANDING);
        if (reducedMotion || rail.get() === to) {
            rail.set(to);
            setResting(true);
            return;
        }
        setResting(false);
        railAnimation.current = animate(rail, to, { ...RAIL_SPRING, onComplete: () => setResting(true) });
    }, [rail, reducedMotion]);
    useEffect(() => {
        if (!dragging) settleRail(target);
    }, [dragging, settleRail, target]);
    useEffect(() => () => railAnimation.current?.stop(), []);
    // 轨道从动到停的那一刻，浏览经过的范围收回到停下的那一格：沿途的卡这时都已经在画面外了。只认「动 → 停」：
    // 刚点了浏览的那一下 resting 还是旧的 true（轨道下一步才开动），那时收回就把沿途的卡提前卸掉了。降低动态效果时
    // 轨道直接跳到位，没有「动」的那一段，范围就留到下次换歌（多出来的卡在画面外，不挂）。
    const restedRef = useRef(resting);
    useEffect(() => {
        if (resting && !restedRef.current) setBrowseSpan({ key: browseKey, from: browse, to: browse });
        restedRef.current = resting;
    }, [browse, browseKey, resting]);

    // 墙的按键（Esc、← →）挂在容器上：挂上时把焦点交给它（队列墙同样这样做，见 useWallKeyboardFocus），
    // 被键盘聚焦的卡翻牌销毁、焦点落回 body 时也收回来。
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        // 在墙面工具面板里用键盘切形态时焦点还在面板上（.lattice-tools），不抢；别处（播放页的胶囊、空白处）照旧接过来。
        const active = document.activeElement;
        if (active?.closest('.lattice-tools') || container.contains(active)) return;
        container.focus({ preventScroll: true });
    }, []);
    useEffect(() => {
        if (document.activeElement === document.body) containerRef.current?.focus({ preventScroll: true });
    }, [cards]);

    const handoff = useRadioWallHandoff({ containerRef, measured: size !== null });
    const dealt = metrics !== null && !handoff.holdsDeal;
    // 打开电台墙时整行一张张浮上来；之后补的卡随轨道从界外滑进来。挂上之后这一项就不再读。
    const [opening, setOpening] = useState(true);
    useEffect(() => {
        if (dealt) setOpening(false);
    }, [dealt]);
    // 这一波还没跑完（见 OPENING_SETTLE_MS）。降低动态效果时没有这一波，一发出来就算完。
    const [entering, setEntering] = useState(true);
    useEffect(() => {
        if (!dealt) return;
        if (reducedMotion) {
            setEntering(false);
            return;
        }
        const timer = window.setTimeout(() => setEntering(false), OPENING_SETTLE_MS);
        return () => window.clearTimeout(timer);
    }, [dealt, reducedMotion]);

    // ---------- 浏览：拖动 ----------
    const dragRef = useRef<DragState | null>(null);
    // 拖动松手时浏览器还会补发一次 click：吞掉它，拖动不播放。
    const swallowClickRef = useRef(false);
    const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
        // 已经在拖的时候（触屏上另一根手指碰了一下）不接新的按下：接了就把这次拖动顶掉，dragging 再也收不了尾。
        // 还没生效的按下照常替换（鼠标在墙外松手、没收到 pointerup 时留下的那条）。
        if (dragRef.current?.active && dragRef.current.pointerId !== event.pointerId) return;
        swallowClickRef.current = false;
        if (!metrics || (event.pointerType === 'mouse' && event.button !== 0)) return;
        // 控件（按钮、进度条等）自己处理指针，和队列墙一样（useWallPointerPan）：从上面按下不拖墙。
        if (event.target instanceof Element && event.target.closest('button, input, select, textarea, a, [contenteditable="true"], [role="slider"]')) return;
        dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, from: rail.get(), active: false, railing: false };
    };
    // 结束一次拖动：吸附到最近的一张（甩一下至少走一格）。released 为 false 时（指针被系统收走、松手落在墙外
    // 没收到 pointerup）不吞点击、不算甩：之后不会再有这次按下的 click。
    const finishDrag = (drag: DragState, clientX: number, released: boolean) => {
        dragRef.current = null;
        if (!drag.active) return;
        swallowClickRef.current = released;
        if (!drag.railing) return;
        const dx = clientX - drag.startX;
        const start = Math.round(drag.from - anchor);
        let next = Math.round(rail.get() - anchor);
        if (released && next === start && Math.abs(dx) > FLING_PX) next -= Math.sign(dx);
        setBrowse(clamp(next, range.min, range.max));
        setDragging(false);
    };
    const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId || !metrics) return;
        // 鼠标键已经松开（松手落在墙外的按钮、浮岛上，pointerup 没冒泡到这里）：这次按下作废，不让墙跟着悬停的
        // 指针走。
        if (event.pointerType === 'mouse' && event.buttons === 0) {
            finishDrag(drag, event.clientX, false);
            return;
        }
        if (!drag.active) {
            if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_START_PX) return;
            // 真的在拖了才接管指针：只是点一下的话，点击照常落到卡和按钮上。
            drag.active = true;
            event.currentTarget.setPointerCapture(event.pointerId);
        }
        if (!drag.railing) {
            if (Math.abs(event.clientX - drag.startX) < DRAG_START_PX) return;
            drag.railing = true;
            railAnimation.current?.stop();
            railAnimation.current = null;
            // 起点仍是按下的那一点和那时的轨道位置：快速拖动时生效前已经挪了一大截，不能丢（真实的鼠标在 8px 左右
            // 就生效，看不出跳动）。
            setDragging(true);
            setResting(false);
        }
        const raw = drag.from - (event.clientX - drag.startX) / radioStepPx(metrics);
        rail.set(rubberBand(raw, anchor + range.min, anchor + range.max));
    };
    const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        finishDrag(drag, event.clientX, event.type === 'pointerup');
    };
    // 拖动途中指针被收走（切走窗口等）：按松手处理，不让 dragging 卡住。正常松手时 pointerup 先到、已经收尾。
    // 只认墙自己的（和队列墙 PosterWall 一样）：触屏按下时指针隐式捕获在按到的卡上，开始拖动时墙把捕获接过来，
    // 卡上冒上来的那次 lostpointercapture 不是拖动被打断——认了它，手指落在封面上就一拖即停。
    const handleLostPointerCapture = (event: PointerEvent<HTMLDivElement>) => {
        if (event.target !== event.currentTarget) return;
        const drag = dragRef.current;
        if (drag?.pointerId === event.pointerId) finishDrag(drag, event.clientX, false);
    };
    const handleClickCapture = (event: MouseEvent<HTMLDivElement>) => {
        // 键盘、读屏器的激活（detail 为 0）不是拖动补发的那次 click（同 useWallPointerPan）：触屏拖过之后浏览器不补发
        // click，记号会一直留到下次按下，不能把它们吞掉。
        if (!swallowClickRef.current || event.detail === 0) return;
        swallowClickRef.current = false;
        event.stopPropagation();
        event.preventDefault();
    };

    // 触屏：在墙上按下之后的 touchmove 不交给浏览器（不滚动、不当成系统手势），指针事件一直送到这里、不被
    // pointercancel 截断。CSS 的 touch-action 已经这样说了，这里是给 iOS Safari 的保险：卡牌在几层 3D 变换
    // （preserve-3d）里，不能指望每个版本都按外层的 touch-action 处理按在卡上的手势。进度条（原生 range）不登记
    // 按下，照常拖。
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const holdTouch = (event: TouchEvent) => {
            if (dragRef.current && event.cancelable) event.preventDefault();
        };
        container.addEventListener('touchmove', holdTouch, { passive: false });
        return () => container.removeEventListener('touchmove', holdTouch);
    }, []);

    // ---------- 浏览：滚轮（竖着、横着都行；往下、往右是往后） ----------
    const wheelRef = useRef({ sum: 0, lastAt: 0, lockedUntil: 0 });
    const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
        if (!metrics || dragRef.current?.active || event.ctrlKey) return;
        const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 400 : 1;
        const delta = (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * unit;
        const wheel = wheelRef.current;
        const at = event.timeStamp;
        if (at - wheel.lastAt > WHEEL_IDLE_MS) wheel.sum = 0;
        wheel.lastAt = at;
        if (at < wheel.lockedUntil) {
            // 触控板的细碎增量（惯性滚动）一直不停时一直等着：一次甩动只走一格。鼠标滚轮一格一格的大增量不延长，
            // 快速连拨仍能连续走。
            if (Math.abs(delta) < WHEEL_NOTCH) wheel.lockedUntil = at + WHEEL_COOLDOWN_MS;
            return;
        }
        wheel.sum += delta;
        if (Math.abs(wheel.sum) < WHEEL_STEP) return;
        const next = clamp(browse + Math.sign(wheel.sum), range.min, range.max);
        wheel.sum = 0;
        wheel.lockedUntil = at + WHEEL_COOLDOWN_MS;
        if (next !== browse) setBrowse(next);
    };

    // ---------- 浏览：键盘 ----------
    const focusFrame = useRef(0);
    useEffect(() => () => cancelAnimationFrame(focusFrame.current), []);
    // 等这一帧的卡挂上再聚焦（浏览到的那张可能刚走进窗口）。
    const focusCard = useCallback((offset: number) => {
        cancelAnimationFrame(focusFrame.current);
        focusFrame.current = requestAnimationFrame(() => {
            containerRef.current?.querySelector<HTMLElement>(`[data-radio-card="${offset}"]`)?.focus({ preventScroll: true });
        });
    }, []);
    const backToNow = useCallback(() => {
        setBrowse(0);
        focusCard(0);
    }, [focusCard, setBrowse]);
    // 传给每张卡（单击、回车把它带到正中），保持同一个函数，卡的 memo 才不会每次都失效。
    const rangeRef = useRef(range);
    rangeRef.current = range;
    const cardsRef = useRef(cards);
    cardsRef.current = cards;
    const browseTo = useCallback((offset: number) => {
        const { min, max } = rangeRef.current;
        let next = offset;
        if (offset < min || offset > max) {
            // 列表循环时这一行会多画到浏览范围（绕一圈）以外：点那张就是点它那首歌，带到范围内离它最近的那张。
            const tileId = cardsRef.current.find(card => card.offset === offset)?.tile.id;
            const twin = cardsRef.current
                .filter(card => card.tile.id === tileId && card.offset >= min && card.offset <= max)
                .sort((a, b) => Math.abs(a.offset - offset) - Math.abs(b.offset - offset))
                .at(0);
            next = twin ? twin.offset : clamp(offset, min, max);
        }
        setBrowse(next);
        focusCard(next);
    }, [focusCard, setBrowse]);

    // 和海报墙一样（PosterWall 的 publishCurrentPosterVisibility）：正在播放那张停在正中、展开着，它自己带着控制条，
    // 底部的进度条胶囊让开；被浏览到一边收起，或这面墙上没有它（FM 还没对上）时胶囊回来（AppOverlays 读这一项）。
    const nowExpanded = nowKey !== null && browse === 0;
    useEffect(() => {
        setLatticeCurrentSongPosterVisible(nowExpanded);
    }, [nowExpanded]);
    useEffect(() => () => setLatticeCurrentSongPosterVisible(true), []);

    // 「定位正在播放的歌」（右下角工具按钮上方那颗、紧凑档里胶囊的封面、命令）问到这面墙：回到正在播放那张。
    const pageKey = useWallPageKey();
    const locateRequest = usePlayingSongLocatorStore(state => state.request);
    useEffect(() => {
        if (!metrics) return;
        answerWallLocate(locateRequest, pageKey, tiles, tileId => {
            if (tileId === nowKey) backToNow();
        });
    }, [backToNow, locateRequest, metrics, nowKey, pageKey, tiles]);
    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || hasBlockingWindow()) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            // 浏览到别的卡时先回到正在播放那张，再按一次才离开电台墙。
            if (browse !== 0) backToNow();
            else onBack();
            return;
        }
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        // 正在播放那张卡里的控制条自己用方向键（进度条是原生的 range）。
        if (event.target instanceof Element && event.target.closest('.lattice-poster-controls')) return;
        event.preventDefault();
        // 从键盘焦点所在的那张往旁边走（Tab 到了别的卡时从那张起），焦点不在卡上时从正中那张起。
        const focused = document.activeElement?.closest<HTMLElement>('[data-radio-card]');
        const from = focused && containerRef.current?.contains(focused) ? Number(focused.dataset.radioCard) : browse;
        const next = clamp(from + (event.key === 'ArrowLeft' ? -1 : 1), range.min, range.max);
        if (next !== browse) setBrowse(next);
        focusCard(next);
    };

    const entryFor = (card: RadioCardModel, index: number): RadioCardEntry => {
        if (opening || !metrics) return { kind: 'opening', delay: index * OPENING_STAGGER_S };
        // 一直在这一行里、只是先前在窗口外没挂的卡（浏览时走进窗口）直接出现；新补的卡淡入。
        return before?.positions.has(card.key) ? { kind: 'appear' } : { kind: 'deal' };
    };

    return (
        <div
            ref={containerRef}
            className={`lattice-radio ${handoff.isLeaving ? 'is-leaving' : ''} ${dragging ? 'is-dragging' : ''}`}
            tabIndex={-1}
            onKeyDown={handleKeyDown}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onLostPointerCapture={handleLostPointerCapture}
            onClickCapture={handleClickCapture}
            onWheel={handleWheel}
            role="group"
            aria-label={t(isFm ? 'home.latticeRadioLabel' : 'home.latticeRadioQueueLabel')}
        >
            {metrics && (
                <RadioBackdrop
                    metrics={metrics}
                    rail={rail}
                    anchor={nowKey === null ? null : anchor}
                    entering={entering}
                    word={t(isFm ? 'home.latticeRadioBackdropWord' : 'home.latticeRadioBackdropQueueWord')}
                />
            )}
            <AnimatePresence>
                {dealt && cards.map((card, index) => {
                    const position = anchor + card.offset;
                    const slot = position - target;
                    // 整张在窗口外的不挂（卸下时走离场，图片、图层一起释放）。看停下的位置和轨道当前所在的两格，
                    // 各自再往两边多看一格（拖动时邻居可能走进来）。
                    const visible = [target, railSpan.low, railSpan.high].some(at => [0, -1, 1].some(step => (
                        radioCardInView(radioCardRect(position - at + step, metrics), metrics))));
                    if (!visible) return null;
                    return (
                        <RadioCard
                            key={card.key}
                            tile={card.tile}
                            role={card.role}
                            offset={card.offset}
                            position={position}
                            slot={slot}
                            rail={rail}
                            metrics={metrics}
                            revealed={card.role !== 'upcoming' || !hidesUpcoming || seen.has(card.tile.id)}
                            entry={entryFor(card, index)}
                            resting={resting}
                            entering={entering}
                            dragging={dragging}
                            pixelRatio={pixelRatio}
                            reducedMotion={reducedMotion}
                            onPlay={onPlay}
                            onPlayFromWall={onPlayFromWall}
                            onTogglePlayback={onTogglePlayback}
                            onSeek={onSeek}
                            onOpenPlayer={onOpenPlayer}
                            onBrowse={browseTo}
                        />
                    );
                })}
            </AnimatePresence>
        </div>
    );
}
