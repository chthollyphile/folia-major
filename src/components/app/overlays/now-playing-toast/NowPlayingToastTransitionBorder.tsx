import React, { useEffect } from 'react';
import { animate, motion, useMotionValue } from 'framer-motion';
import PulsingBorderProgress from './PulsingBorderProgress';
import type { TransitionCue } from '../../../../services/automix/transitionCue';
import type { Theme } from '../../../../types';
import { clamp01, hexToHsl, hslToHex, normalizeHue } from '../../../../utils/themeColorMath';

// src/components/app/overlays/now-playing-toast/NowPlayingToastTransitionBorder.tsx
// automix 过渡的进度描边，长在 now playing 卡片的边框上。
//
// 这是 AutomixTransitionAnimation（屏幕正中那个圆环）的替代形态：卡片在场时那个全屏动画不再
// 挂载，混音的进度改画在卡片周围。两者说的是同一件事——描边从 0 走到 1 的时间就是这次混音的
// 长度，1:1，不是一个「转一会儿」的装饰。
//
// 不吃任何输入（pointer-events 一路 none），也不因为点击而消失：全屏那版按任意键消失是因为它
// 盖在人正在看的东西上，这一版只占卡片那一圈，没挡着谁。
//
// 「有没有在混音」由卡片经 useTransitionBorderCue 决定并传进来，这里只负责画。

/** 画布比卡片大一圈，留给辉光，否则描边外侧会被画布裁掉 */
const GLOW_PAD = 22;
/**
 * 描边路径相对卡片边缘的外扩量（px）。
 *
 * 0 = 正好压在卡片边框上。之前留了 3px，结果卡片边框和描边之间夹着一圈暗缝，读起来是好几层
 * 边框套在一起——正是要避免的那个。压在边上意味着描边内侧那一半被卡片背景盖掉，看得见的是外
 * 侧和辉光，也就是卡片边框自己在发光。
 */
const STROKE_OFFSET = 0;

const ENTER_SEC = 0.45;

/**
 * 比探针上调出来的那套再淡一档。
 *
 * 淡是压在发光的几项上（intensity/bloom/head），不是整层给一个 opacity：整层压下去会把轨道
 * 和已完成段的常亮底色一起压掉，而那两项正是「光斑绕到别处时这段弧不至于看起来坏了」的东西
 * ——压完的结果是描边有一半时间是隐形的。所以底色只轻轻收一点，收的是那圈霓虹。
 * 其余各项（thickness/softness/spots/spotSize/pulse/smoke/fade/speed）保持探针上的值。
 */
const TUNING = {
    // 比探针默认的 0.015 粗一倍：描边压在卡片边框上（STROKE_OFFSET = 0），内侧那一半被卡片背景
    // 盖掉，能看见的只有外侧——照原来的粗细就只剩边缘上一丝。
    thickness: 0.032,
    intensity: 0.3,
    bloom: 0.45,
    head: 0.5,
    base: 0.72,
    track: 0.2,
};

/**
 * 光斑的色相 / 明度 / 饱和度摆幅。
 *
 * 三个光斑都用同一个主题色会糊成一条纯色，绕完一圈看不出是三个东西在走；摆开得太多又变成
 * 彩虹，就不是「这个主题的颜色」了。所以只在主题色附近挪一点，读起来是同一个颜色的层次。
 * 灰系主题色（默认回退的 #fafafa / #27272a）转色相没有效果，层次全靠明度那一档撑。
 */
const SPOT_HUE_SPREAD = 16;
const SPOT_LIGHT_SPREAD = 0.07;
const SPOT_SAT_SPREAD = 0.12;

