import React from 'react';
import { Play, Pause } from 'lucide-react';
import { PlayerState } from '../../types';
import { resolveLiquidGlassTintMultiplier, useLiquidGlassTuningStore } from '../../stores/useLiquidGlassTuningStore';

// src/components/floating-player/PlayerPlayPauseButton.tsx
// 播放胶囊展开态的播放/暂停按钮。原为 primaryColor 实底圆钮，现为胶囊上的
// 「反色玻璃子芯片」：底色与胶囊相反——暗色主题用白底、亮色主题用黑底，
// alpha 取对应主题的 tint 参数乘反色侧的表面预设倍率（surface id: playerPlayButton）；
// 图标用 --bg-color，与反色底色的对比由主题定义保证。
// 刻意不嵌套 SVG 玻璃滤镜：按钮在玻璃胶囊内部，胶囊的 backdrop-filter 形成
// backdrop root，嵌套滤镜采样异常会渲染成不透明黑块（与 osu! 滑轨不叠玻璃
// 同理）。半透明 tint 直接透出胶囊滤好的玻璃内容。

interface PlayerPlayPauseButtonProps {
    playerState: PlayerState;
    canTogglePlay: boolean;
    controlsDisabled: boolean;
    isDaylight: boolean;
    /** 布局定位类（网格 col/row），由 ExpandedView 按断点传入 */
    className?: string;
    onTogglePlay: () => void;
}

const PlayerPlayPauseButton: React.FC<PlayerPlayPauseButtonProps> = ({
    playerState,
    canTogglePlay,
    controlsDisabled,
    isDaylight,
    className,
    onTogglePlay,
}) => {
    const liquidGlassTuning = useLiquidGlassTuningStore(state => state.liquidGlassTuning);
    // 反色 tint：alpha 取「反色侧主题」的 tint 参数 × 反色侧预设倍率
    //（暗色主题 → lightTint × 预设 light；亮色主题 → darkTint × 预设 dark）
    const tintAlpha = (
        (isDaylight ? liquidGlassTuning.darkTint : liquidGlassTuning.lightTint)
        * resolveLiquidGlassTintMultiplier('playerPlayButton', !isDaylight)
    ).toFixed(3);
    const tintStyle = {
        backgroundColor: isDaylight
            ? `rgba(0, 0, 0, ${tintAlpha})`
            : `rgba(255, 255, 255, ${tintAlpha})`,
    };

    return (
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                onTogglePlay();
            }}
            disabled={!canTogglePlay || controlsDisabled}
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border shadow-lg transition-transform ${isDaylight ? 'border-black/10' : 'border-white/30'} ${controlsDisabled ? 'cursor-not-allowed opacity-45' : 'hover:scale-105'} ${className ?? ''}`}
            style={{
                color: 'var(--bg-color)',
                ...tintStyle,
            }}
        >
            {playerState === PlayerState.PLAYING ? (
                <Pause size={20} fill="currentColor" />
            ) : (
                <Play size={20} fill="currentColor" className="ml-1" />
            )}
        </button>
    );
};

export default PlayerPlayPauseButton;
