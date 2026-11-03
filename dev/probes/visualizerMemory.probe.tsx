import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMotionValue } from 'framer-motion';
import { DAYLIGHT_THEME, DEFAULT_THEME } from '../../src/services/baseThemes';
import { getVisualizerRegistryEntry } from '../../src/components/visualizer/registry';
import { normalizeHanabiTuning } from '../../src/components/visualizer/hanabi/hanabiTuning';
import { DEFAULT_LUMIERE_TUNING, DEFAULT_PENDOLO_TUNING, DEFAULT_SONNET_TUNING, type Line, type LumiereRenderQuality, type Theme } from '../../src/types';
import type { ProbeDefinition } from './definition';

// dev/probes/visualizerMemory.probe.tsx

/**
 * 单个 visualizer 的长跑内存/性能台架。
 *
 * 存在的理由：visualizer 的内存可能来自 JS 堆之外的 canvas backing store、合成层和 GPU
 * 资源，单测和 jsdom 无法覆盖这些路径。这个探针只挂一个 visualizer，用加速时间轴喂它
 * 合成歌词，配合 `npm run manual:visualizer-memory` 采样 Chromium 各进程的工作集，可用于
 * 横向对比不同 visualizer，或者 A/B 同一个 visualizer 改动前后的稳态占用。
 *
 * 用法见文件末尾的 description，或直接 `?probe=visualizerMemory&vis=<mode>`。
 */

const WORDS = ['echo', 'lantern', 'drift', 'harbour', 'salt', 'quiet', 'ember', 'tide', 'glass', 'shore'];

/** 每行 3 秒、逐字计时的合成歌词，长度足够让窗口化的行布局反复进出。 */
const buildLines = (count: number): Line[] => {
    const lines: Line[] = [];
    for (let index = 0; index < count; index += 1) {
        const start = index * SECONDS_PER_LINE;
        const wordCount = 5 + (index % 5);
        const words = Array.from({ length: wordCount }, (_, offset) => ({
            text: WORDS[(index + offset) % WORDS.length]!,
            startTime: start + (offset * SECONDS_PER_LINE) / wordCount,
            endTime: start + ((offset + 1) * SECONDS_PER_LINE) / wordCount,
        }));
        lines.push({
            id: `line-${index}`,
            words,
            startTime: start,
            endTime: start + SECONDS_PER_LINE - 0.1,
            fullText: words.map(word => word.text).join(' '),
            translation: `译文 ${index} ${words.slice(0, 3).map(word => word.text).join('')}`,
            isChorus: index % 4 === 0,
        });
    }
    return lines;
};

const SECONDS_PER_LINE = 3;

/** 中文长短句（2–32 字，含逗号与中英混排），测竖排 / 横排的折行与缩字。 */
const CJK_LINES = [
    '迷失在无边际这幽深的森林',
    '风吹过',
    '我们慢慢走回去，星河与风一起落在很远很远的地方',
    '光落在晨雾里',
    '你说夜色会把所有的名字都轻轻藏起来',
    '晚安',
    '在城市尽头等一场迟到的雨',
    '把回忆折成纸船放进河流',
    '轻轻唱 hello again 在无人的街角',
    '我听见远方的海潮一遍一遍拍打着沉默的礁石和那座早已熄灭多年的灯塔',
];

/** 与 buildLines 同样的节奏，但歌词是 CJK_LINES 循环、逐字计时（分词交给 Intl.Segmenter）。 */
const buildCjkLines = (count: number): Line[] => Array.from({ length: count }, (_, index) => {
    const start = index * SECONDS_PER_LINE;
    const fullText = CJK_LINES[index % CJK_LINES.length]!;
    const chars = Array.from(fullText);
    const step = (SECONDS_PER_LINE - 0.2) / chars.length;
    return {
        id: `line-${index}`,
        words: chars.map((text, offset) => ({ text, startTime: start + offset * step, endTime: start + (offset + 1) * step })),
        startTime: start,
        endTime: start + SECONDS_PER_LINE - 0.1,
        fullText,
        translation: `translation ${index}`,
        isChorus: index % 4 === 0,
    };
});

const LONG_SONG_WORDS = ['hello', 'again', 'midnight', 'river', 'we', 'were', 'young', 'under', 'neon', 'rain', 'hold', 'on'];
/** 长歌的段落长度（行数）循环。 */
const LONG_SONG_PARAGRAPHS = [4, 6, 8, 5, 6, 7];

/**
 * 长歌：80 行、约 5 分钟，中文长短句与英文行 2:1 混排，行长 2.4–4.2 秒，4–8 行一个段落、段落之间空 3 秒，
 * 前奏 6 秒，隔一个段落标一次副歌。测整首编成一个单元（轨迹过渡）时的构建耗时与内存。
 */
