import React, { memo, useLayoutEffect, useRef, useState, type MouseEvent, type MutableRefObject } from 'react';
import { WallTitle } from '../../../components/wall/WallTitle';
import { useWallPosterArtwork } from '../../../components/wall/useWallPosterArtwork';
import { parseWallSlotKey } from '../../../components/wall/wallSlots';
import { countRender } from '../../../dev/renderCount';
import { getSizedCoverUrl } from '../../../utils/coverUrl';
import {
    BRAVAIS_ALBUM_COVER_PX,
    BRAVAIS_METRICS,
    BRAVAIS_REDUCED_FADE_MS,
    BRAVAIS_TILE_FLIP_IN_MS,
    BRAVAIS_TILE_FLIP_OUT_MS,
} from './bravaisConstants';
import { resolveTileTransition, type BravaisEntrance, type BravaisFlipStep } from './bravaisDisplay';
import type { BravaisItem } from './bravaisLayer';
import { bravaisFaceKey, type BravaisTileKind } from './bravaisLook';
import BravaisFocusCardBody, { type BravaisFocusCardActions } from './BravaisFocusCardBody';
import BravaisTileQuickActions, { BRAVAIS_QUICK_ACTIONS_MIN_WIDTH } from './BravaisTileQuickActions';
import BravaisTileMarks, { BravaisTileBadge } from './BravaisTileMarks';
import { useBravaisArtistTone } from './bravaisArtistTone';
import { noteCoverFlightSource } from './bravaisCoverFlight';
import { BRAVAIS_ALBUM_MOSAIC_PX, mosaicPlacement, shardPlacement, useBravaisCoverSpots } from './bravaisAlbumWall';
import { resolveBravaisTileForm } from './bravaisTileForm';
import './bravaisTileKinds.css';
import { getWaveStagger, WALL_WAVE_IN_MS, WALL_WAVE_LIFT, WALL_WAVE_OUT_MS } from './bravaisWallWave';

// src/library/suites/bravais/BravaisTile.tsx
// 墙上的一张磁贴。分两层（给 B6b③ 的底板留结构）：外框（.bravais-tile）只管位置与尺寸，永远不转；内容层
// （.lattice-poster，海报本身）翻牌时绕 Y 轴转到 90° 换内容再转回来，侧立时露出的是外框后面的东西。
// 翻牌全是 WAAPI 动画写在内容层上，React 只在转到 90° 换内容那一刻渲染这一张一次（不是每帧）。
// 聚焦卡（6×6 块内让位）时外框的位置与尺寸由 useBravaisReflowDriver 逐帧写内联样式（与透光底板的洞同一帧）。
// 透光（B6b③）：窗（kind = window）没有内容，内容层透明、只有一层很淡的光晕底，露出底板挖出的洞下面的 visualizer；
// 全透明档的内容磁贴（seeThrough）不画封面，只留标题与 scrim。翻牌比较的是「面」（bravaisFaceKey），
// 所以换档时开窗、关窗、变透明的磁贴也会翻。
// B9：换首页页签是整墙出场 → 入场（step.wave）：内容层先抬起淡出，换内容，等到自己的入场时刻再落回；首页卡片右上角
// 的眼睛按钮与批量选中的勾（BravaisTileMarks），批量模式里没选中的、管理隐藏视图里已隐藏的灰度 + 半透明（is-dimmed）。
// B11：降低动态效果时翻牌（含整墙波次）换成淡出 → 换内容 → 淡入（合计 0.18s，不错开）；从搜索 / 播放页打开集合的
// 整墙入场（entrance）没有出场段，磁贴立刻换成新内容、保持抬起，按离视口左上角的距离错开落回（刚挂载的同样）。
// fb2：窗上按下鼠标不抢焦点（不把 DOM 焦点挪到窗上）；点窗由 activate 判定为无反应，拖动后的残余点击照常在外面吞掉。
// 种类区分（设计稿 §7.7，样式在 bravaisTileKinds.css）：集合（专辑 / 歌单 / 文件夹 / 每日推荐）右下边缘露出一叠错开的
// 页边（叠页边，内容层自己的 box-shadow，画在磁贴间距里、不占内容面积；设置可关，stage 根节点挂 has-stack-edges），
// 曲目数并进左上角的类型标签（「歌单 · 124」，投影时写好）；歌手是双色调人像（亮端取自头像，bravaisArtistTone），
// 悬停 / 键盘焦点 / 正在播放时恢复原色；歌曲不变。叠页边与人像都在内容层上，翻牌时一起转；全透明档歌手不做双色调。
// 专辑墙（has-album-wall）：曲目按 item.coverArt 画成整面墙拼贴的一块或封面碎片（bravaisAlbumWall，bravaisAlbumPoster.css）。

