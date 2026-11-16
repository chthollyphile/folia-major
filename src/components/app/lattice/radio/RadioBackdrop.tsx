import { memo, useRef } from 'react';
import { motion, useTransform, type MotionValue } from 'framer-motion';
import { PlayerState } from '../../../../types';
import { useLatticeTransport } from '../LatticeTransportContext';
import { useReducedMotionFor } from '../../../../hooks/useReducedMotionFor';
import RadioOrbits from './RadioOrbits';
import RadioSpectrum from './RadioSpectrum';
import { RADIO_WAVE_TURN_DEG, radioCardRect, radioStationRadius, radioUpperRings, radioWaveCenter, type RadioMetrics } from './radioWallModel';

// src/components/app/lattice/radio/RadioBackdrop.tsx
// 电台墙底下的几何构图（只是装饰，屏幕阅读器跳过）。手法同搜索页的至上主义构图（search.css）：墨条、斜线小方块、
// 淡字；主题换成电波：几道大同心圆和卡牌那一圈弧同心（卡就排在其中一道电波上），左上角一个发射点，外面一圈圆形频谱
// （RadioSpectrum）跟着正在播放的音乐动，暂停时缩回去。正在播放那张卡上方一段调频刻度（两端渐隐），一根强调色的
// 指针指着正在播放的那张：左右浏览时卡沿弧走开，指针跟着它沿刻度滑过去，滑出刻度窗就淡掉。
// 上半屏另有几道淡一些的轨道，信号包沿着它们滑，发射点一圈圈往外发电波、外面有卫星绕行（RadioOrbits 的 canvas）。
// 同心圆和刻度跟着卡牌的轨道同向轻转（卡往左走一格就逆时针转 RADIO_WAVE_TURN_DEG）。以黑白（墨色）为主，主题色
// 只用在发射点、指针、一颗轨道点和一小段短条上，不铺大面积的色块。挂上时依次浮入；降低动态效果时没有动画。
// 转动、指针都由轨道（MotionValue）直接驱动，转的是常驻合成层的外层，不经过 React、也不重画 SVG。

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

/** 上部轨道（radioUpperRings）上的轨道点：角度从圆顶量起（度），只放在窗口宽度以内看得见的那一小段。 */
const UPPER_RING_DOTS: readonly (readonly number[])[] = [[-9, 13], [-14, 4, 17], [-6, 11]];

/** 刻度窗：刻度外沿离正中那张卡的上沿多远（px），窗口半宽占窗口宽度的比例与上限。 */
const DIAL_GAP_PX = 47;
const DIAL_HALF_RATIO = 0.2;
const DIAL_HALF_MAX_PX = 300;
/** 刻度两端各渐隐窗口全宽的这么多（和 CSS 的遮罩一致）：换成半宽里不渐隐的那一段。 */
const DIAL_FADE = 0.22;
const DIAL_SOLID_RATIO = 1 - DIAL_FADE * 2;
/** 小刻度的间距（沿弧，px），每四格一道长刻度。 */
const DIAL_TICK_PX = 16.65;

/** 指针：下端离正中那张卡的上沿多远，长度占卡上方空白的比例与上下限。 */
const NEEDLE_GAP_PX = 12;
const NEEDLE_LENGTH_RATIO = 0.55;
const NEEDLE_MIN_PX = 48;
const NEEDLE_MAX_PX = 128;

type RadioBackdropProps = {
    metrics: RadioMetrics;
    /** 卡牌的轨道位置（RadioWall）：同心圆的转角、指针的位置都从它算。 */
    rail: MotionValue<number>;
    /** 正在播放那张在轨道上的格；没有正在播放的（FM 还没对上）时为 null，不画指针。 */
    anchor: number | null;
    /** 左下角那行淡字（私人 FM 时是「私人 FM」，普通队列是「播放队列」）。 */
    word: string;
    /** 打开电台墙时那一波还没跑完：信号包、电波、频谱先停在一帧上（它们本来也还在淡入），跑完再动起来。 */
    entering: boolean;
};

