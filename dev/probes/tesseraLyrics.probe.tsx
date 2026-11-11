import React from 'react';
import { motionValue } from 'framer-motion';
import TesseraBoard from '../../src/components/visualizer/tessera/TesseraBoard';
import { DAYLIGHT_THEME, DEFAULT_THEME } from '../../src/services/baseThemes';
import type { Line } from '../../src/types';
import type { ProbeDefinition } from './definition';
// dev/probes/tesseraLyrics.probe.tsx

/**
 * 方块字（俄罗斯方块风格）：歌词按分词结果变成方块，以纯文字落下，落地长出边框；
 * 一句（长句切成几段）唱完的那一刻那一行正好被填满并消掉。
 *
 * 示例歌词是自己写的，词的时间按字数在句内平均分。「词典分词」把每句的切法写进 wordSegments
 * （就像用户保存的分词），「逐字」去掉它，退回 Intl.Segmenter，用来对比分词对方块形状的影响。
 * 要看的是：每行最后一块落地正好在句末、消行动画、长句被切成两行、短句两边由垫块补满、
 * 消行后上面一行往下掉、倒退和跳转后画面仍然对。
 */

interface SampleLine {
    start: number;
    duration: number;
    /** 分词，用 / 隔开；英文词自带后面的空格（与增强 LRC 一致）。 */
    words: string;
}

const SAMPLE: SampleLine[] = [
    { start: 1.0, duration: 3.2, words: '雨/停/了/以后/的/街道' },
    { start: 4.6, duration: 4.4, words: '我/把/没/说完/的/话/折成/纸飞机' },
    { start: 9.4, duration: 2.0, words: '飞/过/你/的/窗' },
    { start: 11.8, duration: 3.6, words: 'I /keep /the /light /on /for /you' },
    { start: 15.8, duration: 3.4, words: '「/明日/は/きっと/晴れる/」' },
    { start: 19.6, duration: 6.4, words: '一个人/走过/长长/的/隧道/听见/回声/在/说/再见/再见/再见' },
    { start: 26.4, duration: 1.4, words: 'oh /oh' },
    { start: 31.0, duration: 3.6, words: '方块/落下/又/消失/在/光里' },
    { start: 35.0, duration: 4.2, words: 'Every /broken /piece /finds /a /place /to /fall' },
    { start: 39.6, duration: 2.6, words: '最后/一行/也/填满' },
];

const DURATION = 45;

/** 词的时间按字数在句内平均分，词与词之间留一点空。 */
const buildLines = (useSegmentation: boolean): Line[] => SAMPLE.map(sample => {
    const segments = sample.words.split('/');
    const weights = segments.map(segment => Math.max(1, segment.trim().length * (/[a-z]/i.test(segment) ? 0.4 : 1)));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let cursor = sample.start;
    const words = segments.map((text, index) => {
        const span = (sample.duration * weights[index]) / total;
        const word = { text, startTime: cursor, endTime: cursor + span * 0.92 };
        cursor += span;
        return word;
    });
    const fullText = segments.join('');
    return {
        words,
        startTime: sample.start,
        endTime: sample.start + sample.duration,
        fullText,
        ...(useSegmentation ? { wordSegments: segments } : {}),
    };
});

const SPEEDS = [0.5, 1, 2];
/** 暂停后用 ±0.1s 一帧帧看消行。 */
const SEEK_STEPS = [-5, -0.1, 0.1, 5];

const buttonClass = 'rounded-lg border border-current/20 bg-current/5 px-3 py-1.5 transition-colors hover:bg-current/10';

const TesseraLyricsProbe: React.FC = () => {
    const currentTime = React.useMemo(() => motionValue(0), []);
    const [playing, setPlaying] = React.useState(true);
    const [speed, setSpeed] = React.useState(1);
    const [dark, setDark] = React.useState(true);
    const [segmented, setSegmented] = React.useState(true);
    const [showGrid, setShowGrid] = React.useState(false);
    const clockRef = React.useRef<HTMLSpanElement>(null);
    const lines = React.useMemo(() => buildLines(segmented), [segmented]);
    const theme = dark ? DEFAULT_THEME : DAYLIGHT_THEME;

    // 探针自己的时钟：播放时推进 currentTime，读数直接写进 DOM，不走 React state。
    React.useEffect(() => {
        let frame = 0;
        let last = performance.now();
        const tick = (now: number) => {
            frame = requestAnimationFrame(tick);
            const delta = Math.min(0.1, (now - last) / 1000);
            last = now;
            if (playing) {
                const next = currentTime.get() + delta * speed;
                currentTime.set(next >= DURATION ? 0 : next);
            }
            if (clockRef.current) clockRef.current.textContent = `${currentTime.get().toFixed(2)}s / ${DURATION}s`;
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [currentTime, playing, speed]);

    const seek = (delta: number) => currentTime.set(Math.max(0, Math.min(DURATION - 0.01, currentTime.get() + delta)));

    return (
        <div className="relative h-screen w-full overflow-hidden" style={{ background: theme.backgroundColor, color: theme.primaryColor }}>
            <TesseraBoard lines={lines} currentTime={currentTime} theme={theme} showGrid={showGrid} />
            <div className="absolute left-4 top-4 flex flex-wrap items-center gap-2 text-xs">
                <button type="button" data-probe-play className={buttonClass} onClick={() => setPlaying(value => !value)}>
                    {playing ? '暂停' : '播放'}
                </button>
                <button type="button" className={buttonClass} onClick={() => currentTime.set(0)}>从头</button>
                {SEEK_STEPS.map(delta => (
                    <button key={delta} type="button" data-probe-seek={delta} className={buttonClass} onClick={() => seek(delta)}>
                        {delta > 0 ? '+' : ''}{delta}s
                    </button>
                ))}
                {SPEEDS.map(value => (
                    <button
                        key={value}
                        type="button"
                        className={`${buttonClass} ${speed === value ? 'font-bold' : 'opacity-60'}`}
                        onClick={() => setSpeed(value)}
                    >
                        {value}×
                    </button>
                ))}
                <button type="button" className={buttonClass} onClick={() => setDark(value => !value)}>
                    {dark ? '深色' : '浅色'}
                </button>
                <button type="button" data-probe-segmentation className={buttonClass} onClick={() => setSegmented(value => !value)}>
                    {segmented ? '词典分词' : 'Intl 分词'}
                </button>
                <button type="button" className={buttonClass} onClick={() => setShowGrid(value => !value)}>
                    {showGrid ? '网格开' : '网格关'}
                </button>
                <span ref={clockRef} className="ml-2 font-mono tabular-nums opacity-70" />
            </div>
        </div>
    );
};

const definition: ProbeDefinition = {
    id: 'tesseraLyrics',
    title: '方块字（俄罗斯方块风格）',
    description: '歌词按分词变成方块，以文字形态落下、落地长出边框；每行唱完那一刻正好填满消掉。长句切成两行、短句由垫块补满；消行后上面的行往下掉。',
    Component: TesseraLyricsProbe,
};

export default definition;
