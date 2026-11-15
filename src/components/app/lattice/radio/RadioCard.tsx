import { lazy, memo, Suspense, useEffect, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { motion, useAnimate, type TargetAndTransition } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { WallTitle } from '../../../wall/WallTitle';
import { useWallPosterArtwork } from '../../../wall/useWallPosterArtwork';
import { isWallDoubleClickOn, noteWallPress } from '../../../wall/wallDoubleClick';
import type { LatticeSongTile } from '../latticeModel';
import LatticePlaybackControls from '../LatticePlaybackControls';
import LatticeQuickActions from '../LatticeQuickActions';
import { useLatticeChromeDisclosure } from '../useLatticeChromeDisclosure';
import { useLatticeExpansionSettled } from '../useLatticeExpansionSettled';
import { prewarmLatticeLyrics } from '../lyrics/prewarmLatticeLyrics';
import { useRadioCoverTint } from './useRadioCoverTint';
import type { RadioCardRole, RadioRect } from './radioWallModel';
import { RADIO_NOW_ATTR } from './useRadioWallHandoff';

// src/components/app/lattice/radio/RadioCard.tsx
// 电台墙的一张卡。两面：正面是封面（与队列墙的海报同一套样式，正在播放的那张带歌词和播放控制条），背面是封面取色
// 的问号。还没轮到的卡背面朝上；轮到它时翻开，之后一直是正面。离开这一行时翻回背面、淡出（翻牌销毁）。
// 已经揭开的卡升为正在播放时（点了一张听过的，或者往回点过之后再往前走）也翻一次牌（半圈），从右边来的往左翻、
// 从左边来的往右翻；从左边补回来的卡背面朝上进来，落位时翻开。

const LatticeLyrics = lazy(() => import('../lyrics/LatticeLyrics'));

/** 卡怎么进来：opening 是打开电台墙时整圈一张张浮上来；deal 是之后补的卡，从弧上更外面的一格沿弧滑进来。 */
export type RadioCardEntry =
    | { kind: 'opening'; delay: number }
    | { kind: 'deal'; from: RadioRect };

type RadioCardProps = {
    tile: LatticeSongTile;
    role: RadioCardRole;
    offset: number;
    rect: RadioRect;
    /** 正面朝上（正在播放、听过的，或者这次打开以来播过的）。 */
    revealed: boolean;
    /** 只在挂上时读。 */
    entry: RadioCardEntry;
    /** 离开这一圈时沿弧退到哪里（更外面的一格）。 */
    exitRect: RadioRect;
    pixelRatio: number;
    reducedMotion: boolean;
    /** 在私人 FM 里播放这一首。 */
    onPlay: (tile: LatticeSongTile) => void;
    /** 双击正在播放的那张：暂停着就继续，从不暂停。 */
    onPlayFromWall: (tile: LatticeSongTile) => void;
    onTogglePlayback: () => void;
    onSeek: (time: number) => void;
    onOpenPlayer: () => void;
};

const FLIP_TRANSITION = { duration: 0.55, ease: [0.4, 0, 0.2, 1] as const };
const DEAL_SPRING = { type: 'spring' as const, stiffness: 240, damping: 30, mass: 0.9 };
const PERSPECTIVE_PX = 1400;

// 取色之前、取不到时的底色：按歌曲 id 算一个色相（与队列墙海报没有封面时同一个算法）。
const fallbackTint = (id: string) => {
    let sum = 0;
    for (let index = 0; index < id.length; index += 1) sum += id.charCodeAt(index);
    const hue = sum % 360;
    return `hsl(${hue} 52% 40%)`;
};

function RadioCard({
    tile,
    role,
    offset,
    rect,
    revealed,
    entry,
    exitRect,
    pixelRatio,
    reducedMotion,
    onPlay,
    onPlayFromWall,
    onTogglePlayback,
    onSeek,
    onOpenPlayer,
}: RadioCardProps) {
    const { t } = useTranslation();
    const isNow = role === 'now';
    const chrome = useLatticeChromeDisclosure(isNow);
    // 已经正面朝上的卡升为正在播放时翻半圈：外面单独一层（lattice-radio-card-spin）先转到侧立（±90°），
    // 再从另一侧的侧立转回 0°。看着是翻了 180°，停下时仍是封面朝外，两面不用交换。从右边来的往左翻，从左边来的
    // 往右翻。角色的变化按渲染时记（React 的「随 props 调整 state」写法）；还没揭开的卡升上来时走下面那次揭开
    // （180° → 0°），不另翻。
    const [spin, setSpin] = useState<{ count: number; direction: 1 | -1 }>({ count: 0, direction: 1 });
    const [shown, setShown] = useState({ role, revealed });
    if (shown.role !== role || shown.revealed !== revealed) {
        setShown({ role, revealed });
        if (role === 'now' && shown.role !== 'now' && shown.revealed) {
            setSpin(value => ({ count: value.count + 1, direction: shown.role === 'played' ? 1 : -1 }));
        }
    }
    const [spinScope, animateSpin] = useAnimate<HTMLDivElement>();
    useEffect(() => {
        if (spin.count === 0 || reducedMotion) return;
        const element = spinScope.current;
        const edge = 90 * spin.direction;
        const run = { stopped: false, current: animateSpin(element, { rotateY: edge }, { duration: 0.26, ease: 'easeIn' }) };
        void run.current.then(() => {
            if (run.stopped) return;
            run.current = animateSpin(element, { rotateY: [-edge, 0] }, { duration: 0.3, ease: 'easeOut' });
        });
        // 翻到一半被打断（又换了一首、卡被卸下）：停下并摆正，不让卡停在侧立看不见的角度。
        return () => {
            run.stopped = true;
            run.current.stop();
            element.style.transform = '';
        };
    }, [animateSpin, reducedMotion, spin, spinScope]);
    const faceAngle = revealed ? 0 : 180;
    // 从左边补回来的卡（往回退时）背面朝上进场，落位时翻开；只在挂上时读。
    const entersFaceDown = !reducedMotion && entry.kind === 'deal' && entry.from.x < rect.x && revealed;
    // 歌词是按卡的大小排版的 Pixi 场景：等卡长到位再挂，不在长大的每一帧重排。
    const [settled, onAnimationComplete] = useLatticeExpansionSettled(isNow, reducedMotion);
    const coverUrl = useWallPosterArtwork(tile.coverUrl, Math.max(rect.width, rect.height) * pixelRatio);
    const tint = useRadioCoverTint(tile.coverUrl) ?? fallbackTint(tile.id);

    const initial: TargetAndTransition | false = reducedMotion
        ? false
        : entry.kind === 'opening'
            ? { ...rect, y: rect.y + 48, opacity: 0, scale: 0.92 }
            : { ...entry.from, opacity: 0 };
    const exit: TargetAndTransition = reducedMotion
        ? { opacity: 0, transition: { duration: 0 } }
        : {
            ...exitRect,
            rotateY: exitRect.x < rect.x ? -180 : 180,
            scale: 0.82,
            opacity: [1, 1, 0],
            transition: { duration: 0.5, ease: [0.4, 0, 0.2, 1], opacity: { duration: 0.5, times: [0, 0.6, 1] } },
        };
    const transition = reducedMotion
        ? { duration: 0 }
        : {
            ...DEAL_SPRING,
            delay: entry.kind === 'opening' ? entry.delay : 0,
            opacity: { duration: 0.28, delay: entry.kind === 'opening' ? entry.delay : 0 },
        };

    const pressKey = `lattice-radio:${tile.id}`;
    const handleClick = (event: MouseEvent<HTMLElement>) => {
        const onControl = event.target instanceof Element && Boolean(event.target.closest('button, input'));
        noteWallPress(event, onControl ? '' : pressKey);
        if (onControl) return;
        if (isNow) chrome.toggleTouch();
        else onPlay(tile);
    };
    const handleDoubleClick = (event: MouseEvent<HTMLElement>) => {
        if (!isNow || (event.target instanceof Element && event.target.closest('button, input'))) return;
        if (isWallDoubleClickOn(pressKey)) onPlayFromWall(tile);
    };
    const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        if (event.target !== event.currentTarget || event.repeat) return;
        // 卡自己用掉的键不再往外传：window 上的空格快捷键（播放 / 暂停）不看 defaultPrevented。
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            if (isNow) onTogglePlayback();
            else onPlay(tile);
        } else if (event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            if (isNow) chrome.toggleKeyboard();
            else onPlay(tile);
        }
    };

    const label = revealed
        ? `${tile.title} · ${tile.artist}`
        : t('home.latticeRadioHidden');

    return (
        <motion.div
            className={`lattice-radio-card ${isNow ? 'is-now' : `is-${role}`} ${revealed ? 'is-revealed' : ''}`}
            data-radio-card={offset}
            {...(isNow ? { [RADIO_NOW_ATTR]: '' } : {})}
            initial={initial}
            animate={{ ...rect, opacity: 1, scale: 1, rotateY: 0 }}
            exit={exit}
            transition={transition}
            style={{ transformPerspective: PERSPECTIVE_PX, zIndex: isNow ? 20 : 10 - Math.abs(offset) }}
            onAnimationComplete={onAnimationComplete}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            onKeyDown={handleKeyDown}
            onPointerEnter={(event: PointerEvent<HTMLElement>) => { if (isNow) prewarmLatticeLyrics(); chrome.onPointerEnter(event); }}
            onPointerLeave={chrome.onPointerLeave}
            onPointerDownCapture={chrome.onPointerDownCapture}
            onFocusCapture={chrome.onFocusCapture}
            onBlurCapture={chrome.onBlurCapture}
            role={isNow ? 'group' : 'button'}
            tabIndex={0}
            aria-label={label}
        >
            <div ref={spinScope} className="lattice-radio-card-spin">
                <motion.div
                    className="lattice-radio-card-inner"
                    initial={entersFaceDown ? { rotateY: faceAngle + 180 } : false}
                    animate={{ rotateY: faceAngle }}
                    transition={reducedMotion ? { duration: 0 } : FLIP_TRANSITION}
                >
                    <article
                        ref={chrome.articleRef}
                        className={`lattice-poster lattice-radio-face is-front ${isNow ? 'is-current is-expanded' : ''}`}
                        style={{ backgroundImage: coverUrl ? `url("${coverUrl}")` : undefined }}
                        aria-hidden={!revealed}
                    >
                        <span className="lattice-poster-shade" />
                        <span className="lattice-poster-lights-out" />
                        <span className="lattice-poster-tint" />
                        {revealed && <LatticeQuickActions tile={tile} width={rect.width} expanded={isNow} />}
                        {isNow && settled ? (
                            <Suspense fallback={<span className="lattice-poster-copy"><WallTitle title={tile.title} expanded targetPosterWidth={rect.width} /><small>{tile.artist}</small></span>}>
                                <LatticeLyrics key={tile.id} tile={tile} reducedMotion={reducedMotion} />
                            </Suspense>
                        ) : (
                            <span className="lattice-poster-copy">
                                <WallTitle title={tile.title} expanded={isNow} targetPosterWidth={rect.width} />
                                <small>{tile.artist}</small>
                            </span>
                        )}
                        {isNow && (
                            <div className="lattice-poster-controls">
                                <LatticePlaybackControls
                                    revealed={chrome.revealed}
                                    tile={tile}
                                    onPlay={onPlay}
                                    onTogglePlayback={onTogglePlayback}
                                    onSeek={onSeek}
                                    onOpenPlayer={onOpenPlayer}
                                />
                            </div>
                        )}
                    </article>
                    <div className="lattice-radio-face is-back" style={{ '--lattice-radio-tint': tint } as CSSProperties} aria-hidden>
                        <span className="lattice-radio-mark">?</span>
                    </div>
                </motion.div>
            </div>
        </motion.div>
    );
}

// 每次渲染 RadioWall 都重算 rect 和磁贴（队列、当前曲目一变就是新对象），按值比，不按对象比；entry 只在挂上时读。
const sameProps = (previous: RadioCardProps, next: RadioCardProps) => {
    for (const key of Object.keys(next) as (keyof RadioCardProps)[]) {
        if (key === 'tile' || key === 'rect' || key === 'exitRect' || key === 'entry') continue;
        if (!Object.is(previous[key], next[key])) return false;
    }
    const a = previous.rect;
    const b = next.rect;
    const exitA = previous.exitRect;
    const exitB = next.exitRect;
    const tileA = previous.tile;
    const tileB = next.tile;
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.rotate === b.rotate
        && exitA.x === exitB.x && exitA.y === exitB.y && exitA.rotate === exitB.rotate
        && tileA.id === tileB.id && tileA.song === tileB.song && tileA.title === tileB.title
        && tileA.artist === tileB.artist && tileA.coverUrl === tileB.coverUrl && tileA.section === tileB.section;
};

export default memo(RadioCard, sameProps);