/** 主题色附近的三档，给三个光斑用。解析不出来就原色照用，不猜。 */
const buildSpotColors = (accent: string): string[] => {
    const hsl = hexToHsl(accent);
    if (!hsl) return [accent, accent, accent];
    const shift = (hue: number, light: number, sat: number) => hslToHex({
        h: normalizeHue(hsl.h + hue),
        s: clamp01(hsl.s + sat),
        l: clamp01(hsl.l + light),
    });
    return [
        shift(-SPOT_HUE_SPREAD, SPOT_LIGHT_SPREAD, -SPOT_SAT_SPREAD),
        accent,
        shift(SPOT_HUE_SPREAD, -SPOT_LIGHT_SPREAD * 0.6, SPOT_SAT_SPREAD),
    ];
};

type NowPlayingToastTransitionBorderProps = {
    /** 正在进行的混音；调用方保证非空时才挂载本组件 */
    cue: TransitionCue;
    /** 这次混音已经走过的毫秒数。中途接手时不为 0，描边从对应的进度起步。 */
    startAtMs?: number;
    /** 卡片的 CSS 尺寸（px）；量出来才知道画布要多大 */
    cardWidth: number;
    cardHeight: number;
    /** 卡片圆角（px），描边圆角会在它外面再加 STROKE_OFFSET */
    cardRadius: number;
    isDaylight: boolean;
    theme?: Theme;
};

const NowPlayingToastTransitionBorder: React.FC<NowPlayingToastTransitionBorderProps> = ({
    cue,
    startAtMs = 0,
    cardWidth,
    cardHeight,
    cardRadius,
    isDaylight,
    theme,
}) => {
    const progress = useMotionValue(0);

    // 线性，而且必须线性：这条描边就是这次混音的时钟，缓动会把端点放到音频不在的位置上。
    // 进度只写 MotionValue 不进 state：逐帧 setState 会把整个 App 重渲染一遍，而
    // PulsingBorderProgress 是直接把它写进 uniform 的。
    //
    // 起点和时长都按 startAtMs 折算：混音中途接手时（比如从首页切到歌词页）要从当前进度接着走，
    // 从 0 重跑一遍会让描边和听到的音频差一大截。
    useEffect(() => {
        const totalMs = cue.seconds * 1000;
        const from = Math.min(100, Math.max(0, (startAtMs / totalMs) * 100));
        const remainingSec = Math.max(0, (totalMs - startAtMs) / 1000);
        progress.set(from);
        if (remainingSec <= 0) return;
        const controls = animate(progress, 100, { duration: remainingSec, ease: 'linear' });
        return () => controls.stop();
    }, [cue, startAtMs, progress]);

    const canvasWidth = cardWidth + GLOW_PAD * 2;
    const canvasHeight = cardHeight + GLOW_PAD * 2;
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    // 和全屏圆环取同一个颜色和同一个回退，两种形态说的是同一件事，不该是两个颜色。
    const accent = theme?.accentColor || (isDaylight ? '#27272a' : '#fafafa');

    return (
        <motion.div
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.5, ease: 'easeOut' } }}
            transition={{ duration: ENTER_SEC, ease: 'easeOut' }}
            className="pointer-events-none"
            style={{ position: 'absolute', top: -GLOW_PAD, left: -GLOW_PAD, width: canvasWidth, height: canvasHeight }}
        >
            <PulsingBorderProgress
                className="pointer-events-none absolute inset-0"
                progress={progress}
                width={canvasWidth}
                height={canvasHeight}
                pad={GLOW_PAD - STROKE_OFFSET}
                cornerRadius={cardRadius + STROKE_OFFSET}
                colors={buildSpotColors(accent)}
                // 已完成段的底色走主题色本身，不跟着摆开的那一档：这段是「走过的路」，
                // 该是这个主题的颜色，层次交给上面跑的光斑。
                baseColor={accent}
                // 轨道色得跟着宿主翻：发光描边在白底上很容易被冲淡
                trackColor={isDaylight ? '#000000' : '#ffffff'}
                // 减弱动效时把着色器的时间停住，只留进度推进这一件必要的事
                tuning={calm ? { ...TUNING, speed: 0, pulse: 0, smoke: 0 } : TUNING}
            />
        </motion.div>
    );
};

export default NowPlayingToastTransitionBorder;