const buildLongSong = (): Line[] => {
    const lines: Line[] = [];
    let time = 6;
    let paragraph = 0;
    let inParagraph = 0;
    for (let index = 0; index < 80; index += 1) {
        const duration = 2.4 + (((index * 7) % 10) / 10) * 1.8;
        const latin = index % 3 === 2;
        const tokens = latin
            ? Array.from({ length: 4 + (index % 4) }, (_, offset) => LONG_SONG_WORDS[(index + offset) % LONG_SONG_WORDS.length]!)
            : Array.from(CJK_LINES[index % CJK_LINES.length]!);
        const step = (duration - 0.1) / tokens.length;
        const words = tokens.map((text, offset) => ({
            text: latin && offset < tokens.length - 1 ? `${text} ` : text,
            startTime: time + offset * step,
            endTime: time + (offset + 1) * step,
        }));
        lines.push({
            id: `line-${index}`,
            words,
            startTime: time,
            endTime: time + duration,
            fullText: words.map(word => word.text).join(''),
            translation: `translation ${index}`,
            isChorus: paragraph % 2 === 1,
        });
        time += duration + 0.15;
        inParagraph += 1;
        if (inParagraph >= LONG_SONG_PARAGRAPHS[paragraph % LONG_SONG_PARAGRAPHS.length]!) {
            paragraph += 1;
            inParagraph = 0;
            time += 3;
        }
    }
    return lines;
};

const COVER_URL = `data:image/svg+xml;utf8,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">'
    + '<rect width="600" height="600" fill="#2563eb"/>'
    + '<circle cx="300" cy="300" r="180" fill="#f97316"/>'
    + '</svg>',
)}`;

const params = new URLSearchParams(window.location.search);
const MODE = params.get('vis') ?? 'pendolo';
/** 时间轴倍速。8x 意味着每 0.375 秒过一行，几分钟就能跑完一整首歌的行切换量。 */
const SPEED = Number(params.get('speed') ?? '8');
/** 中文长短句歌词（默认是拉丁合成词）。 */
const CJK = params.get('cjk') === '1';
/** 长歌（80 行、约 5 分钟、中英混排、有段落空隙，见 buildLongSong）；给了它 lines= 与 cjk= 不起作用。 */
const LONG_SONG = params.get('long') === '1';
const LINES = LONG_SONG ? buildLongSong() : (CJK ? buildCjkLines : buildLines)(Number(params.get('lines') ?? '400'));
/** 最后一行之后再放多少秒才循环（片尾卡之类在歌词唱完后才出现的东西要用）。 */
const TAIL_SECONDS = Number(params.get('tail') ?? '0');
const TOTAL_SECONDS = (LONG_SONG ? LINES.at(-1)!.endTime + 1 : LINES.length * SECONDS_PER_LINE) + TAIL_SECONDS;
/** 从第几秒开始放；配合 speed=0 可以停在一帧上持续渲染（测稳态帧时间）。 */
const START_SECONDS = Number(params.get('start') ?? '0');
/** 每隔 N 秒换一次 seed，模拟切歌时输入 seed 变化；是否重挂载由宿主的 key 策略决定。0 表示不换。 */
const SWITCH_SECONDS = Number(params.get('switch') ?? '0');
/** 冻结在固定一帧，用来逐像素比对改动前后的渲染结果。 */
const FREEZE = params.get('freeze') === '1';
const HIDE_TEXT = params.get('notext') === '1';
/** 打开该 visualizer 全部可选装饰，测最坏情况。 */
const HEAVY = params.get('heavy') === '1';
/** 商籁后处理默认关闭；测试时开启，用于覆盖含滤镜的缩放路径。 */
const SONNET_TUNING = params.get('postprocess') === '1'
    ? { ...DEFAULT_SONNET_TUNING, postProcessEnabled: true }
    : DEFAULT_SONNET_TUNING;
/**
 * Pendolo 专用消融开关，用来把内存归因到具体图层：
 * - `canvas` 整个机芯 canvas 不挂载
 * - `gears` canvas 照常每帧重绘，但只画中心渐变，不画齿轮线条
 */
const ABLATE = params.get('ablate');

