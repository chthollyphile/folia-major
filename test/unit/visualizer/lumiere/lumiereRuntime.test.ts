import { describe, expect, it } from 'vitest';
import { motionValue } from 'framer-motion';
import { DEFAULT_LUMIERE_TUNING, type AudioBands } from '@/types';
import { compileLumiereProgram } from '@/components/visualizer/lumiere/lumiereProgram';
import {
    LUMIERE_QUALITY_PROFILES,
    LUMIERE_LIVE_SCENE_KEYS,
    requiresLumiereSceneRebuild,
    resolveLumiereBloomLevelDrop,
    resolveLumiereGraphicsResolution,
    resolveLumiereRenderResolution,
    resolveLumiereScaledRenderResolution,
    toLumiereSceneTuning,
} from '@/components/visualizer/lumiere/lumiereRuntimeTuning';
import { resolveLumiereSceneFrames } from '@/components/visualizer/lumiere/lumiereSceneFrames';
import { LUMIERE_TRANSITIONS } from '@/components/visualizer/lumiere/lumiereTransitions';
import {
    createLumiereAudioSampler,
    normalizeLumiereAudioValue,
} from '@/components/visualizer/lumiere/lumiereAudio';
import { syntheticSong } from './lumiereFixtures';

// test/unit/visualizer/lumiere/lumiereRuntime.test.ts
// 绘光运行时的纯逻辑：tuning 映射与画质档、哪些改动要重建场景、段落转场帧（出场 / 进入交叉渐变），以及音频归一化。

describe('绘光 tuning → 场景 tuning', () => {
    it('复制共享字段，仅显示歌词文字、关键词着色与主题图标直通', () => {
        const scene = toLumiereSceneTuning({ ...DEFAULT_LUMIERE_TUNING, keywordColors: false, themeIcons: false }, { showText: true });
        expect(scene.textOnly).toBe(false);
        expect(toLumiereSceneTuning({ ...DEFAULT_LUMIERE_TUNING, textOnly: true }, { showText: true }).textOnly).toBe(true);
        expect(scene.keywordColors).toBe(false);
        expect(scene.themeIcons).toBe(false);
        expect(scene.lightIntensity).toBe(DEFAULT_LUMIERE_TUNING.lightIntensity);
        expect(scene.fogOctaves).toBe(DEFAULT_LUMIERE_TUNING.fogOctaves);
    });

    it('不显示歌词时关掉背景歌词碎片', () => {
        expect(toLumiereSceneTuning(DEFAULT_LUMIERE_TUNING, { showText: false }).echo).toBe(0);
    });

    it('隐藏径迹实时传给场景，不重建也不影响飞行或轨迹过渡', () => {
        const base = toLumiereSceneTuning(DEFAULT_LUMIERE_TUNING, { showText: true });
        const hidden = toLumiereSceneTuning({ ...DEFAULT_LUMIERE_TUNING, hideTrails: true }, { showText: true });
        expect(hidden).toEqual({ ...base, hideTrails: true });
        expect(LUMIERE_LIVE_SCENE_KEYS).toContain('hideTrails');
        expect(requiresLumiereSceneRebuild(base, hidden)).toBe(false);
        expect(requiresLumiereSceneRebuild(hidden, base)).toBe(false);
    });

    it('画质档封顶倍频、低画质减浮尘', () => {
        const tuning = { ...DEFAULT_LUMIERE_TUNING, fogOctaves: 6, moteAmount: 1 };
        expect(toLumiereSceneTuning({ ...tuning, renderQuality: 'full' }, { showText: true }).fogOctaves).toBe(6);
        expect(toLumiereSceneTuning({ ...tuning, renderQuality: 'balanced' }, { showText: true }).fogOctaves).toBe(4);
        const low = toLumiereSceneTuning({ ...tuning, renderQuality: 'low' }, { showText: true });
        expect(low.fogOctaves).toBe(3);
        expect(low.moteAmount).toBeCloseTo(LUMIERE_QUALITY_PROFILES.low.moteScale);
        // 用户设得比上限低时按用户的。
        expect(toLumiereSceneTuning({ ...tuning, fogOctaves: 2, renderQuality: 'low' }, { showText: true }).fogOctaves).toBe(2);
    });

    it('每帧现读的字段不重建，烘焙进场景的字段与 bloom 跨 0 才重建', () => {
        const base = toLumiereSceneTuning(DEFAULT_LUMIERE_TUNING, { showText: true });
        const live = { ...base, lightIntensity: 1.7, fogDensity: 0.3, audioResponse: 0, unlitOpacity: 0.5, fogOctaves: 3, bloom: 1.8, textBloom: 0.4, darkField: 0.1 };
        expect(requiresLumiereSceneRebuild(base, live)).toBe(false);
        expect(requiresLumiereSceneRebuild(base, { ...base, bloom: 0 })).toBe(true);
        expect(requiresLumiereSceneRebuild(base, { ...base, windowNeighbors: 1 })).toBe(true);
        expect(requiresLumiereSceneRebuild(base, { ...base, keywordColors: false })).toBe(true);
        expect(requiresLumiereSceneRebuild(base, { ...base, themeIcons: false })).toBe(true);
        expect(requiresLumiereSceneRebuild(base, { ...base, textOnly: true })).toBe(true);
        expect(requiresLumiereSceneRebuild(base, { ...base, themeColorMix: 0.2 })).toBe(true);
        expect(requiresLumiereSceneRebuild(base, { ...base, overlayFrame: false })).toBe(false);
    });
});

