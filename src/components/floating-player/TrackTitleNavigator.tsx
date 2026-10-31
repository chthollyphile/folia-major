import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTrackTitlePreview, type TrackNavSide } from '../../hooks/useTrackTitlePreview';
import { usePlayerChromeSettingsStore } from '../../stores/usePlayerChromeSettingsStore';
// src/components/floating-player/TrackTitleNavigator.tsx

const PREVIEW_OPACITY = 0.55;

export interface TrackTitleNavigatorProps {
    title: string;
    /** 当前曲目的稳定身份；相邻两首同名时 title 不变，只能靠它识别换歌 */
    trackKey: string;
    prevTitle: string | null;
    nextTitle: string | null;
    canPrev: boolean;
    canNext: boolean;
    onPrev: () => void;
    onNext: () => void;
    prevLabel: string;
    nextLabel: string;
    color: string;
    isDaylight?: boolean;
    disabled?: boolean;
}

/**
 * 浮动播放条的标题区：悬浮时在标题两侧浮出上一首/下一首箭头，
 * 指针靠近某一侧时标题淡出、半透明预览该方向的曲目标题，移开即还原。
 * 切歌后的确认窗口行为见 useTrackTitlePreview。
 *
 * 只有箭头按钮自身会触发切歌并阻止冒泡；标题区其余部分的点击照常冒泡给胶囊，
 * 保留「点击进度条导航到 player 页」的既有行为。
 */
const TrackTitleNavigator: React.FC<TrackTitleNavigatorProps> = ({
    title,
    trackKey,
    prevTitle,
    nextTitle,
    canPrev,
    canNext,
    onPrev,
    onNext,
    prevLabel,
    nextLabel,
    color,
    isDaylight = false,
    disabled = false,
}) => {
    const {
        displayTitle,
        previewTitle,
        shownPreview,
        enterSeq,
        slide,
        enterZone,
        leaveZone,
        beginSwitch,
    } = useTrackTitlePreview({ title, trackKey, prevTitle, nextTitle, disabled });
    const alwaysShowArrows = usePlayerChromeSettingsStore(state => state.alwaysShowTrackSwitchButtons);

    const isPreview = previewTitle !== null;
    const zoneClass = 'absolute inset-y-0 flex items-center';
    const arrowClass = [
        'pointer-events-auto flex h-6 w-6 items-center justify-center rounded-full',
        'transition-opacity duration-200 hover:opacity-100!',
        alwaysShowArrows ? 'opacity-70' : 'opacity-0 group-hover/title:opacity-70',
        isDaylight ? 'hover:bg-black/10' : 'hover:bg-white/15',
    ].join(' ');
    const textClass = 'w-full truncate text-center text-sm';

    const renderArrow = (side: TrackNavSide) => {
        if (disabled || (side === 'prev' ? !canPrev : !canNext)) {
            return null;
        }

        const label = side === 'prev' ? prevLabel : nextLabel;
        const target = side === 'prev' ? prevTitle : nextTitle;
        const Icon = side === 'prev' ? ChevronLeft : ChevronRight;

        return (
            <button
                type="button"
                aria-label={label}
                title={target || label}
                className={arrowClass}
                style={{ color }}
                onClick={(e) => {
                    // 必须拦住冒泡：胶囊自身的 onClick 会导航到 player 页
                    e.stopPropagation();
                    beginSwitch(side);
                    (side === 'prev' ? onPrev : onNext)();
                }}
            >
                <Icon size={16} strokeWidth={2.4} />
            </button>
        );
    };

    return (
        <div className="group/title relative min-w-0 select-none px-1">
            {/* 感应区比箭头宽，指针「靠近」箭头即可预览；区内非箭头处的点击不拦截 */}
            <div
                className={`${zoneClass} left-0 w-14 justify-start pl-1`}
                onMouseEnter={() => enterZone('prev')}
                onMouseLeave={leaveZone}
            >
                {renderArrow('prev')}
            </div>
            <div
                className={`${zoneClass} right-0 w-14 justify-end pr-1`}
                onMouseEnter={() => enterZone('next')}
                onMouseLeave={leaveZone}
            >
                {renderArrow('next')}
            </div>

            <div className="pointer-events-none relative h-6">
                {/* 整个文字块必须 pointer-events-none：它是 position:relative 且 DOM 序在感应区之后，
                    定位元素后来居上会盖住两侧箭头，导致悬浮和点击全部失效。
                    左右各让出 w-14 也是同一原因——绝对定位相对 padding box，inset-0 会铺到箭头上。 */}
                {/* 当前曲目层：key 只在需要入场动画时递增（且单调），不会和退场中的同 key 元素撞车。
                    点箭头后 displayTitle 立刻变成目标曲名，与预览层同文同位，看上去就是文字由半透明提亮 */}
                <AnimatePresence initial={false} mode="sync">
                    <motion.div
                        key={enterSeq}
                        className="absolute inset-y-0 left-14 right-14 flex items-center"
                        initial={{ opacity: 0, x: slide }}
                        animate={{ opacity: isPreview ? 0 : 1, x: 0 }}
                        exit={{ opacity: 0, x: -slide }}
                        transition={{ duration: 0.22, ease: 'easeOut' }}
                    >
                        <span className={textClass} style={{ color }}>{displayTitle}</span>
                    </motion.div>
                </AnimatePresence>

                {/* 预览层：纯 CSS opacity 交叉淡入，不参与 key 变化 */}
                <div
                    aria-hidden
                    className="absolute inset-y-0 left-14 right-14 flex items-center transition-opacity duration-200"
                    style={{ opacity: isPreview ? PREVIEW_OPACITY : 0 }}
                >
                    <span className={textClass} style={{ color }}>{shownPreview}</span>
                </div>
            </div>
        </div>
    );
};

export default TrackTitleNavigator;
