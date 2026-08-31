import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Music } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../../types';
import { useTransitionBorderCue } from './now-playing-toast/useTransitionBorderCue';

// src/components/app/overlays/NowPlayingToast.tsx
// 歌词页左下角的 now playing 卡片（playing-toast 样式：圆角 2xl、44px 封面、底部滑入）。
// 歌名上方带 "正在播放 / 接下来播放" 标签。
// 显示模式：auto=显示 timeoutSec 秒后淡出（换歌重新计时），always=常驻，never=不渲染。
// isNextUp=自动切歌预览（automix 混合或普通曲目结束倒计时）：强制显示下一首并挂
// "接下来播放" 标签，切完后翻回 "正在播放"。
// automix 混音期间边框上会长出一圈进度描边（见 now-playing-toast/NowPlayingToastTransitionBorder
// .tsx）。开不开是「卡片描边」那个设置说了算，而这张卡片不读那个开关——useTransitionBorderCue
// 读，一个开关只该有一个读的地方。混音期间卡片自己撑开不隐藏：描边挂在卡片里，卡片淡出了就没
// 地方画了。

// 着色器描边只有真的在混音时才用到，懒加载让 @paper-design/shaders 的 chunk 不进主包；
// 混音开始前有几秒（arm 早于 fade）足够它加载完。
const NowPlayingToastTransitionBorder = lazy(() => import('./now-playing-toast/NowPlayingToastTransitionBorder'));

/** 卡片圆角，和下面的 rounded-2xl 对齐；描边要按它算圆角 */
const CARD_RADIUS = 16;

export type StageTrackPillMode = 'auto' | 'always' | 'never';

export interface NowPlayingToastSong {
    title: string;
    artist: string | null;
    coverUrl: string | null;
}

type NowPlayingToastProps = {
    song: NowPlayingToastSong;
    trackKey: string;
    isDaylight: boolean;
    /** 显示模式：auto=限时，always=常驻，never=不渲染 */
    mode?: StageTrackPillMode;
    /** auto 模式显示时长（秒） */
    timeoutSec?: number;
    /** 自动切歌预览的数据（下一首）；isNextUp 时整卡展示它 */
    nextUp?: NowPlayingToastSong | null;
    /** 预览态：下一首内容 + 接下来播放标签 + 挂起 auto 隐藏计时 */
    isNextUp?: boolean;
    /** 描边取 accentColor，和全屏圆环同一个颜色 */
    theme?: Theme;
    /** 点卡片做什么；不给就还是个纯展示的卡片，不吃鼠标 */
    onActivate?: () => void;
    /** onActivate 的无障碍名字，说清楚点下去会发生什么 */
    activateLabel?: string;
};

