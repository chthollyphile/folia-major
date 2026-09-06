import React from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Check, RotateCcw, X } from 'lucide-react';
import { PLAYER_BOTTOM_BAR_BASE_OFFSET_PX } from '../../utils/playerBottomBarLayout';

// src/components/floating-player/PlayerBottomBarPositioner.tsx
// 定位模式的取景框：标出底部基线能移动到哪里，并提供复位 / 确认 / 取消。
// 只负责画面，偏移量本身由 motionSignals 的共享 MotionValue 持有。
// 定位 chip 不接入液态玻璃（按需求移除），保持普通毛玻璃 + class 底色。

interface PlayerBottomBarPositionerProps {
    /** 当前允许的最大偏移量（px），由视口高度算出。 */
    maxOffsetPx: number;
    accentColor: string;
    isDaylight: boolean;
    onReset: () => void;
    onCommit: () => void;
    onCancel: () => void;
}

const PlayerBottomBarPositioner: React.FC<PlayerBottomBarPositionerProps> = ({
    maxOffsetPx,
    accentColor,
    isDaylight,
    onReset,
    onCommit,
    onCancel,
}) => {
    const { t } = useTranslation();
    const chipClass = isDaylight
        ? 'border-black/10 bg-white/80 text-black'
        : 'border-white/15 bg-black/60 text-white';

    return (
        <>
            {/*
                虚线框画的是「胶囊底边可以落在哪一段」：下沿是原始基线，上沿是半屏上限。
                固定在视口上，不随被拖动的胶囊移动，所以拖到边界时框不动、胶囊贴住框。
            */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="pointer-events-none fixed inset-x-4 z-50 rounded-3xl border-2 border-dashed md:inset-x-8"
                style={{
                    borderColor: accentColor,
                    opacity: 0.32,
                    bottom: PLAYER_BOTTOM_BAR_BASE_OFFSET_PX - 12,
                    height: Math.max(0, maxOffsetPx - PLAYER_BOTTOM_BAR_BASE_OFFSET_PX) + 24,
                }}
            />

            <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                className="pointer-events-auto fixed left-1/2 top-8 z-[70] -translate-x-1/2"
            >
                <div
                    className={`flex items-center gap-3 rounded-full border px-4 py-2 text-sm shadow-xl backdrop-blur-xl ${chipClass}`}
                >
                    <span className="select-none">{t('options.playerBottomBarPositioningHint')}</span>
                    <span className="h-4 w-px opacity-20" style={{ backgroundColor: 'currentColor' }} />
                    <button
                        type="button"
                        onClick={onReset}
                        className="rounded-full p-1.5 opacity-60 transition-opacity hover:opacity-100"
                        title={t('options.playerBottomBarReset')}
                        aria-label={t('options.playerBottomBarReset')}
                    >
                        <RotateCcw size={15} />
                    </button>
                    <button
                        type="button"
                        onClick={onCancel}
                        className="rounded-full p-1.5 opacity-60 transition-opacity hover:opacity-100"
                        title={t('ui.cancel')}
                        aria-label={t('ui.cancel')}
                    >
                        <X size={15} />
                    </button>
                    <button
                        type="button"
                        onClick={onCommit}
                        className="rounded-full p-1.5 transition-transform hover:scale-105"
                        style={{ backgroundColor: accentColor, color: isDaylight ? '#fff' : '#000' }}
                        title={t('options.save')}
                        aria-label={t('options.save')}
                    >
                        <Check size={15} />
                    </button>
                </div>
            </motion.div>
        </>
    );
};

export default PlayerBottomBarPositioner;