function RadioBackdrop({ metrics, rail, anchor, word, entering }: RadioBackdropProps) {
    const { playerState } = useLatticeTransport();
    const animates = playerState === PlayerState.PLAYING && !entering;
    const reducedMotion = useReducedMotionFor('lattice');
    const center = radioWaveCenter(metrics);
    const turn = useTransform(rail, value => -value * RADIO_WAVE_TURN_DEG);
    const origin = `${center.x}px ${center.y}px`;
    const upperRings = radioUpperRings(metrics);
    const transmitterRef = useRef<HTMLDivElement>(null);

    // 刻度：正中那张卡上方一段，刻度外沿的半径由卡的上沿往上 DIAL_GAP_PX 定。
    const cardTop = metrics.centerY - metrics.nowSize / 2;
    const dialRadius = center.y - (cardTop - DIAL_GAP_PX) - 6;
    const dialHalf = Math.min(metrics.width * DIAL_HALF_RATIO, DIAL_HALF_MAX_PX);
    const dialLeft = metrics.centerX - dialHalf;

    // 指针绕电波圆心转到正在播放那张卡的正上方；离刻度窗中间越远越淡，出了窗就看不见。
    const needleBottom = cardTop - NEEDLE_GAP_PX;
    const needleLength = Math.max(NEEDLE_MIN_PX, Math.min(NEEDLE_MAX_PX, cardTop * NEEDLE_LENGTH_RATIO));
    const needleTop = needleBottom - needleLength;
    const needlePivot = center.y - needleTop;
    const nowOffsetX = (value: number) => {
        if (anchor === null) return Number.POSITIVE_INFINITY;
        const rect = radioCardRect(anchor - value, metrics);
        return rect.x + rect.width / 2 - metrics.centerX;
    };
    const needleAngle = useTransform(rail, value => {
        const dx = nowOffsetX(value);
        if (!Number.isFinite(dx)) return 0;
        return Math.asin(Math.max(-1, Math.min(1, dx / needlePivot))) * 180 / Math.PI;
    });
    const needleOpacity = useTransform(rail, value => {
        const distance = Math.abs(nowOffsetX(value));
        const solid = dialHalf * DIAL_SOLID_RATIO;
        if (distance <= solid) return 1;
        return Math.max(0, 1 - (distance - solid) / (dialHalf - solid));
    });

    return (
        <div className="lattice-radio-backdrop" data-playing={playerState === PlayerState.PLAYING || undefined} aria-hidden="true">
            {/* 转的是包着 SVG 的这一层，不是 SVG 里的 <g>：SVG 内部元素的 transform 不交给合成器，转动时每帧都要把
                整幅同心圆重画、重新光栅化一遍，正好压在卡牌翻开放大的那一段上，翻牌就卡。 */}
            <motion.div className="lattice-radio-waves-turn" style={{ rotate: turn, transformOrigin: origin }}>
                {/* 整组一起淡入、从圆心往外略微放大（RadioWall.css 的 lattice-radio-waves-in），动的是这一层 HTML：
                    交给合成器，不重画。不给 SVG 里的圆和点各自做动画：SVG 内部元素的动画 WebKit 不交给合成器，
                    一圈圈错开淡入的那一两秒里 iOS Safari 每帧都要把整屏的电波重画一遍，从别的页面进来时就掉帧。 */}
                <div className="lattice-radio-waves-in" style={{ transformOrigin: origin }}>
                    <svg className="lattice-radio-waves" width="100%" height="100%">
                        {/* 电台带：每张卡的台线落在这道弧上（RadioCard）。 */}
                        <circle className="is-band" cx={center.x} cy={center.y} r={radioStationRadius(metrics)} />
                        {WAVE_SCALES.map((scale, index) => (
                            <circle key={scale} cx={center.x} cy={center.y} r={metrics.radius * scale}
                                className={index % 2 === 0 ? 'is-dashed' : undefined} />
                        ))}
                        {WAVE_SCALES.flatMap((scale, index) => (ORBIT_DOTS[index] ?? []).map((degrees, dot) => {
                            const angle = degrees * Math.PI / 180;
                            const r = metrics.radius * scale;
                            // 每道电波上的第二颗点大一号；最里面那道的第一颗用强调色（整幅里很小的一处）。
                            const className = index === 0 && dot === 0 ? 'is-accent' : dot === 1 ? 'is-large' : undefined;
                            return (
                                <circle key={`${scale}:${degrees}`} className={`lattice-radio-orbit-dot ${className ?? ''}`}
                                    cx={center.x + r * Math.sin(angle)} cy={center.y - r * Math.cos(angle)}
                                    r={dot === 1 ? 4 : 2.5} />
                            );
                        }))}
                        {/* 上半屏的几道轨道：虚实相间，比下面的电波更淡；信号包在 RadioOrbits 的 canvas 上沿着它们走。 */}
                        {upperRings.map((r, index) => (
                            <circle key={`upper:${index}`} cx={center.x} cy={center.y} r={r}
                                className={`is-upper ${index % 2 === 1 ? 'is-dashed' : ''}`} />
                        ))}
                        {upperRings.flatMap((r, index) => (UPPER_RING_DOTS[index] ?? []).map((degrees, dot) => {
                            const angle = degrees * Math.PI / 180;
                            return (
                                <circle key={`upper:${index}:${degrees}`} className={`lattice-radio-orbit-dot ${dot === 1 ? 'is-large' : ''}`}
                                    cx={center.x + r * Math.sin(angle)} cy={center.y - r * Math.cos(angle)}
                                    r={dot === 1 ? 3.5 : 2} />
                            );
                        }))}
                    </svg>
                </div>
            </motion.div>
            <RadioOrbits
                metrics={metrics}
                rail={rail}
                playing={animates}
                reducedMotion={reducedMotion}
                transmitterRef={transmitterRef}
            />
            {/* 刻度窗：外层不转、两端渐隐（CSS 遮罩），里面的刻度跟着同心圆一起转。 */}
            <div className="lattice-radio-dial" style={{ left: dialLeft, width: dialHalf * 2, height: Math.max(0, cardTop) }}>
                <motion.div className="lattice-radio-dial-turn"
                    style={{ left: -dialLeft, width: metrics.width, rotate: turn, transformOrigin: origin }}>
                    <svg width="100%" height="100%">
                        <circle cx={center.x} cy={center.y} r={dialRadius} className="is-minor" style={{ strokeDasharray: `1.25 ${DIAL_TICK_PX - 1.25}` }} />
                        <circle cx={center.x} cy={center.y} r={dialRadius} className="is-major" style={{ strokeDasharray: `1.25 ${DIAL_TICK_PX * 4 - 1.25}` }} />
                    </svg>
                </motion.div>
            </div>
            {anchor !== null && (
                <motion.div
                    className="lattice-radio-needle"
                    style={{
                        left: metrics.centerX - 1,
                        top: needleTop,
                        height: needleLength,
                        rotate: needleAngle,
                        opacity: needleOpacity,
                        transformOrigin: `1px ${needlePivot}px`,
                    }}
                />
            )}
            <div className="lattice-radio-figure is-bar"><i /></div>
            <div className="lattice-radio-figure is-tick"><i /></div>
            <div className="lattice-radio-figure is-hatch"><i /></div>
            <div ref={transmitterRef} className="lattice-radio-figure is-transmitter">
                <i className="is-ring" />
                <RadioSpectrum playing={animates} reducedMotion={reducedMotion} />
                <i className="is-ring is-base" />
                <i className="is-core" />
            </div>
            <div className="lattice-radio-figure is-word"><i>{word}</i></div>
        </div>
    );
}

export default memo(RadioBackdrop);