export type BravaisTileRect = { x: number; y: number; width: number; height: number };

/**
 * 指针最后一次真的移动到的位置。墙在指针底下动（海报倾斜转回正、相机补间）时，浏览器也会对新转到指针下的磁贴发
 * mouseenter；那不是悬停，不该去高亮、滚动列表面板。真的移进一张磁贴时，mouseenter 先于这次 mousemove 派发，
 * 坐标与这里记的不同；墙自己动过来的，坐标与这里记的相同。
 */
let lastPointer: { x: number; y: number } | null = null;
if (typeof window !== 'undefined') {
    window.addEventListener('mousemove', (event) => { lastPointer = { x: event.clientX, y: event.clientY }; }, { passive: true, capture: true });
}
const pointerStayed = (event: MouseEvent<HTMLElement>) => (
    lastPointer !== null && lastPointer.x === event.clientX && lastPointer.y === event.clientY
);

export type BravaisTileHandlers = BravaisFocusCardActions & {
    /** 点了这张磁贴（拖动后的残余点击已在外面吞掉）。 */
    activate: (slotKey: string) => void;
    /** B9：首页歌单类卡片的眼睛按钮（directory-toggle-hidden）。 */
    toggleHidden?: (slotKey: string) => void;
};

type BravaisTileProps = {
    slotKey: string;
    rect: BravaisTileRect;
    item: BravaisItem | null;
    /** 内容 / 实色空画框 / 窗（透光）。 */
    kind: BravaisTileKind;
    /** 全透明档里不画封面、只留标题的内容磁贴（底板在它上面挖洞）。 */
    seeThrough: boolean;
    step: BravaisFlipStep | undefined;
    nowPlayingKey: string | null;
    /** 在聚焦卡所在的块里：位置与尺寸带过渡。 */
    expanded: boolean;
    keyboardFocused: boolean;
    /** 只有展开的那张才需要：「✓ 已在队列」。 */
    queued: boolean;
    /** B7：列表面板里悬停的那一项（墙上它的所有可见副本高亮，is-linked）。 */
    linked?: boolean;
    pixelScale: number;
    /** 换层转场降级成淡入淡出（bravaisMotion）。 */
    reducedMotion: boolean;
    /** B11：整墙入场（来源是搜索 / 播放页）；没有时为 null。 */
    entrance?: BravaisEntrance | null;
    didDragRef: MutableRefObject<boolean>;
    handlers: BravaisTileHandlers;
};

const rotation = (degrees: number) => `perspective(1400px) rotateY(${degrees}deg)`;
/** 整墙出场 / 入场（lift wave）里内容层离开时的样子：往上抬、缩小、淡出。 */
const LIFTED: Keyframe = { transform: `translate3d(0, -${WALL_WAVE_LIFT}px, 0) scale(0.88)`, opacity: 0 };
const SETTLED: Keyframe = { transform: 'none', opacity: 1 };
/** 降低动态效果的淡出 / 淡入（各占一半时长）。 */
const FADED: Keyframe = { opacity: 0 };
const SHOWN: Keyframe = { opacity: 1 };
const FADE_HALF_MS = BRAVAIS_REDUCED_FADE_MS / 2;

/** 窗上按下鼠标：不让浏览器把焦点挪到这张窗上（拖动走 pointer 事件，不受影响）。 */
const preventFocus = (event: MouseEvent<HTMLElement>) => event.preventDefault();

