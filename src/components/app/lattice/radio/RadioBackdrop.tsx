import { memo } from 'react';
import { PlayerState } from '../../../../types';
import { useLatticeTransport } from '../LatticeTransportContext';
import { useReducedMotionFor } from '../../../../hooks/useReducedMotionFor';
import RadioSpectrum from './RadioSpectrum';
import type { RadioMetrics } from './radioWallModel';

// src/components/app/lattice/radio/RadioBackdrop.tsx
// 电台墙底下的几何构图（只是装饰，屏幕阅读器跳过）。手法同搜索页的至上主义构图（search.css）：墨条、发丝线、
// 斜线小方块、淡字；主题换成电波：几道大同心圆和卡牌那一圈弧同心（卡就排在其中一道电波上），左上角一个发射点，
// 外面一圈圆形频谱（RadioSpectrum）跟着正在播放的音乐动，暂停时缩回去。卡牌沿弧移动时，这几道同心圆朝同一方向轻轻转一点（turn）。以黑白（墨色）为主，主题色只用在发射点和一小段短条上，不铺大面积的色块。
// 挂上时依次浮入；降低动态效果时没有动画。

/** 和卡牌那一圈同心的几道电波：半径相对卡牌弧的半径。 */
const WAVE_SCALES = [0.62, 0.78, 0.9, 1.12, 1.26, 1.44];

/**
 * 轨道上的点：每道电波上几颗小点（角度从圆顶量起，度；正数在右），跟着同心圆一起转，转动才看得出来。
 * 只放在圆顶附近能看见的那一段；各道的角度错开，不排成一条线。
 */
const ORBIT_DOTS: Readonly<Record<number, readonly number[]>> = {
    0: [-21, 9, 30],
    1: [-34, -14, 18],
    2: [-26, 3, 24, 38],
    3: [-38, -8, 14],
    4: [-30, -17, 27],
    5: [-24, 6, 33],
};

/** 卡牌每走一格，同心圆跟着转的角度（度）。 */
export const RADIO_WAVE_TURN_DEG = 3;

/** turn：同心圆累计转过的角度（度，负数为逆时针）；卡牌往左走一格就逆时针转 RADIO_WAVE_TURN_DEG。 */
/** word：左下角那行淡字（私人 FM 时是「私人 FM」，普通队列是「播放队列」）。 */
function RadioBackdrop({ metrics, turn, word }: { metrics: RadioMetrics; turn: number; word: string }) {
    const { playerState } = useLatticeTransport();
    const reducedMotion = useReducedMotionFor('lattice');
    // 卡牌那一圈弧的圆心：在正中下方一个半径处。
    const centerX = metrics.centerX;
    const centerY = metrics.centerY + metrics.radius;
    return (
        <div className="lattice-radio-backdrop" data-playing={playerState === PlayerState.PLAYING || undefined} aria-hidden="true">
            <svg className="lattice-radio-waves" width="100%" height="100%">
                <g className="lattice-radio-waves-turn" style={{ transformOrigin: `${centerX}px ${centerY}px`, transform: `rotate(${turn}deg)` }}>
                    {WAVE_SCALES.map((scale, index) => (
                        <circle key={scale} cx={centerX} cy={centerY} r={metrics.radius * scale}
                            className={index % 2 === 0 ? 'is-dashed' : undefined}
                            style={{ animationDelay: `${120 + index * 70}ms` }} />
                    ))}
                    {WAVE_SCALES.flatMap((scale, index) => (ORBIT_DOTS[index] ?? []).map((degrees, dot) => {
                        const angle = degrees * Math.PI / 180;
                        const r = metrics.radius * scale;
                        // 每道电波上的第二颗点大一号；最里面那道的第一颗用强调色（整幅里很小的一处）。
                        const className = index === 0 && dot === 0 ? 'is-accent' : dot === 1 ? 'is-large' : undefined;
                        return (
                            <circle key={`${scale}:${degrees}`} className={`lattice-radio-orbit-dot ${className ?? ''}`}
                                cx={centerX + r * Math.sin(angle)} cy={centerY - r * Math.cos(angle)}
                                r={dot === 1 ? 4 : 2.5} style={{ animationDelay: `${300 + index * 70}ms` }} />
                        );
                    }))}
                </g>
            </svg>
            <div className="lattice-radio-figure is-bar"><i /></div>
            <div className="lattice-radio-figure is-tick"><i /></div>
            <div className="lattice-radio-figure is-line"><i /></div>
            <div className="lattice-radio-figure is-hatch"><i /></div>
            <div className="lattice-radio-figure is-transmitter">
                <i className="is-ring" />
                <RadioSpectrum playing={playerState === PlayerState.PLAYING} reducedMotion={reducedMotion} />
                <i className="is-ring is-base" />
                <i className="is-core" />
            </div>
            <div className="lattice-radio-figure is-word"><i>{word}</i></div>
        </div>
    );
}

export default memo(RadioBackdrop);