/** 给主题加上 wordColors / lyricsIcons（关键字着色与主题图标）。 */
const KEYWORDS = params.get('keywords') === '1';
/** 浅色主题（绘光的暗场有 0.94 的保底）。 */
const DAYLIGHT = params.get('daylight') === '1';
/** 带曲名 / 艺人 / 专辑，走到片尾卡（配合 lines= 让歌词早点唱完）。 */
const META = params.get('meta') === '1';
/** 绘光画质档：full / balanced / low。 */
const LUMIERE_QUALITY = (params.get('quality') ?? 'full') as LumiereRenderQuality;
/** 绘光暗场强度（0..1）；不给用默认值。 */
const LUMIERE_DARK_FIELD = params.has('dark') ? Number(params.get('dark')) : DEFAULT_LUMIERE_TUNING.darkField;
/** 绘光轨迹过渡（整首歌一个单元，段落之间也走光位交接）。 */
const LUMIERE_SEAMLESS = params.get('seamless') === '1';
/** 绘光仅显示歌词文字（光源、烟雾等装饰都不画）。 */
const LUMIERE_TEXT_ONLY = params.get('textonly') === '1';
/** 绘光主题色占比（0..1）；不给用默认值。 */
const LUMIERE_THEME_MIX = params.has('mix') ? Number(params.get('mix')) : DEFAULT_LUMIERE_TUNING.themeColorMix;
/** 覆盖主题色：colors=<强调>,<主>,<次>（不带 #），用来看主题色占比的效果。 */
/** 绘光图形 / 文字辉光倍率（两者同值）；不给用默认值。bloom=0 用来排查辉光滤镜的问题。 */
const LUMIERE_BLOOM = params.has('bloom') ? Number(params.get('bloom')) : null;
const THEME_COLORS = params.get('colors')?.split(',').map(hex => `#${hex}`) ?? null;
/** 花火 tuning 覆盖：hanabi=<JSON>（例如 {"sky":0,"collage":2}），缺的字段走默认。 */
const HANABI_TUNING = normalizeHanabiTuning(params.has('hanabi') ? JSON.parse(params.get('hanabi')!) : {});
/** 所选样式自己的 tuning 覆盖：tuning=<JSON>（例如流光、云阶的 {"avoidOverlap":true}），按样式的读法补齐默认。 */
const MODE_TUNING = params.has('tuning') ? JSON.parse(params.get('tuning')!) : null;
/** 主题的动效强度：intensity=calm|normal|chaotic。 */
const INTENSITY = params.get('intensity') as Theme['animationIntensity'] | null;

/** 时刻 time 的当前行（第一行之前算第一行）。 */
const lineIndexAt = (time: number) => {
    let index = 0;
    for (let i = 0; i < LINES.length; i += 1) if (LINES[i]!.startTime <= time) index = i;
    return index;
};

const resolveProbeTheme = (): Theme => {
    const preset = DAYLIGHT ? DAYLIGHT_THEME : DEFAULT_THEME;
    const base = THEME_COLORS
        ? {
            ...preset,
            accentColor: THEME_COLORS[0] ?? preset.accentColor,
            primaryColor: THEME_COLORS[1] ?? preset.primaryColor,
            secondaryColor: THEME_COLORS[2] ?? preset.secondaryColor,
        }
        : preset;
    const withIntensity = INTENSITY ? { ...base, animationIntensity: INTENSITY } : base;
    if (!KEYWORDS) return withIntensity;
    return {
        ...withIntensity,
        wordColors: [
            { word: 'lantern', color: '#ff5a8a' },
            { word: 'ember', color: '#ffb347' },
            { word: 'tide', color: '#5ad1ff' },
        ],
        lyricsIcons: ['Moon', 'Star', 'Flame', 'Waves'],
    };
};
const PROBE_THEME = resolveProbeTheme();

const FREEZE_TIME_SECONDS = 37.5;
const FREEZE_LINE_INDEX = 12;

const resolvePendoloTuning = () => {
    if (ABLATE === 'canvas') {
        return { ...DEFAULT_PENDOLO_TUNING, showGearDecor: 'none' as const, showCenterGradient: false, showCoverOnWatchFace: false };
    }
    if (ABLATE === 'gears') {
        return { ...DEFAULT_PENDOLO_TUNING, showGearDecor: 'none' as const, showCenterGradient: true };
    }
    if (HEAVY) {
        return { ...DEFAULT_PENDOLO_TUNING, showGearDecor: 'full' as const, enableLineGlow: true, showCoverOnWatchFace: true };
    }
    return DEFAULT_PENDOLO_TUNING;
};

