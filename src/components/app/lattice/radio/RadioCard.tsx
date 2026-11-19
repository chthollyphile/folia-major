import { lazy, memo, Suspense, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { motion, useAnimate, useTransform, type MotionValue, type TargetAndTransition } from 'framer-motion';
import { Play } from 'lucide-react';
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
import { useRadioCardTilt } from './useRadioCardTilt';
import { radioCardRect, radioRedactionWidths, radioStationDrop, type RadioCardRole, type RadioMetrics } from './radioWallModel';
import { RADIO_NOW_ATTR } from './useRadioWallHandoff';

// src/components/app/lattice/radio/RadioCard.tsx
// 电台墙的一张卡。两面：正面是封面（与队列墙的海报同一套样式，正在播放的那张在正中时带歌词和播放控制条），背面是
// 隔着棱纹玻璃的模糊封面加两道打码条（曲名、歌手按字数）。还没轮到的卡背面朝上；轮到它时翻开，之后一直是正面。
// 离开这一行时翻回背面、淡出（翻牌销毁）。
// 卡在哪由电台墙的「轨道」决定（rail：一个 MotionValue，切歌、拖动浏览、松手吸附都只是让它挪动）：卡的位置、大小、
// 倾斜都从「自己在轨道上的格（position）减去轨道当前位置」算出来，逐帧跟着走，不经过 React。
// 已经揭开的卡升为正在播放时（点了一张听过的，或者往回点过之后再往前走）也翻一次牌（半圈），从右边来的往左翻、
// 从左边来的往右翻；从左边补回来的卡背面朝上进来，落位时翻开。

const LatticeLyrics = lazy(() => import('../lyrics/LatticeLyrics'));

/**
 * 卡怎么进来（只在挂上时读）：opening 是打开电台墙时整圈一张张浮上来；deal 是之后新补的卡，随轨道从弧上更外面
 * 滑进来、淡入；appear 是一直在这一行里、只是先前在窗口外没挂的卡（浏览时走进窗口），直接出现。
 */
export type RadioCardEntry =
    | { kind: 'opening'; delay: number }
    | { kind: 'deal' }
    | { kind: 'appear' };

type RadioCardProps = {
    tile: LatticeSongTile;
    role: RadioCardRole;
    /** 相对正在播放那张的位置（负数是听过的）。 */
    offset: number;
    /** 在轨道上的格：卡此刻的位置 = radioCardRect(position - rail)。 */
    position: number;
    /** 浏览停下后这张卡离画面正中几格（整数）；0 是正中那张。 */
    slot: number;
    rail: MotionValue<number>;
    metrics: RadioMetrics;
    /** 正面朝上（正在播放、听过的，或者这次打开以来播过的）。 */
    revealed: boolean;
    /** 只在挂上时读。 */
    entry: RadioCardEntry;
    /** 轨道停稳了（不在切歌滑动、拖动、吸附途中）：正中那张的歌词等它停稳再挂。 */
    resting: boolean;
    /** 打开电台墙时那一波还没跑完：歌词场景和背面取色都等它跑完再起，不和进场动画抢帧。 */
    entering: boolean;
    /** 正在拖动浏览：卡的倾斜按压收回去。 */
    dragging: boolean;
    pixelRatio: number;
    reducedMotion: boolean;
    /** 播放这一首（私人 FM 里仍在电台里播放）。 */
    onPlay: (tile: LatticeSongTile) => void;
    /** 双击正中这张：播放它；正在播放的那张暂停着就继续，从不暂停。 */
    onPlayFromWall: (tile: LatticeSongTile) => void;
    onTogglePlayback: () => void;
    onSeek: (time: number) => void;
    onOpenPlayer: () => void;
    /** 单击（或回车）一张不在正中的卡：把它带到正中（只是浏览，不播放；正在播放那张就是回到它）。 */
    onBrowse: (offset: number) => void;
};

const FLIP_TRANSITION = { duration: 0.55, ease: [0.4, 0, 0.2, 1] as const };
/** 揭开到翻面之间留给背面打码条动画的时间：条滑开、字显出来播完了，卡才翻到正面。 */
const BACK_REVEAL_MS = 950;
/** 翻面本身的时长：翻完背面就看不见了，背面的对焦层随之卸掉。 */
const FLIP_MS = FLIP_TRANSITION.duration * 1000;
const DEAL_SPRING = { type: 'spring' as const, stiffness: 240, damping: 30, mass: 0.9 };
const PERSPECTIVE_PX = 1400;
/** 倾斜按压用的透视：比翻牌近一些，压下去才看得出来。 */
const TILT_PERSPECTIVE_PX = 900;

// 取色之前、取不到时的底色：按歌曲 id 算一个色相（与队列墙海报没有封面时同一个算法）。
const fallbackTint = (id: string) => {
    let sum = 0;
    for (let index = 0; index < id.length; index += 1) sum += id.charCodeAt(index);
    const hue = sum % 360;
    return `hsl(${hue} 52% 40%)`;
};

/**
 * 正中正在播放那张的标题：电台墙把它排成一行 22px（RadioWall.css，和歌词出来后的那一行一样），和海报墙展开海报
 * 的大标题不是一种排版，按自己的形状拟合、自己存缓存（WallTitle 的 variant / maxLines），两面墙不互相串。
 */
const EXPANDED_TITLE = { variant: 'radio', maxLines: 1 } as const;

function RadioCard({
    tile,
    role,
    offset,
    position,
    slot,
    rail,
    metrics,
    revealed,
    entry,
    resting,
    entering,
    dragging,
    pixelRatio,
    reducedMotion,
    onPlay,
    onPlayFromWall,
    onTogglePlayback,
    onSeek,
    onOpenPlayer,
    onBrowse,
}: RadioCardProps) {
    const { t } = useTranslation();
    const isNow = role === 'now';
    const focused = slot === 0;
    // 正在播放、而且在画面正中：带歌词和控制条的那种大卡。被浏览到一边时只是一张普通的封面卡。
    const expanded = isNow && focused;
    const chrome = useLatticeChromeDisclosure(expanded);
    // 卡的位置逐帧从轨道算出来（useTransform 每次渲染都换上新的 position / metrics）。
    const place = (at: number) => radioCardRect(position - at, metrics);
    const x = useTransform(rail, value => place(value).x);
    const y = useTransform(rail, value => place(value).y);
    const width = useTransform(rail, value => place(value).width);
    const height = useTransform(rail, value => place(value).height);
    const rotate = useTransform(rail, value => place(value).rotate);
    // 台线（这张卡垂到电台带上的那根线和末端的点）：长度逐帧从轨道算，端点始终落在电台带上；短到几像素以下就淡掉
    // （卡滑到正中、下沿越过电台带时）。只动 transform 和 opacity。
    const stationDrop = useTransform(rail, value => radioStationDrop(place(value), metrics));
    const stationOpacity = useTransform(stationDrop, drop => Math.min(1, drop / 6));
    // 停稳之后这张卡的外框：封面按它要清晰度，标题按它排版。
    const rest = radioCardRect(slot, metrics);
    // 已经正面朝上的卡升为正在播放时翻半圈：外面单独一层（lattice-radio-card-spin）先转到侧立（±90°），
    // 再从另一侧的侧立转回 0°。看着是翻了 180°，停下时仍是封面朝外，两面不用交换。从右边来的往左翻，从左边来的
    // 往右翻。角色的变化按渲染时记（React 的「随 props 调整 state」写法）；还没揭开的卡升上来时走下面那次揭开
    // （180° → 0°），不另翻。
    const [spin, setSpin] = useState<{ count: number; direction: 1 | -1 }>({ count: 0, direction: 1 });
    const [shown, setShown] = useState({ role, revealed });
    // 揭开分两步：revealed 变 true 后先留在背面，让涂黑条滑开、字显出来（背面动画播完），
    // 卡才翻到正面；翻过去之后封面再从模糊对焦到清晰。reduced-motion 或卡本来就正面朝上
    // （played → now 的半圈翻不经过背面）时直接翻，不等。
    // 揭开的阶段：back = 留在背面跑显字与对焦；flip = 正在翻面；done = 落定（背面的对焦层卸掉）。
    const [revealStage, setRevealStage] = useState<'back' | 'flip' | 'done'>(revealed ? 'done' : 'back');
    if (shown.role !== role || shown.revealed !== revealed) {
        setShown({ role, revealed });
        if (revealed && !shown.revealed && !reducedMotion) {
            // 从盖着到揭开：先在背面跑涂黑条动画，播完才放行翻面。
            setRevealStage('back');
        }
        if (role === 'now' && shown.role !== 'now' && shown.revealed) {
            setSpin(value => ({ count: value.count + 1, direction: shown.role === 'played' ? 1 : -1 }));
        }
    }
    useEffect(() => {
        if (!revealed || revealStage === 'done') return;
        // 减弱动效下直接落定：之后再关掉减弱动效，已揭开的卡也不会翻回背面重来一遍。
        const delay = reducedMotion ? 0 : revealStage === 'back' ? BACK_REVEAL_MS : FLIP_MS;
        const timer = setTimeout(() => setRevealStage(revealStage === 'back' && !reducedMotion ? 'flip' : 'done'), delay);
        return () => clearTimeout(timer);
    }, [reducedMotion, revealStage, revealed]);
    const flipReady = revealStage !== 'back' || reducedMotion;
    // 已经正面朝上的卡升为正在播放时翻半圈（不经过背面），放行条件直接满足。
    const flipAngle = revealed && flipReady ? 0 : 180;
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
    // Metro 式的倾斜按压：指针所在的那一点往里压。正中那张大卡上有歌词和控制条，压得浅一些。
    const tilt = useRadioCardTilt({
        maxDeg: expanded ? 2.5 : 7,
        hoverScale: expanded ? 0.995 : 0.98,
        pressScale: expanded ? 0.99 : 0.97,
        disabled: reducedMotion,
    });
    // 一开始拖动浏览，指针就不归这张卡了：按下去的倾斜收回来。
    const releaseTilt = tilt.handlers.onPointerLeave;
    useEffect(() => {
        if (dragging) releaseTilt();
    }, [dragging, releaseTilt]);
    // 从左边补回来的卡（往回退时）背面朝上进场，落位时翻开；只在挂上时读。
    const entersFaceDown = !reducedMotion && entry.kind === 'deal' && offset < 0 && revealed;
    // 歌词是按卡的大小排版的 Pixi 场景：等打开时的浮入结束、轨道也停稳了再挂，不在卡变大的每一帧重排。
    const [settled, onAnimationComplete] = useLatticeExpansionSettled(expanded, reducedMotion);
    // 卡长大不再是这张卡自己的动画（是轨道在动）：轨道从动到停的那一刻也算长完。只认「动 → 停」，打开时轨道本来
    // 就是停着的，那时仍等浮入动画结束。
    // 打开时那一波跑完之前也算没停稳：歌词场景（WebGL、着色器、量字）留到它之后再挂。
    const rests = resting && !entering;
    const restedRef = useRef(rests);
    useEffect(() => {
        if (rests && !restedRef.current) onAnimationComplete();
        restedRef.current = rests;
    }, [onAnimationComplete, rests]);
    const showsLyrics = expanded && settled && rests && !dragging;
    const coverUrl = useWallPosterArtwork(tile.coverUrl, Math.max(rest.width, rest.height) * pixelRatio);
    // 背面：取样回来之前是中性色，回来后颜色过渡过去，不硬切；取不到时退回按 id 算的颜色、没有模糊封面。
    const cover = useRadioCoverTint(tile.coverUrl, { deferred: entering });
    const tint = cover.settled ? cover.color ?? fallbackTint(tile.id) : null;
    const redaction = radioRedactionWidths(tile.title, tile.artist);

    // 进场、离场只动这一层（位置在外层，由轨道管）。
    const poseInitial: TargetAndTransition | false = reducedMotion
        ? false
        : entry.kind === 'opening'
            ? { y: 48, opacity: 0, scale: 0.92 }
            : entry.kind === 'deal' ? { opacity: 0 } : false;
    const poseExit: TargetAndTransition = reducedMotion
        ? { opacity: 0, transition: { duration: 0 } }
        : {
            rotateY: offset < 0 ? -180 : 180,
            scale: 0.82,
            opacity: [1, 1, 0],
            transition: { duration: 0.5, ease: [0.4, 0, 0.2, 1], opacity: { duration: 0.5, times: [0, 0.6, 1] } },
        };
    const poseTransition = reducedMotion
        ? { duration: 0 }
        : {
            ...DEAL_SPRING,
            delay: entry.kind === 'opening' ? entry.delay : 0,
            opacity: { duration: 0.28, delay: entry.kind === 'opening' ? entry.delay : 0 },
        };

    // 和队列墙的海报一样（LatticePoster 的 handleClick / handleDoubleClick，wallDoubleClick 的判定）：单击只把卡
    // 带到正中，双击才播放，而且两下都要点在同一张卡上。双击的第一下点在不在正中的卡上时只记一个空记号：这一下把卡
    // 带到正中，这次双击不播放（第二下多半落在滑过来的别的卡上，也不播放）；在正中的卡上双击才播放。
    const pressKey = `lattice-radio:${tile.id}`;
    const handleClick = (event: MouseEvent<HTMLElement>) => {
        const onControl = event.target instanceof Element && Boolean(event.target.closest('button, input'));
        noteWallPress(event, onControl || !focused ? '' : pressKey);
        if (onControl) return;
        // 连击的后几下落在了别的卡上（第一下让这一行滑动了）：不算点这张，不把这一行又带走。
        if (event.detail > 1 && !isWallDoubleClickOn(pressKey)) return;
        if (expanded) chrome.toggleTouch();
        else if (!focused) onBrowse(offset);
        // 读屏器、语音控制的「激活」不是指针点下去的（detail 为 0），没有双击可用：正中这张就当回车，播放它。
        else if (event.detail === 0) onPlay(tile);
    };
    const handleDoubleClick = (event: MouseEvent<HTMLElement>) => {
        if (event.target instanceof Element && event.target.closest('button, input')) return;
        // 记号可能是早先在正中时留下的（之后点了空白处、或两下之间切了歌把它挪走）：此刻也得在正中。
        if (focused && isWallDoubleClickOn(pressKey)) onPlayFromWall(tile);
    };
    const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        if (event.target !== event.currentTarget || event.repeat) return;
        // 卡只用回车（和队列墙的海报一样：第一下带到正中，第二下播放这一首 / 暂停继续正在播放的）。空格留给全局的
        // 播放 / 暂停：点过一张卡之后焦点停在卡上，卡要是把空格吃掉，空格就暂停不了了。
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            if (expanded) onTogglePlayback();
            else if (focused) onPlay(tile);
            else onBrowse(offset);
        }
    };

    const label = revealed
        ? `${tile.title} · ${tile.artist}`
        : t('home.latticeRadioHidden');

    return (
        <motion.div
            className={`lattice-radio-card ${isNow ? 'is-now' : `is-${role}`} ${revealed ? 'is-revealed' : ''} ${focused ? 'is-focused' : ''}`}
            data-radio-card={offset}
            {...(isNow ? { [RADIO_NOW_ATTR]: '' } : {})}
            style={{ x, y, width, height, rotate, zIndex: 20 - Math.min(19, Math.abs(slot) * 4) }}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            onKeyDown={handleKeyDown}
            onPointerEnter={(event: PointerEvent<HTMLElement>) => { if (expanded) prewarmLatticeLyrics(); chrome.onPointerEnter(event); }}
            onPointerLeave={() => { chrome.onPointerLeave(); tilt.handlers.onPointerLeave(); }}
            onPointerDownCapture={chrome.onPointerDownCapture}
            onPointerMove={tilt.handlers.onPointerMove}
            onPointerDown={tilt.handlers.onPointerDown}
            onPointerUp={tilt.handlers.onPointerUp}
            onPointerCancel={tilt.handlers.onPointerCancel}
            onFocusCapture={chrome.onFocusCapture}
            onBlurCapture={chrome.onBlurCapture}
            role={expanded ? 'group' : 'button'}
            tabIndex={0}
            aria-label={label}
        >
            <motion.div
                className="lattice-radio-card-pose"
                initial={poseInitial}
                animate={{ y: 0, opacity: 1, scale: 1, rotateY: 0 }}
                exit={poseExit}
                transition={poseTransition}
                style={{ transformPerspective: PERSPECTIVE_PX }}
                onAnimationComplete={onAnimationComplete}
            >
                <motion.div className="lattice-radio-card-tilt" style={{ ...tilt.style, transformPerspective: TILT_PERSPECTIVE_PX }}>
                    <div ref={spinScope} className="lattice-radio-card-spin">
                        <motion.div
                            className="lattice-radio-card-inner"
                            initial={entersFaceDown ? { rotateY: flipAngle + 180 } : false}
                            animate={{ rotateY: flipAngle }}
                            transition={reducedMotion ? { duration: 0 } : FLIP_TRANSITION}
                        >
                            <article
                                ref={chrome.articleRef}
                                className={`lattice-poster lattice-radio-face is-front ${isNow ? 'is-current' : ''} ${expanded ? 'is-expanded' : ''}`}
                                style={{ backgroundImage: coverUrl ? `url("${coverUrl}")` : undefined }}
                                aria-hidden={!revealed}
                            >
                                {/* 揭开那一下：封面叠一层高斯模糊、略放大的自己，落定后对焦到清晰。
                                    只在揭开（背面 → 正面）时跑这一次；reduced-motion 下不叠。 */}
                                {revealed && revealStage === 'flip' && !reducedMotion && coverUrl && (
                                    <span
                                        key={`focus-${tile.id}`}
                                        className="lattice-radio-focus"
                                        style={{ backgroundImage: `url("${coverUrl}")` }}
                                        aria-hidden
                                    />
                                )}
                                <span className="lattice-poster-shade" />
                                <span className="lattice-poster-lights-out" />
                                <span className="lattice-poster-tint" />
                                {revealed && <LatticeQuickActions tile={tile} width={rest.width} expanded={expanded} />}
                                {showsLyrics ? (
                                    <Suspense fallback={<span className="lattice-poster-copy"><WallTitle title={tile.title} expanded targetPosterWidth={rest.width} {...EXPANDED_TITLE} /><small>{tile.artist}</small></span>}>
                                        <LatticeLyrics key={tile.id} tile={tile} reducedMotion={reducedMotion} />
                                    </Suspense>
                                ) : (
                                    <span className="lattice-poster-copy">
                                        <WallTitle title={tile.title} expanded={expanded} targetPosterWidth={rest.width} {...(expanded ? EXPANDED_TITLE : {})} />
                                        <small>{tile.artist}</small>
                                    </span>
                                )}
                                {focused && !isNow && revealed && (
                                    // 浏览到正中的别的歌：右下角一枚播放按钮，点一下就播放（和队列墙展开海报上的播放键对应）；
                                    // 双击整张卡、按回车也播放。
                                    <button type="button" className="lattice-radio-play-hint" aria-label={t('player.play')}
                                        title={t('player.play')} onClick={event => { if (event.detail < 2) onPlay(tile); }}><Play /></button>
                                )}
                                {expanded && (
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
                            <div
                                className={`lattice-radio-face is-back ${tint ? 'is-tinted' : ''}`}
                                style={{
                                    ...(tint ? { '--lattice-radio-tint': tint } : {}),
                                    ...(cover.veil ? { '--lattice-radio-veil': `url("${cover.veil}")` } : {}),
                                } as CSSProperties}
                                aria-hidden
                            >
                                {cover.veil && <span className="lattice-radio-veil" />}
                                {/* 揭开那一下，真封面在模糊封面上淡入：隔着棱纹玻璃慢慢看清的是真正的封面
                                    内容，不是一团颜色。翻到正面时已经清晰，正面的对焦层只收尾。
                                    只走 opacity，不挂滤镜（卡逐帧变尺寸，滤镜每帧都要重算）。 */}
                                {revealed && !reducedMotion && coverUrl && (
                                    <span
                                        key={`unveil-${tile.id}`}
                                        className="lattice-radio-unveil"
                                        style={{ backgroundImage: `url("${coverUrl}")` }}
                                        aria-hidden
                                    />
                                )}
                                <span className="lattice-radio-reeds" />
                                <span className="lattice-radio-redaction">
                                    {/* 每条：涂黑条压在字上。揭开（.is-revealed）时条朝右滑走、字从左显出来。 */}
                                    <i className="lattice-radio-redaction-line" style={{ width: `${redaction.title}%` }}>
                                        <b className="lattice-radio-redaction-text">{tile.title}</b>
                                        <b className="lattice-radio-redaction-bar" />
                                    </i>
                                    <i className="lattice-radio-redaction-line" style={{ width: `${redaction.artist}%` }}>
                                        <b className="lattice-radio-redaction-text">{tile.artist}</b>
                                        <b className="lattice-radio-redaction-bar" />
                                    </i>
                                </span>
                            </div>
                        </motion.div>
                    </div>
                </motion.div>
                {/* 四角的对位标记（代替卡面的发丝线外框），在倾斜层外面：按下时卡往里压，框不动。 */}
                <span className="lattice-radio-card-marks" aria-hidden />
                <motion.span className="lattice-radio-station" style={{ opacity: stationOpacity }} aria-hidden>
                    <motion.i className="lattice-radio-station-line" style={{ scaleY: stationDrop }} />
                    <motion.i className="lattice-radio-station-dot" style={{ y: stationDrop }} />
                </motion.span>
            </motion.div>
        </motion.div>
    );
}

// 每次渲染 RadioWall 都重算磁贴（队列、当前曲目一变就是新对象），按值比，不按对象比；entry 只在挂上时读。
const sameProps = (previous: RadioCardProps, next: RadioCardProps) => {
    for (const key of Object.keys(next) as (keyof RadioCardProps)[]) {
        if (key === 'tile' || key === 'entry') continue;
        if (!Object.is(previous[key], next[key])) return false;
    }
    const tileA = previous.tile;
    const tileB = next.tile;
    return tileA.id === tileB.id && tileA.song === tileB.song && tileA.title === tileB.title
        && tileA.artist === tileB.artist && tileA.coverUrl === tileB.coverUrl && tileA.section === tileB.section;
};

export default memo(RadioCard, sameProps);