describe('绘光画质档的分辨率', () => {
    it('渲染分辨率跟随 devicePixelRatio，钳在 1..2', () => {
        expect(resolveLumiereRenderResolution(undefined)).toBe(1);
        expect(resolveLumiereRenderResolution(0.5)).toBe(1);
        expect(resolveLumiereRenderResolution(1.25)).toBe(1.25);
        expect(resolveLumiereRenderResolution(3)).toBe(2);
    });

    it('分辨率倍数乘在 base 上：1 倍与原来一样，超采样封顶 3，缩小照样生效；画质档再从乘过的分辨率往下降', () => {
        for (const ratio of [undefined, 1, 1.25, 2, 3]) {
            expect(resolveLumiereScaledRenderResolution(ratio, 1)).toBe(resolveLumiereRenderResolution(ratio));
        }
        expect(resolveLumiereScaledRenderResolution(1, 2)).toBe(2);
        expect(resolveLumiereScaledRenderResolution(1.25, 1.5)).toBeCloseTo(1.875);
        expect(resolveLumiereScaledRenderResolution(2, 2)).toBe(3);
        expect(resolveLumiereScaledRenderResolution(3, 1.5)).toBe(3);
        expect(resolveLumiereScaledRenderResolution(2, 0.5)).toBe(1);
        const scaled = resolveLumiereScaledRenderResolution(2, 1.5);
        expect(resolveLumiereGraphicsResolution(1600, 900, scaled, 'full')).toBe(scaled);
        expect(resolveLumiereGraphicsResolution(1600, 900, scaled, 'low')).toBeLessThanOrEqual(scaled * LUMIERE_QUALITY_PROFILES.low.graphicsScale);
    });

    it('满画质图形组与屏幕同分辨率；降档后更低，且不超过倍率', () => {
        expect(resolveLumiereGraphicsResolution(1600, 900, 1.5, 'full')).toBe(1.5);
        const balanced = resolveLumiereGraphicsResolution(1600, 900, 1.5, 'balanced');
        const low = resolveLumiereGraphicsResolution(1600, 900, 1.5, 'low');
        expect(balanced).toBeLessThanOrEqual(1.5 * 0.7);
        expect(balanced).toBeGreaterThanOrEqual(1.5 * 0.7 * 0.75);
        expect(low).toBeLessThanOrEqual(1.5 * 0.5);
        expect(low).toBeLessThan(balanced);
    });

    it('按对数就近减 bloom 级数：0.8 倍不减，0.7 与 0.5 倍减一级', () => {
        expect(resolveLumiereBloomLevelDrop(2, 2)).toBe(0);
        expect(resolveLumiereBloomLevelDrop(2, 1.6)).toBe(0);
        expect(resolveLumiereBloomLevelDrop(2, 1.4)).toBe(1);
        expect(resolveLumiereBloomLevelDrop(2, 1)).toBe(1);
        expect(resolveLumiereBloomLevelDrop(2, 0.5)).toBe(2);
    });
});

