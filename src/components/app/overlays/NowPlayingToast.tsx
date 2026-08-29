import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Music } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// src/components/app/overlays/NowPlayingToast.tsx
// 歌词页左下角的 now playing 卡片（playing-toast 样式：圆角 2xl、44px 封面、底部滑入）。
// 歌名上方带 "正在播放 / 接下来播放" 标签。
// 显示模式：auto=显示 timeoutSec 秒后淡出（换歌重新计时），always=常驻，never=不渲染。
// isNextUp=自动切歌预览（automix 混合或普通曲目结束倒计时）：强制显示下一首并挂
// "接下来播放" 标签，切完后翻回 "正在播放"。
// 和 automix 的全屏过渡动画互不相干，两者各自独立开关。

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
};

const NowPlayingToast: React.FC<NowPlayingToastProps> = ({
    song,
    trackKey,
    isDaylight,
    mode = 'auto',
    timeoutSec = 10,
    nextUp = null,
    isNextUp = false,
}) => {
    const { t } = useTranslation();

    // 预览态内容收口：isNextUp 且给了 nextUp 时整卡展示下一首，否则常规
    const shown = isNextUp && nextUp ? nextUp : song;
    const label = isNextUp ? t('ui.stageTrackPillNext') : t('ui.stageTrackPillNow');

    // 可见性状态机：never 不渲染；always 常驻；auto 换歌重新计时。
    // isNextUp（预览下一首）挂起计时，翻回 false 后（即使 trackKey 没变）重新计时。
    const [visible, setVisible] = useState(mode !== 'never');
    const holdOpen = mode === 'always' || isNextUp;
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

    return (
        <AnimatePresence>
            {visible && (
                <motion.div
                    initial={{ opacity: 0, x: -32 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={{ duration: 0.35, ease: 'easeOut' }}
                    className="pointer-events-none fixed bottom-6 left-6 z-40"
                >
                    {/* Toast 卡片（playing-toast 样式）。key=trackKey 在换歌时重放进场
                        动画：没有 AnimatePresence 的 keyed 元素卸载是即时的，旧内容不会
                        残留，所以切到 next playing 时不会闪一下当前的歌。 */}
                    <motion.div
                        key={trackKey}
                        initial={{ opacity: 0, x: -24 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.35, ease: 'easeOut' }}
                        className={`relative flex items-center gap-3 overflow-hidden rounded-2xl border p-2 pr-4 backdrop-blur-xl shadow-lg transition-colors ${
                            isDaylight ? 'border-black/10 bg-white/35 text-zinc-900' : 'border-white/10 bg-black/35 text-white'
                        }`}
                    >
                        {/* 顶部光线（进场的横向扫光） */}
                        <motion.span
                            aria-hidden
                            initial={{ scaleX: 0 }}
                            animate={{ scaleX: 1 }}
                            transition={{ duration: 0.5, ease: 'easeOut' }}
                            className={`absolute inset-x-0 top-0 h-[2px] origin-left ${
                                isDaylight
                                    ? 'bg-gradient-to-r from-transparent via-black/40 to-transparent'
                                    : 'bg-gradient-to-r from-transparent via-white/50 to-transparent'
                            }`}
                        />
                        <div
                            className={`relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-cover bg-center ${
                                isDaylight ? 'bg-zinc-200' : 'bg-zinc-800'
                            }`}
                            style={shown.coverUrl ? { backgroundImage: `url(${shown.coverUrl})` } : undefined}
                        >
                            {!shown.coverUrl && <Music size={18} className={isDaylight ? 'text-black/35' : 'text-white/35'} />}
                        </div>
                        <div className="min-w-0 max-w-[200px]">
                            {/* 正在播放 / 接下来播放：歌名上方 */}
                            <div
                                className={`text-[9px] font-semibold uppercase leading-[10px] tracking-[0.14em] select-none ${
                                    isDaylight ? 'text-black/45' : 'text-white/45'
                                }`}
                            >
                                {label}
                            </div>
                            <div className="truncate text-[13px] font-bold leading-4">{shown.title}</div>
                            <div
                                className={`truncate text-[11px] font-medium leading-[14px] ${
                                    isDaylight ? 'text-black/55' : 'text-white/50'
                                }`}
                            >
                                {shown.artist || t('ui.unknownArtist')}
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default NowPlayingToast;
