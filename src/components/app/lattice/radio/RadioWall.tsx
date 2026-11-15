import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useReducedMotionFor } from '../../../../hooks/useReducedMotionFor';
import { hasBlockingWindow } from '../../../../utils/keyboardTargets';
import type { LatticeTile } from '../latticeModel';
import RadioBackdrop, { RADIO_WAVE_TURN_DEG } from './RadioBackdrop';
import RadioCard, { type RadioCardEntry } from './RadioCard';
import {
    buildRadioCards,
    radioCardInView,
    radioCardRect,
    resolveRadioMetrics,
    type RadioCard as RadioCardModel,
} from './radioWallModel';
import { useRadioWallHandoff } from './useRadioWallHandoff';
import './RadioWall.css';

// src/components/app/lattice/radio/RadioWall.tsx
// 电台墙：Lattice 的第二种形态（私人 FM 下总是它），播放队列画成一圈带轻微弧度的卡牌（radioWallModel.ts 定哪几张、
// 摆在哪）。正在播放的那张在中间揭开；接下来的几首在私人 FM 里（或设置要求时）背面朝上，是封面取色的问号。往前走时，
// 右边补发新卡，左边最旧的那张翻回背面销毁。点一张卡就播放它：私人 FM 里仍在电台里播放（不变成普通队列）。

type RadioWallProps = {
    /** 队列墙的磁贴（Lattice 已经按队列和当前曲目算好）。 */
    tiles: LatticeTile[];
    /** 私人 FM（背景上的字、墙的名字跟着它）。 */
    isFm: boolean;
    /** 接下来的歌背面朝上（问号卡），轮到或这次打开以来播过才翻开。 */
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

    const cards = useMemo(() => buildRadioCards(tiles, { wrap: wrapsAround }), [tiles, wrapsAround]);
    const metrics = useMemo(() => (size ? resolveRadioMetrics(size.width, size.height) : null), [size]);
    const nowKey = cards.find(card => card.role === 'now')?.tile.id ?? null;

    // 这次打开以来播过的歌：往回点了一首听过的之后，它后面那些也已经听过，仍是正面朝上。
    // 只记还在队列里的（换了模式、队列整个换掉时旧的就丢掉）。
    const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
    useEffect(() => {
        if (nowKey === null) return;
        setSeen(previous => {
            if (previous.has(nowKey)) return previous;
            const queued = new Set(tiles.map(tile => tile.id));
            return new Set([...previous].filter(key => queued.has(key))).add(nowKey);
        });
    }, [nowKey, tiles]);

    // 卡牌沿弧走一格，背景的同心圆朝同一方向转一点：新的正在播放那张原来在右边，整圈往左（逆时针）转；
    // 原来在左边（往回点了一张听过的）就顺时针转；不在这一圈里（换了模式、队列整个换掉）当作往前走。
    const [waveTurn, setWaveTurn] = useState(0);
    const offsetsRef = useRef<ReadonlyMap<string, number>>(new Map());
    useEffect(() => {
        const previous = offsetsRef.current;
        offsetsRef.current = new Map(cards.map(card => [card.tile.id, card.offset]));
        if (nowKey === null || previous.size === 0) return;
        const from = previous.get(nowKey);
        if (from === 0) return;
        const direction = from === undefined ? 1 : Math.sign(from);
        setWaveTurn(turn => turn - direction * RADIO_WAVE_TURN_DEG);
    }, [cards, nowKey]);

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
    // 打开电台墙时整行一张张浮上来；之后补的卡从界外发进来。挂上之后这一项就不再读。
    const [opening, setOpening] = useState(true);
    useEffect(() => {
        if (dealt) setOpening(false);
    }, [dealt]);

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || hasBlockingWindow()) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            onBack();
            return;
        }
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        // 正在播放那张卡里的控制条自己用方向键（进度条是原生的 range）。
        if (event.target instanceof Element && event.target.closest('.lattice-poster-controls')) return;
        const container = containerRef.current;
        if (!container) return;
        event.preventDefault();
        const focused = document.activeElement?.closest<HTMLElement>('[data-radio-card]');
        const from = focused && container.contains(focused) ? Number(focused.dataset.radioCard) : null;
        const target = from === null ? 0 : from + (event.key === 'ArrowLeft' ? -1 : 1);
        container.querySelector<HTMLElement>(`[data-radio-card="${target}"]`)?.focus({ preventScroll: true });
    };

    const entryFor = (card: RadioCardModel, index: number): RadioCardEntry => {
        if (opening || !metrics) return { kind: 'opening', delay: index * OPENING_STAGGER_S };
        // 从弧上更外面的一格滑进来：听过的（往回退时补回来的）从左，其余从右。
        const outward = card.role === 'played' ? -1 : 1;
        return { kind: 'deal', from: radioCardRect(card.offset + outward, metrics) };
    };

    return (
        <div
            ref={containerRef}
            className={`lattice-radio ${handoff.isLeaving ? 'is-leaving' : ''}`}
            tabIndex={-1}
            onKeyDown={handleKeyDown}
            role="group"
            aria-label={t(isFm ? 'home.latticeRadioLabel' : 'home.latticeRadioQueueLabel')}
        >
            {metrics && <RadioBackdrop metrics={metrics} turn={waveTurn} word={t(isFm ? 'home.latticeRadioBackdropWord' : 'home.latticeRadioBackdropQueueWord')} />}
            <AnimatePresence>
                {dealt && cards.map((card, index) => {
                    const rect = radioCardRect(card.offset, metrics);
                    // 整张在窗口外的不挂（卸下时走离场，图片、图层一起释放）。
                    if (!radioCardInView(rect, metrics)) return null;
                    const exitRect = radioCardRect(card.offset < 0 ? card.offset - 1 : card.offset + 1, metrics);
                    return (
                        <RadioCard
                            key={card.tile.id}
                            tile={card.tile}
                            role={card.role}
                            offset={card.offset}
                            rect={rect}
                            revealed={card.role !== 'upcoming' || !hidesUpcoming || seen.has(card.tile.id)}
                            entry={entryFor(card, index)}
                            exitRect={exitRect}
                            pixelRatio={pixelRatio}
                            reducedMotion={reducedMotion}
                            onPlay={onPlay}
                            onPlayFromWall={onPlayFromWall}
                            onTogglePlayback={onTogglePlayback}
                            onSeek={onSeek}
                            onOpenPlayer={onOpenPlayer}
                        />
                    );
                })}
            </AnimatePresence>
        </div>
    );
}