describe('绘光段落转场帧', () => {
    const program = compileLumiereProgram(syntheticSong(7), 'runtime-frames');
    const withTransition = program.paragraphs.findIndex((paragraph, index) => (
        paragraph.transitionOut !== null && index + 1 < program.paragraphs.length
    ));

    it('段落内部只画当前段，满透明度', () => {
        const paragraph = program.paragraphs[1]!;
        const time = paragraph.startTime + 1.5;
        const frames = resolveLumiereSceneFrames(program, time, true);
        expect(frames.activeIndex).toBe(1);
        if (!paragraph.transitionOut || time < paragraph.transitionOut.startTime) {
            expect(frames.layers).toEqual([{ index: 1, alpha: 1, scale: 1, blur: 0 }]);
        }
    });

    it('出场窗口里套 exit 帧；熄灯不压透明度（由场景自己收光）', () => {
        const paragraph = program.paragraphs[withTransition]!;
        const out = paragraph.transitionOut!;
        const time = (out.startTime + out.endTime) / 2;
        const frames = resolveLumiereSceneFrames(program, time, true);
        const layer = frames.layers.at(-1)!;
        expect(layer.index).toBe(withTransition);
        const expected = LUMIERE_TRANSITIONS[out.kind].resolveFrame('exit', 0.5);
        expect(layer.scale).toBeCloseTo(expected.scale);
        expect(layer.blur).toBeCloseTo(expected.blur);
        expect(layer.alpha).toBeCloseTo(out.kind === 'lights-out' ? 1 : expected.alpha);
    });

    it('边界之后与上一段交叉渐变，两侧连续', () => {
        const next = program.paragraphs[withTransition + 1]!;
        const justAfter = resolveLumiereSceneFrames(program, next.startTime + 0.001, true);
        expect(justAfter.activeIndex).toBe(withTransition + 1);
        expect(justAfter.layers.map(layer => layer.index)).toEqual([withTransition, withTransition + 1]);
        const [outgoing, incoming] = justAfter.layers;
        const beforeBoundary = resolveLumiereSceneFrames(program, next.startTime - 0.001, true).layers.at(-1)!;
        expect(outgoing!.alpha).toBeCloseTo(beforeBoundary.alpha, 2);
        expect(incoming!.alpha).toBeLessThan(0.01);
        // 进入窗口结束后只剩新段。
        const later = resolveLumiereSceneFrames(program, next.startTime + 1.2, true);
        expect(later.layers.map(layer => layer.index)).toEqual([withTransition + 1]);
    });

    it('静态模式硬切', () => {
        const next = program.paragraphs[withTransition + 1]!;
        const frames = resolveLumiereSceneFrames(program, next.startTime + 0.1, false);
        expect(frames.layers).toEqual([{ index: withTransition + 1, alpha: 1, scale: 1, blur: 0 }]);
    });
});

describe('绘光音频归一化', () => {
    const bandsOf = (bass: number, treble: number): AudioBands => ({
        bass: motionValue(bass),
        lowMid: motionValue(0),
        mid: motionValue(0),
        vocal: motionValue(0),
        treble: motionValue(treble),
    });

    it('0..255 与 0..1 两种量纲都落到 0..1', () => {
        expect(normalizeLumiereAudioValue(127.5, true)).toBeCloseTo(0.5);
        expect(normalizeLumiereAudioValue(0.5, false)).toBeCloseTo(0.5);
        expect(normalizeLumiereAudioValue(400, true)).toBe(1);
        expect(normalizeLumiereAudioValue(Number.NaN, false)).toBe(0);
    });

    it('见过 > 1 的值后粘住按 0..255 换算', () => {
        const bands = bandsOf(255, 0.5);
        const sampler = createLumiereAudioSampler({ audioPower: motionValue(0), audioBands: bands });
        sampler.sample(1000, false);
        expect(sampler.frame.bass).toBeGreaterThan(0.9);
        // 之后的 0.5 是 0..255 源里的安静段，不是半响。
        bands.bass.set(0.5);
        for (let i = 1; i <= 150; i += 1) sampler.sample(1000 + i * 16, false);
        expect(sampler.frame.bass).toBeLessThan(0.01);
    });

    it('预览源（0..1）直接使用；暂停归零', () => {
        const sampler = createLumiereAudioSampler({ audioPower: motionValue(0.3), audioBands: bandsOf(0.6, 0.2) });
        for (let i = 0; i < 30; i += 1) sampler.sample(1000 + i * 16, false);
        expect(sampler.frame.bass).toBeCloseTo(0.6, 2);
        expect(sampler.frame.power).toBeCloseTo(0.3, 2);
        sampler.sample(2000, true);
        expect(sampler.frame).toEqual({ bass: 0, treble: 0, power: 0 });
    });
});