const VisualizerMemoryProbe: React.FC = () => {
    const currentTime = useMotionValue(0);
    const audioPower = useMotionValue(0.4);
    const bass = useMotionValue(0.4);
    const lowMid = useMotionValue(0.4);
    const mid = useMotionValue(0.4);
    const vocal = useMotionValue(0.4);
    const treble = useMotionValue(0.4);
    const [currentLineIndex, setCurrentLineIndex] = useState(0);
    const [seedTick, setSeedTick] = useState(0);
    const lineIndexRef = useRef(0);

    const audioBands = useMemo(
        () => ({ bass, lowMid, mid, vocal, treble }),
        [bass, lowMid, mid, vocal, treble],
    );

    useEffect(() => {
        if (SWITCH_SECONDS <= 0 || FREEZE) return undefined;
        const id = window.setInterval(() => setSeedTick(value => value + 1), SWITCH_SECONDS * 1000);
        return () => window.clearInterval(id);
    }, []);

    useEffect(() => {
        if (FREEZE) {
            currentTime.set(FREEZE_TIME_SECONDS);
            setCurrentLineIndex(LONG_SONG ? lineIndexAt(FREEZE_TIME_SECONDS) : FREEZE_LINE_INDEX);
            return undefined;
        }

        let raf = 0;
        let lastFrameAt = performance.now();
        let elapsed = START_SECONDS;
        const tick = (now: number) => {
            const dt = (now - lastFrameAt) / 1000;
            lastFrameAt = now;
            elapsed = (elapsed + dt * SPEED) % TOTAL_SECONDS;
            currentTime.set(elapsed);

            // 合成一点频谱起伏，让依赖音频的图层走到它们的活跃分支。
            const phase = now / 1000;
            bass.set(0.35 + 0.3 * Math.sin(phase * 2.1));
            lowMid.set(0.35 + 0.3 * Math.sin(phase * 1.7));
            mid.set(0.35 + 0.3 * Math.sin(phase * 1.3));
            vocal.set(0.35 + 0.3 * Math.sin(phase * 2.6));
            treble.set(0.35 + 0.3 * Math.sin(phase * 3.1));
            audioPower.set(0.4 + 0.3 * Math.sin(phase * 1.9));

            const index = LONG_SONG ? lineIndexAt(elapsed) : Math.min(LINES.length - 1, Math.floor(elapsed / SECONDS_PER_LINE));
            if (index !== lineIndexRef.current) {
                lineIndexRef.current = index;
                setCurrentLineIndex(index);
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [audioPower, bass, currentTime, lowMid, mid, treble, vocal]);

    const entry = getVisualizerRegistryEntry(MODE);

    return (
        <div className="fixed inset-0" data-probe-mode={MODE}>
            {entry.render({
                currentTime,
                currentLineIndex,
                lines: LINES,
                theme: PROBE_THEME,
                audioPower,
                audioBands,
                showText: !HIDE_TEXT,
                paused: FREEZE,
                seed: `probe-${seedTick}`,
                coverUrl: HEAVY ? COVER_URL : null,
                pendoloTuning: resolvePendoloTuning(),
                sonnetTuning: SONNET_TUNING,
                lumiereTuning: {
                    ...DEFAULT_LUMIERE_TUNING,
                    renderQuality: LUMIERE_QUALITY,
                    darkField: LUMIERE_DARK_FIELD,
                    seamlessTransitions: LUMIERE_SEAMLESS,
                    textOnly: LUMIERE_TEXT_ONLY,
                    themeColorMix: LUMIERE_THEME_MIX,
                    ...(LUMIERE_BLOOM === null ? {} : { bloom: LUMIERE_BLOOM, textBloom: LUMIERE_BLOOM }),
                },
                visualizerTunings: { hanabi: HANABI_TUNING, ...(MODE_TUNING ? { [MODE]: MODE_TUNING } : {}) },
                // Styles from before visualizerTunings (classic, partita...) read their own prop, which the host fills.
                ...(MODE_TUNING ? { [`${MODE}Tuning`]: MODE_TUNING } : {}),
                songTitle: META ? 'Lantern Tide' : null,
                songArtist: META ? 'Probe Ensemble' : null,
                songAlbum: META ? 'Synthetic Nights' : null,
            } as never)}
        </div>
    );
};

const definition: ProbeDefinition = {
    id: 'visualizerMemory',
    title: 'Visualizer · 内存长跑台架',
    description: '用加速时间轴长时间驱动单个 visualizer，配合 npm run manual:visualizer-memory 采样各进程内存。'
        + ' 参数：vis=<mode> speed=<倍速> lines=<行数> switch=<切歌间隔秒> heavy=1 notext=1 freeze=1 ablate=canvas|gears'
        + ' tail=<秒> start=<秒> keywords=1 daylight=1 meta=1 quality=full|balanced|low（后四个给绘光这类读主题关键字 / 片尾卡 / 画质的模式）'
        + ' cjk=1（中文长短句歌词，测折行） dark=<0..1>（绘光暗场强度）'
        + ' postprocess=1（商籁开启后处理，测滤镜纹理池缩放释放）'
        + ' long=1（80 行约 5 分钟的中英混排长歌，带段落空隙） seamless=1（绘光轨迹过渡：整首歌一个单元） textonly=1（绘光仅显示歌词文字） mix=<0..1>（绘光主题色占比） colors=<强调>,<主>,<次>（覆盖主题色，十六进制不带 #） bloom=<0..2>（绘光辉光倍率） hanabi=<JSON>（花火 tuning 覆盖）'
        + ' tuning=<JSON>（所选样式的 tuning 覆盖） intensity=calm|normal|chaotic（主题动效强度）',
    Component: VisualizerMemoryProbe,
};

export default definition;