const NowPlayingToast: React.FC<NowPlayingToastProps> = ({
    song,
    trackKey,
    isDaylight,
    mode = 'auto',
    timeoutSec = 10,
    nextUp = null,
    isNextUp = false,
    theme,
    onActivate,
    activateLabel,
}) => {
    const { t } = useTranslation();

    // 预览态内容收口：isNextUp 且给了 nextUp 时整卡展示下一首，否则常规
    const shown = isNextUp && nextUp ? nextUp : song;
    const label = isNextUp ? t('ui.stageTrackPillNext') : t('ui.stageTrackPillNow');

    // The last cover URL that failed to load, so a dead one falls back to the placeholder instead
    // of a blank square. Only the latest is remembered: a URL that comes back later gets a fresh
    // attempt, which is what a transient network failure deserves.
    const [brokenCoverUrl, setBrokenCoverUrl] = useState<string | null>(null);
    const coverSrc = shown.coverUrl && shown.coverUrl !== brokenCoverUrl ? shown.coverUrl : null;

    // 正在进行的混音。开关是在 cue 到达的那一刻从 settings store 里读的（见 hook 里的注释），
    // 所以拿到非空 cue 就意味着「过渡动画开着 + 模式是 automix」，不用再问一遍 prop。
    // 它同时参与下面的 holdOpen：混音期间卡片必须留在屏幕上，否则描边跟着卡片一起卸载，
    // 而全屏圆环已经让位了。
    const transitionCue = useTransitionBorderCue();

    // 可见性状态机：never 不渲染；always 常驻；auto 换歌重新计时。
    // isNextUp（预览下一首）挂起计时，翻回 false 后（即使 trackKey 没变）重新计时。
    const [visible, setVisible] = useState(mode !== 'never');
    const holdOpen = mode === 'always' || isNextUp || transitionCue !== null;
    const hideDelayMs = Math.max(3, Math.min(60, Math.round(timeoutSec))) * 1000;
    useEffect(() => {
        if (mode === 'never') {
            setVisible(false);
            return;
        }
        setVisible(true);
        if (holdOpen) return;
        // 上一轮的 cleanup 一定在本轮之前跑完，所以不需要额外记 timeout id
        const timer = window.setTimeout(() => setVisible(false), hideDelayMs);
        return () => window.clearTimeout(timer);
    }, [mode, hideDelayMs, trackKey, holdOpen]);

    // 描边要的是卡片的实际尺寸（内容撑出来的，没有固定宽高），所以量一下外层容器：
    // 它是 fixed 且没给宽度，会收缩到卡片大小，而且不会随 trackKey 重挂。
    // 描边本身是绝对定位、外扩一圈的兄弟节点，不参与这个尺寸。
    //
    // 卡片在场就一直量，不看那个设置：量的是提前量，描边一到就要知道画布多大，等 ResizeObserver
    // 回调会晚一帧。挂个条件上去就等于把「卡片描边」那个开关又读了第二遍，而它已经有一个读的
    // 地方了（useTransitionBorderCue）——同一个开关两个读点、两个时机，正是这块出过的那个 bug。
    const frameRef = useRef<HTMLDivElement | null>(null);
    const [cardSize, setCardSize] = useState({ width: 0, height: 0 });
    useEffect(() => {
        const frame = frameRef.current;
        if (!frame || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(([entry]) => {
            // contentRect 而不是 getBoundingClientRect：外层这一圈在做 x 位移动画，
            // 后者会把 transform 算进去。
            const { width, height } = entry.contentRect;
            setCardSize(prev => (
                Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5
                    ? prev
                    : { width, height }
            ));
        });
        observer.observe(frame);
        return () => observer.disconnect();
    }, [visible]);

    return (
        <AnimatePresence>
            {visible && (
                <motion.div
                    ref={frameRef}
                    initial={{ opacity: 0, x: -32 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={{ duration: 0.35, ease: 'easeOut' }}
                    // bottom-8 跟右下角面板开关按钮（UnifiedPanel 的 fixed bottom-8）对齐，
                    // 两边底边落在同一条线上。
                    className="pointer-events-none fixed bottom-8 left-6 z-40"
                >
                    {/* 描边排在卡片前面：卡片自己是 relative，绘制顺序上压在描边上头，所以
                        描边内侧那一半被卡片背景盖住，露在外面的是外侧 + 辉光。
                        AnimatePresence 在这儿单独开一层，混音结束时描边自己淡出，不用等卡片；
                        Suspense 套在外面而不是里面，否则 chunk 还没到时它会顶掉 AnimatePresence
                        的直接子节点，退场就丢了。 */}
                    <Suspense fallback={null}>
                        <AnimatePresence>
                            {transitionCue && cardSize.width > 0 && (
                                <NowPlayingToastTransitionBorder
                                    key="transition-border"
                                    cue={transitionCue.cue}
                                    startAtMs={transitionCue.startAtMs}
                                    cardWidth={cardSize.width}
                                    cardHeight={cardSize.height}
                                    cardRadius={CARD_RADIUS}
                                    isDaylight={isDaylight}
                                    theme={theme}
                                />
                            )}
                        </AnimatePresence>
                    </Suspense>
                    {/* Toast 卡片（playing-toast 样式）。

                        没有 key，所以卡片在场期间不会因为换内容重挂：正在播放 → 预告下一首 →
                        那首真的播起来，是一条连续的事，中间不该滑出再滑进来。内容就地换掉，宽度
                        由 layout="size" 补间过去——短的正在播放跳到长的接下来播放，看到的是卡片
                        自己变长。进场动画留给「卡片出现」那一次（外层 AnimatePresence 管挂载）。

                        layout="size" 只管尺寸，位移和按下反馈留给 initial/whileTap，不进 layout。

                        给了 onActivate 就渲染成真的 button：键盘和焦点环白送，而且外层那层
                        pointer-events-none 只在这一个元素上翻回来——描边和扫光都还是不吃鼠标的。 */}
                    <motion.button
                        data-toast-card=""
                        type="button"
                        layout="size"
                        onClick={onActivate}
                        disabled={!onActivate}
                        aria-label={onActivate ? activateLabel : undefined}
                        initial={{ opacity: 0, x: -24 }}
                        animate={{ opacity: 1, x: 0 }}
                        whileTap={onActivate ? { opacity: 0.85 } : undefined}
                        transition={{ duration: 0.35, ease: 'easeOut' }}
                        className={`relative flex min-w-[240px] items-center gap-3 overflow-hidden rounded-2xl border p-2 pr-4 text-left backdrop-blur-xl shadow-lg transition-colors ${
                            isDaylight ? 'border-black/10 bg-white/35 text-zinc-900' : 'border-white/10 bg-black/35 text-white'
                        } ${onActivate
                            ? `pointer-events-auto cursor-pointer ${isDaylight ? 'hover:bg-white/55' : 'hover:bg-black/55'}`
                            : ''}`}
                    >
                        {/* 顶部光线（进场的横向扫光）。混音期间收掉：描边现在正压在卡片边框上，
                            再叠一条亮线就是同一条边上两层东西，读起来是好几层边框套在一起。 */}
                        <motion.span
                            aria-hidden
                            data-toast-sheen=""
                            initial={{ scaleX: 0 }}
                            animate={{ scaleX: 1, opacity: transitionCue ? 0 : 1 }}
                            transition={{ duration: 0.5, ease: 'easeOut' }}
                            className={`absolute inset-x-0 top-0 h-[2px] origin-left ${
                                isDaylight
                                    ? 'bg-gradient-to-r from-transparent via-black/40 to-transparent'
                                    : 'bg-gradient-to-r from-transparent via-white/50 to-transparent'
                            }`}
                        />
                        {/* 封面和文字块也带 layout：卡片的尺寸补间是靠 transform 做的，途中
                            没有自己 layout 的子节点会被一起拉扁。带上它俩，framer 会逐层把缩放
                            反解掉，封面不变形、歌名不横向压扁。 */}
                        <motion.div
                            layout
                            // Which of the two the frame settled on, so a test can tell "showed the
                            // cover" from "fell back" - the difference used to be invisible from
                            // the outside, which is how the blank square went unnoticed.
                            data-toast-cover={coverSrc ? 'image' : 'placeholder'}
                            className={`relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg ${
                                isDaylight ? 'bg-zinc-200' : 'bg-zinc-800'
                            }`}
                        >
                            {/* An <img> rather than a background-image, for the two things a
                                background cannot do: it reports failure, and the browser parses the
                                URL instead of the CSS tokenizer (an unquoted url() is voided
                                outright by a space, a bracket or the comma in a multi-value cover
                                field, and voided silently). Failure matters because a cover URL
                                here can be a revoked blob - the media cache mints object URLs and
                                takes them back on the next track - and a dead URL used to leave a
                                bare grey square, since the placeholder below only stood in when
                                there was no URL at all. */}
                            {coverSrc && (
                                <img
                                    key={coverSrc}
                                    src={coverSrc}
                                    alt=""
                                    aria-hidden
                                    decoding="async"
                                    draggable={false}
                                    onError={() => setBrokenCoverUrl(coverSrc)}
                                    className="absolute inset-0 h-full w-full object-cover"
                                />
                            )}
                            {!coverSrc && <Music size={18} className={isDaylight ? 'text-black/35' : 'text-white/35'} />}
                        </motion.div>
                        <motion.div layout className="min-w-0 max-w-[200px] flex-1">
                            {/* 正在播放 / 接下来播放：歌名上方。切歌那一刻整张卡片不重挂，所以这
                                一行是自己淡入淡出换掉的，不跟着进场动画走。
                                高度写死成和 leading 一样的 10px：mode="wait" 换字的中途这一行是
                                空的，不占住高度的话歌名会往上跳一下再落回来。 */}
                            <div
                                className={`h-[10px] text-[9px] font-semibold uppercase leading-[10px] tracking-[0.14em] select-none ${
                                    isDaylight ? 'text-black/45' : 'text-white/45'
                                }`}
                            >
                                <AnimatePresence mode="wait" initial={false}>
                                    <motion.span
                                        key={label}
                                        className="block"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        transition={{ duration: 0.18, ease: 'easeOut' }}
                                    >
                                        {label}
                                    </motion.span>
                                </AnimatePresence>
                            </div>
                            <div className="truncate text-[13px] font-bold leading-4">{shown.title}</div>
                            <div
                                className={`truncate text-[11px] font-medium leading-[14px] ${
                                    isDaylight ? 'text-black/55' : 'text-white/50'
                                }`}
                            >
                                {shown.artist || t('ui.unknownArtist')}
                            </div>
                        </motion.div>
                    </motion.button>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default NowPlayingToast;
