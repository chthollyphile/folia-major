import React from 'react';
import type { MotionValue } from 'framer-motion';
import PulsingBorderProgress, { type BorderTuning } from './PulsingBorderProgress';
// dev/probes/pulsing-border-progress/NowPlayingPulseCard.tsx

/**
 * 圆角矩形形态：进度描边直接长在「正在播放」卡片的边框上。
 * 明暗两套都渲染，因为发光描边在白底上很容易被冲淡，轨道色也得跟着翻。
 */

const CARD_WIDTH = 340;
const CARD_HEIGHT = 84;
const CARD_RADIUS = 18;
/** 画布比卡片大一圈，留给辉光，否则描边外侧会被画布裁掉 */
const GLOW_PAD = 22;
/** 描边路径比卡片边缘再外扩一点：描边画在卡片底下，贴边的话内侧一半会被卡片背景盖住 */
const STROKE_OFFSET = 4;

interface NowPlayingPulseCardProps {
    /** 0-100 */
    progress: MotionValue<number>;
    coverUrl: string;
    label: string;
    title: string;
    artist: string;
    variant?: 'light' | 'dark';
    colors?: string[];
    tuning?: Partial<BorderTuning>;
}

const VARIANT_STYLE = {
    light: {
        card: 'bg-white shadow-[0_8px_30px_rgba(0,0,0,0.18)]',
        label: 'text-zinc-500',
        title: 'text-zinc-900',
        artist: 'text-zinc-500',
        track: '#000000',
    },
    dark: {
        card: 'bg-zinc-950 shadow-[0_8px_30px_rgba(0,0,0,0.45)]',
        label: 'text-zinc-400',
        title: 'text-zinc-50',
        artist: 'text-zinc-400',
        track: '#ffffff',
    },
} as const;

const NowPlayingPulseCard: React.FC<NowPlayingPulseCardProps> = ({
    progress,
    coverUrl,
    label,
    title,
    artist,
    variant = 'light',
    colors,
    tuning,
}) => {
    const palette = VARIANT_STYLE[variant];

    return (
        <div
            className="relative"
            style={{ width: CARD_WIDTH + GLOW_PAD * 2, height: CARD_HEIGHT + GLOW_PAD * 2 }}
            data-probe-card={variant}
        >
            <PulsingBorderProgress
                className="pointer-events-none absolute inset-0"
                progress={progress}
                width={CARD_WIDTH + GLOW_PAD * 2}
                height={CARD_HEIGHT + GLOW_PAD * 2}
                pad={GLOW_PAD - STROKE_OFFSET}
                cornerRadius={CARD_RADIUS + STROKE_OFFSET}
                colors={colors}
                trackColor={palette.track}
                tuning={tuning}
            />
            <div
                className={`absolute flex items-center gap-3 px-3 ${palette.card}`}
                style={{ inset: GLOW_PAD, borderRadius: CARD_RADIUS }}
            >
                <img src={coverUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
                <div className="min-w-0 flex-1">
                    <div className={`text-[11px] leading-tight ${palette.label}`}>{label}</div>
                    <div className={`truncate text-sm font-semibold leading-snug ${palette.title}`}>{title}</div>
                    <div className={`truncate text-xs leading-tight ${palette.artist}`}>{artist}</div>
                </div>
            </div>
        </div>
    );
};

export default NowPlayingPulseCard;