const fallbackBackground = (id: string) => {
    const hue = [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 360;
    return `linear-gradient(145deg, hsl(${hue} 68% 58%), hsl(${(hue + 52) % 360} 62% 18%))`;
};

const sameRect = (a: BravaisTileRect, b: BravaisTileRect) => (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
);

const arePropsEqual = (previous: BravaisTileProps, next: BravaisTileProps) => {
    for (const key of Object.keys(next) as (keyof BravaisTileProps)[]) {
        if (key === 'rect') continue;
        if (!Object.is(previous[key], next[key])) return false;
    }
    return sameRect(previous.rect, next.rect);
};

/** 磁贴此刻画的「面」：内容、种类、透不透。翻牌转到 90° 时整个换掉。 */
type BravaisTileFace = { item: BravaisItem | null; kind: BravaisTileKind; seeThrough: boolean };

const faceKeyOf = (face: BravaisTileFace) => bravaisFaceKey(face.item?.key ?? null, face.kind, face.seeThrough);

function BravaisTile({
    slotKey,
    rect,
    item,
    kind,
    seeThrough,
    step,
    nowPlayingKey,
    expanded,
    keyboardFocused,
    queued,
    linked = false,
    pixelScale,
    reducedMotion,
    entrance = null,
    didDragRef,
    handlers,
}: BravaisTileProps) {
    countRender('BravaisTile');
    const faceRef = useRef<HTMLElement>(null);
    const target: BravaisTileFace = { item, kind, seeThrough };
    const [shown, setShown] = useState<BravaisTileFace>(target);
    const latestFaceRef = useRef(target);
    latestFaceRef.current = target;
    const outAnimationRef = useRef<Animation | null>(null);
    const inAnimationRef = useRef<Animation | null>(null);
    /** 转出段放完、等新内容渲染出来再转进的方向；整墙入场时是落回前还要等多久（毫秒）。 */
    const pendingInRef = useRef<{ direction: number; waveGap: number | null; fade: boolean } | null>(null);
    /** 整墙出场已经放完的那一次（token）：之后同一次里目标又变了，只换内容，不打断正在等着落回的入场。 */
    const waveOutDoneRef = useRef<number | null>(null);

    const targetKey = faceKeyOf(target);
    const shownKey = faceKeyOf(shown);
    const transition = resolveTileTransition(shownKey, targetKey, step, reducedMotion);
    // 同一项的数据更新就地刷新；翻牌途中（转到 90° 之前）仍画旧内容。
    const face = transition === 'flip' ? shown : target;
    const display = face.item;

    // 整墙出场 / 入场的那一次只按 token 认（stage 在入场途中数据到达时只改它的 `to`，见 useBravaisDisplay）：
    // 目标换了不重启动画，出场放完时取的是最新的内容。普通翻牌仍按「这一步 + 目标」认。
    const animationKey = step?.wave ? `wave:${step.token}` : `${step?.token ?? ''}|${step?.delay ?? ''}|${targetKey}`;
    useLayoutEffect(() => {
        if (transition === 'none') return;
        const face = faceRef.current;
        if (transition === 'swap' || !face || !step) {
            setShown(latestFaceRef.current);
            return;
        }
        // 这一次整墙出场已经放完、正等着落回：只换内容（入场动画照常进行，看不见的那一段里换掉）。
        if (step.wave && waveOutDoneRef.current === step.token) {
            setShown(latestFaceRef.current);
            return;
        }
        inAnimationRef.current?.cancel();
        inAnimationRef.current = null;
        // 降低动态效果：不错开、不抬起，原地淡出（整墙波次同样）。
        const fade = transition === 'fade';
        const wave = fade ? undefined : step.wave;
        const out = fade
            ? face.animate([SHOWN, FADED], { duration: FADE_HALF_MS, easing: 'ease-in', fill: 'forwards' })
            : wave
            ? face.animate([SETTLED, LIFTED], { duration: WALL_WAVE_OUT_MS, delay: step.delay, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' })
            : face.animate(
                [{ transform: rotation(0) }, { transform: rotation(90 * step.direction) }],
                { duration: BRAVAIS_TILE_FLIP_OUT_MS, delay: step.delay, easing: 'cubic-bezier(.55,0,.9,.45)', fill: 'forwards' },
            );
        outAnimationRef.current = out;
        out.onfinish = () => {
            pendingInRef.current = {
                direction: step.direction,
                waveGap: wave ? Math.max(0, wave.inDelay - step.delay - WALL_WAVE_OUT_MS) : null,
                fade,
            };
            if (wave) waveOutDoneRef.current = step.token;
            setShown(latestFaceRef.current);
        };
        return () => {
            // 转出段放完后由转进段接手取消；还没放完（目标又变了、卸载）就地取消，内容回正。
            if (pendingInRef.current === null && waveOutDoneRef.current !== step.token) out.cancel();
        };
    // animationKey 已经包含 step 与目标（整墙入场时故意不含目标）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [animationKey, transition]);

    useLayoutEffect(() => {
        const pending = pendingInRef.current;
        if (pending === null) return;
        pendingInRef.current = null;
        outAnimationRef.current?.cancel();
        outAnimationRef.current = null;
        const face = faceRef.current;
        if (!face) return;
        // 整墙入场：落回之前保持抬起、看不见（fill backwards 覆盖等待的那一段）。入场不随内容再换而取消
        // （由下一次出场 / 翻牌或卸载取消）。
        inAnimationRef.current?.cancel();
        const back = pending.fade
            ? face.animate([FADED, SHOWN], { duration: FADE_HALF_MS, easing: 'ease-out' })
            : pending.waveGap !== null
            ? face.animate([LIFTED, SETTLED], {
                duration: WALL_WAVE_IN_MS,
                delay: pending.waveGap,
                easing: 'cubic-bezier(.2,.9,.3,1.04)',
                fill: 'backwards',
            })
            : face.animate(
                [{ transform: rotation(-90 * pending.direction) }, { transform: rotation(0) }],
                { duration: BRAVAIS_TILE_FLIP_IN_MS, easing: 'cubic-bezier(.2,.7,.25,1)' },
            );
        inAnimationRef.current = back;
        back.onfinish = () => {
            if (inAnimationRef.current === back) inAnimationRef.current = null;
        };
    }, [shownKey]);
    // B11 整墙入场：只按 token 认（入场途中的数据更新沿用同一个 entrance，不重启）。已经在放的翻牌 / 波次让给它；
    // 落回之前保持抬起（fill backwards），刚挂载的磁贴也一样落回。入场窗口过了才挂载的不动。
    const entranceToken = entrance?.token ?? null;
    // 挂载时（第一次渲染）带着的入场：按它认「这次入场时刚挂载」。不按 effect 跑没跑过认——StrictMode 挂载后会卸载
    // 再挂载一遍（清理会取消落回），重放时仍要认作挂载、重新排落回。
    const mountEntranceTokenRef = useRef(entranceToken);
    useLayoutEffect(() => {
        const face = faceRef.current;
        if (!entrance || !face) return;
        // 只给这一刻挂载的磁贴（探索页原地重排：留在原地的不动，正在放的入场也不打断）。
        if (entrance.mountsOnly && entrance.token !== mountEntranceTokenRef.current) return;
        const now = performance.now();
        if (now >= entrance.until) return;
        const stagger = entrance.reduced ? 0 : getWaveStagger(rect, entrance.corner, BRAVAIS_METRICS);
        const delay = Math.max(0, entrance.startedAt + stagger - now);
        outAnimationRef.current?.cancel();
        outAnimationRef.current = null;
        pendingInRef.current = null;
        inAnimationRef.current?.cancel();
        const land = entrance.reduced
            ? face.animate([FADED, SHOWN], { duration: BRAVAIS_REDUCED_FADE_MS, delay, easing: 'ease-out', fill: 'backwards' })
            : face.animate([LIFTED, SETTLED], { duration: WALL_WAVE_IN_MS, delay, easing: 'cubic-bezier(.2,.9,.3,1.04)', fill: 'backwards' });
        inAnimationRef.current = land;
        land.onfinish = () => {
            if (inAnimationRef.current === land) inAnimationRef.current = null;
        };
    // 只在新的一次入场时跑（rect 取那一刻的）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [entranceToken]);
    useLayoutEffect(() => () => {
        inAnimationRef.current?.cancel();
        outAnimationRef.current?.cancel();
    }, []);

    // 透着的磁贴不画封面（2026-10-09 起连封面底条也不画），不取图；聚焦卡与普通磁贴按自己的尺寸取图。
    const coverUrl = useWallPosterArtwork(
        face.seeThrough ? undefined : display?.coverUrl,
        Math.max(rect.width, rect.height) * pixelScale,
    );
    const isTrack = display?.kind === 'track';
    const isWindow = face.kind === 'window';
    // 探索形状的 section 标题：只有字（序号、标题、这一段有几项哪几种），不能点、不进键盘走位（它不是条目）。
    const isHeading = face.kind === 'heading';
    const cover = display ? (coverUrl ? `url("${coverUrl}")` : fallbackBackground(display.key)) : undefined;
    const isCurrent = Boolean(display && nowPlayingKey && display.key === nowPlayingKey);
    const isExpanded = expanded && isTrack;
    const form = display ? resolveBravaisTileForm(display) : 'poster';
    const isStack = form === 'stack';
    const isPortrait = form === 'portrait';
    // 全透明档不画封面：歌手不做双色调（也就不取色）。头像本身加载不出来（tone === false）时也不画人像层。
    const portraitWanted = isPortrait && !face.seeThrough;
    const tone = useBravaisArtistTone(display?.coverUrl, portraitWanted);
    const drawsPortrait = portraitWanted && tone !== false;
    // 专辑墙（has-album-wall）：整面墙拼成的那一块，或从封面上切下来的碎片（bravaisAlbumWall）。聚焦卡画整张封面。
    const art = display && !face.seeThrough && !isExpanded ? display.coverArt : undefined;
    const artSpots = useBravaisCoverSpots(art?.mode === 'shard' ? art.url : undefined);
    const artUrl = useWallPosterArtwork(
        art?.url,
        (art?.mode === 'mosaic' ? BRAVAIS_ALBUM_MOSAIC_PX : Math.max(rect.width, rect.height) * 2.75) * pixelScale,
    );
    // 拼贴的大图到之前垫一张海报封面那档（已经在缓存里，放大后是糊的）：两层背景，大图解码完就盖住它。
    const artStandIn = art?.mode === 'mosaic' ? getSizedCoverUrl(art.url, BRAVAIS_ALBUM_COVER_PX) : '';
    const artImage = artStandIn && artStandIn !== artUrl ? `url("${artUrl}"), url("${artStandIn}")` : `url("${artUrl}")`;
    const artPlacement = !art || !display
        ? null
        : art.mode === 'mosaic' ? mosaicPlacement(rect, parseWallSlotKey(slotKey) ?? { column: 0, row: 0 }) : artSpots ? shardPlacement(artSpots, display.key, rect) : null;

    const handleClick = (event: MouseEvent<HTMLElement>) => {
        if (event.target instanceof Element && event.target.closest('button')) return;
        if (didDragRef.current) {
            didDragRef.current = false;
            return;
        }
        // 点专辑：记下这张封面此刻的样子，真打开了专辑，封面从这里飞到专辑海报上（bravaisCoverFlight）。
        if (display?.kind === 'album' && event.currentTarget.parentElement) {
            noteCoverFlightSource(event.currentTarget.parentElement, display.key, slotKey, display.coverUrl);
        }
        handlers.activate(slotKey);
    };

    const style = {
        transform: `translate3d(${rect.x}px, ${rect.y}px, 0)`,
        width: rect.width,
        height: rect.height,
        '--bravais-pop-x': ((rect.width + BRAVAIS_METRICS.gap * 2) / Math.max(rect.width, 1)).toFixed(4),
        '--bravais-pop-y': ((rect.height + BRAVAIS_METRICS.gap * 2) / Math.max(rect.height, 1)).toFixed(4),
    } as React.CSSProperties;

    return (
        <div
            className={`bravais-tile${isExpanded ? ' is-expanded' : ''}${keyboardFocused ? ' is-focused' : ''}`}
            style={style}
            data-bravais-slot={slotKey}
            data-bravais-kind={isWindow ? 'window' : isHeading ? 'heading' : display?.kind ?? 'wall'}
            data-bravais-see-through={face.seeThrough || undefined}
            data-library-entry={isTrack ? display?.key : undefined}
            data-library-card={display && !isTrack && !isHeading ? display.key : undefined}
            data-bravais-focused={keyboardFocused || undefined}
            data-bravais-expanded={isExpanded || undefined}
            data-bravais-current={isCurrent || undefined}
            data-bravais-linked={(linked && Boolean(display)) || undefined}
            data-bravais-dimmed={display?.dimmed || undefined}
            data-bravais-hidden={display?.hidden || undefined}
            data-bravais-special={display?.special}
            data-bravais-form={display && form !== 'poster' ? form : undefined}
            onMouseEnter={(event) => {
                if (!pointerStayed(event)) handlers.hover(slotKey);
            }}
            onMouseLeave={() => handlers.hover(null)}
        >
            <article
                ref={faceRef}
                className={`lattice-poster bravais-tile-face${isHeading ? ' is-heading' : display ? '' : isWindow ? ' is-window' : ' is-wall'}${face.seeThrough ? ' is-see-through' : ''}${isExpanded ? ' is-expanded' : ''}${keyboardFocused ? ' is-focused' : ''}${isCurrent ? ' is-current' : ''}${display?.unavailable ? ' is-unavailable' : ''}${linked && display ? ' is-linked' : ''}${display?.dimmed ? ' is-dimmed' : ''}${display?.selected ? ' is-selected' : ''}${isStack ? ' is-stack' : ''}${isPortrait ? ' is-portrait' : ''}`}
                style={display && !face.seeThrough && !isHeading ? { backgroundImage: cover } : undefined}
                data-bravais-art={art?.mode}
                role={display && !isHeading ? (isExpanded ? 'group' : 'button') : undefined}
                aria-label={display ? `${display.title} · ${display.subtitle}${display.trackCountLabel ? ` · ${display.trackCountLabel}` : ''}` : undefined}
                aria-expanded={isTrack ? isExpanded : undefined}
                tabIndex={-1}
                onMouseDown={isWindow ? preventFocus : undefined}
                onClick={handleClick}
            >
                {display && isHeading && (
                    <>
                        <BravaisTileBadge item={display} current={false} />
                        <span className="lattice-poster-copy">
                            {display.title && <WallTitle title={display.title} expanded={false} targetPosterWidth={rect.width} maxLines={2} />}
                            {display.subtitle && <small>{display.subtitle}</small>}
                        </span>
                    </>
                )}
                {display && !isHeading && (
                    <>
                        {drawsPortrait && (
                            <span
                                className="bravais-tile-duo"
                                data-bravais-tone={tone ? 'photo' : tone === null ? 'fallback' : 'pending'}
                                style={tone ? { '--bravais-duo-light': tone } as React.CSSProperties : undefined}
                            >
                                <i style={{ backgroundImage: cover }} />
                            </span>
                        )}
                        {art && artPlacement && artUrl && (
                            <span
                                className="bravais-tile-art"
                                data-bravais-art={art.mode}
                                style={{
                                    '--bravais-art-image': artImage,
                                    '--bravais-art-size': `${artPlacement.size.toFixed(1)}px`,
                                    '--bravais-art-x': `${artPlacement.x.toFixed(1)}px`,
                                    '--bravais-art-y': `${artPlacement.y.toFixed(1)}px`,
                                } as React.CSSProperties}
                            >
                                <i />
                            </span>
                        )}
                        <span className="lattice-poster-shade" />
                        {/* 实测反馈 1：熄灯层（wall.css；全透明档的窗与聚焦卡等豁免在 bravais.css）。 */}
                        <span className="lattice-poster-lights-out" />
                        {!face.seeThrough && <span className="lattice-poster-tint" />}
                        <BravaisTileBadge item={display} current={isCurrent} />
                        {(display.hideable || display.selected) && (
                            <BravaisTileMarks
                                item={display}
                                onToggleHidden={handlers.toggleHidden ? () => handlers.toggleHidden?.(slotKey) : undefined}
                            />
                        )}
                        {isExpanded ? (
                            <BravaisFocusCardBody
                                slotKey={slotKey}
                                item={display}
                                queued={queued}
                                current={isCurrent}
                                titleWidth={rect.width}
                                actions={handlers}
                            />
                        ) : (
                            <>
                            {rect.width >= BRAVAIS_QUICK_ACTIONS_MIN_WIDTH && (
                                <BravaisTileQuickActions slotKey={slotKey} item={display} actions={handlers} />
                            )}
                            <span className="lattice-poster-copy">
                                <WallTitle
                                    title={display.title}
                                    expanded={false}
                                    targetPosterWidth={rect.width}
                                    variant={isPortrait ? form : undefined}
                                />
                                {display.subtitle && <small>{display.subtitle}</small>}
                            </span>
                            </>
                        )}
                    </>
                )}
            </article>
        </div>
    );
}

export default memo(BravaisTile, arePropsEqual);
