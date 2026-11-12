import React from 'react';
import { Group, Row, Segmented, type SettingsGroupDef } from '../../modal/settings/kit';
import { type VisualizerSettingsPanelProps } from '../definition';
import { usePlayerChromeSettingsStore } from '../../../stores/usePlayerChromeSettingsStore';
import { percent, SliderRow, times, ToggleRow } from '../panelRows';
import LyricRenderQualityRows from '../renderQuality/LyricRenderQualityRows';
import {
    DEFAULT_NEBBIA_TUNING,
    NEBBIA_APPEAR_STYLES,
    NEBBIA_BEHIND,
    NEBBIA_FADE_STYLES,
    NEBBIA_GLASS,
    NEBBIA_LAYOUTS,
    NEBBIA_LIMITS,
    NEBBIA_RAIN,
    NEBBIA_SCENERY,
    type NebbiaAppearStyle,
    type NebbiaFadeStyle,
    type NebbiaLayout,
    type NebbiaNumberKey,
    type NebbiaTuning,
} from './types';

// src/components/visualizer/nebbia/NebbiaSettingsPanel.tsx
// 雾笺的设置：最上面是窗外（选背景：街景、梦海流萤或共用背景，连同窗外画哪几样），然后是雾上写字（笔画、手写歪斜和变形、雾、片尾写曲名），字怎么出现、怎么消失、一句怎么构图（每种一个开关，开几种用几种），
// 窗外（车、霓虹、聚光灯），窗外画哪几样在最上面那组（聚光灯、楼群、光斑、车灯、马路各一个开关，雨斜着、竖直或不下），渲染（分辨率，
// 默认跟随全局）。用设置窗口的共用控件画成几组。
// 窗外选了水族箱时多三个滑块（水母数量、大小、气泡多少），开关和雨换成水族箱的说法（同一组位，见 nebbiaAquaGlsl.ts）。
// 前面雾玻璃上的水单独一组：雨窗（小雨点密度、大雨点大小）或凝露（冷凝水珠多少、大小、高光）；换窗外时玻璃换成那套的默认搭配。

export const NEBBIA_APPEAR_LABEL_KEYS: Record<NebbiaAppearStyle, string> = {
    write: 'options.nebbiaAppearWrite',
    fade: 'options.nebbiaAppearFade',
    breath: 'options.nebbiaAppearBreath',
};
export const NEBBIA_FADE_LABEL_KEYS: Record<NebbiaFadeStyle, string> = {
    fog: 'options.nebbiaFadeFog',
    fingers: 'options.nebbiaFadeFingers',
};
const LAYOUT_LABEL_KEYS = Object.fromEntries(
    NEBBIA_LAYOUTS.map(l => [l, `options.nebbiaLayout_${l}`]),
) as Record<NebbiaLayout, string>;

const seconds = (value: number) => `${value.toFixed(1)}s`;
const count = (value: number) => String(Math.round(value));
type SliderSpec = [NebbiaNumberKey, string, number, (value: number) => string];

const WRITING_GROUP: SettingsGroupDef = { id: 'vis-nebbia-writing', titleKey: 'options.nebbiaWriting' };
const WRITING_SLIDERS: SliderSpec[] = [
    ['strokeWidth', 'options.nebbiaStrokeWidth', 0.005, percent],
    ['writeSpeed', 'options.nebbiaWriteSpeed', 0.05, times],
    ['jitter', 'options.nebbiaJitter', 0.05, times],
    ['warp', 'options.nebbiaWarp', 0.05, times],
    ['doodle', 'options.nebbiaDoodle', 0.05, percent],
    ['mist', 'options.nebbiaMist', 0.01, percent],
    ['hold', 'options.nebbiaHold', 0.1, seconds],
    ['refog', 'options.nebbiaRefog', 0.5, seconds],
];
const WINDOW_GROUP: SettingsGroupDef = { id: 'vis-nebbia-window', titleKey: 'options.nebbiaWindow' };
const WINDOW_SLIDERS: SliderSpec[] = [
    ['busSpeed', 'options.nebbiaBusSpeed', 0.05, times],
    ['neon', 'options.nebbiaNeon', 0.05, times],
    ['bump', 'options.nebbiaBump', 0.05, times],
    ['spot', 'options.nebbiaSpot', 0.05, times],
    ['spotX', 'options.nebbiaSpotX', 0.01, percent],
];
// 分辨率（#929）：原来窗外一组里的分辨率滑块换成共用的「跟随全局 / 指定倍数」；全屏着色器没有 MSAA，不出抗锯齿那行。
const RENDER_GROUP: SettingsGroupDef = { id: 'vis-nebbia-render', titleKey: 'options.lyricRenderSection' };
/** 水族箱里车不颠：这条不显示。 */
const NOT_IN_AQUARIUM: readonly NebbiaNumberKey[] = ['bump'];
const AQUA_WINDOW_SLIDERS = WINDOW_SLIDERS.filter(([key]) => !NOT_IN_AQUARIUM.includes(key));
const AQUA_SLIDERS: SliderSpec[] = [
    ['jellies', 'options.nebbiaJellies', 1, count],
    ['jellySize', 'options.nebbiaJellySize', 0.05, times],
    ['bubbles', 'options.nebbiaBubbles', 0.05, percent],
];
const GLASS_GROUP: SettingsGroupDef = { id: 'vis-nebbia-glass', titleKey: 'options.nebbiaGlass' };
const GLASS_SLIDERS: Record<NebbiaTuning['glass'], SliderSpec[]> = {
    rain: [
        ['rainHit', 'options.nebbiaRainHit', 0.05, times],
        ['rainBig', 'options.nebbiaRainBig', 0.05, times],
    ],
    dew: [
        ['dew', 'options.nebbiaDew', 0.05, times],
        ['dewSize', 'options.nebbiaDewSize', 0.05, times],
        ['dewGlint', 'options.nebbiaDewGlint', 0.05, times],
    ],
    snow: [
        ['snow', 'options.nebbiaSnow', 0.05, times],
        ['snowSize', 'options.nebbiaSnowSize', 0.05, times],
        ['snowMelt', 'options.nebbiaSnowMelt', 0.05, times],
    ],
};
const APPEAR_GROUP: SettingsGroupDef = { id: 'vis-nebbia-appear', titleKey: 'options.nebbiaAppear' };
const FADE_GROUP: SettingsGroupDef = { id: 'vis-nebbia-fade', titleKey: 'options.nebbiaFade' };
const LAYOUT_GROUP: SettingsGroupDef = { id: 'vis-nebbia-layouts', titleKey: 'options.nebbiaLayouts' };
const SCENERY_GROUP: SettingsGroupDef = { id: 'vis-nebbia-scenery', titleKey: 'options.nebbiaScenery' };

/** 开关组里打开或关掉一项，按 choices 的顺序排；全关了返回 null（最后一项关不掉）。 */
const toggled = <T extends string>(choices: readonly T[], on: readonly T[], item: T, next: boolean): T[] | null => {
    const out = choices.filter(c => (c === item ? next : on.includes(c)));
    return out.length ? out : null;
};

const NebbiaSettingsPanel: React.FC<VisualizerSettingsPanelProps<NebbiaTuning>> = ({
    t,
    tuning,
    onTuningChange,
    onSliderPointerDown,
    onSliderCommit,
}) => {
    const resolved = tuning ?? DEFAULT_NEBBIA_TUNING;
    const drag = { onDragStart: onSliderPointerDown, onDragEnd: onSliderCommit };
    const aquarium = resolved.behind === 'aquarium';
    // 播放页透明时窗外固定透出后面：提示换一句，说明这里选的只决定水珠里折射什么（开着原生模糊也算透明，和 App.tsx 的 isPlayerPageTransparent 一样）
    const transparent = usePlayerChromeSettingsStore(state => state.transparentPlayerBackground || state.enablePlayerPageNativeBlur);
    // 开关和雨的文案：水族箱换一套说法
    const sceneryKey = aquarium ? 'options.nebbiaAquaScenery' : 'options.nebbiaScenery';
    const rainKey = aquarium ? 'options.nebbiaAquaRain' : 'options.nebbiaRain';
    const sliders = (specs: SliderSpec[]) => specs.map(([key, labelKey, step, format]) => (
        <SliderRow
            key={key}
            {...drag}
            label={t(labelKey)}
            value={resolved[key]}
            min={NEBBIA_LIMITS[key].min}
            max={NEBBIA_LIMITS[key].max}
            step={step}
            format={format}
            onChange={value => onTuningChange({ [key]: value } as Partial<NebbiaTuning>)}
        />
    ));
    // 一组开关：on 是打开的几项，patch 把新的一组写回 tuning；只剩一项时它的开关不能点
    const toggles = <T extends string>(choices: readonly T[], on: readonly T[], labels: Record<T, string>, patch: (next: T[]) => Partial<NebbiaTuning>) => (
        choices.map(item => (
            <ToggleRow
                key={item}
                label={t(labels[item])}
                checked={on.includes(item)}
                disabled={on.length === 1 && on[0] === item}
                onChange={next => {
                    const list = toggled(choices, on, item, next);
                    if (list) onTuningChange(patch(list));
                }}
            />
        ))
    );

    return (
        <>
            {/* 选窗外（背景）放在最上面，后面几组的说法和可调项都跟着它变；窗外每样单独开关，和下面几组不同，可以全关 */}
            <Group def={SCENERY_GROUP} foot={t(`${sceneryKey}Hint`)}>
                <Row label={t('options.nebbiaBehind')} note={t(transparent ? 'options.nebbiaBehindTransparentHint' : 'options.nebbiaBehindHint')}>
                    <Segmented<NebbiaTuning['behind']>
                        value={resolved.behind}
                        options={NEBBIA_BEHIND.map(behind => ({ value: behind, label: t(`options.nebbiaBehind_${behind}`) }))}
                        onChange={behind => onTuningChange({ behind })}
                    />
                </Row>
                {aquarium && sliders(AQUA_SLIDERS)}
                {/* 窗外用共用背景时街景不画，下面几项看不出来（聚光灯照在雾上的那圈光还在） */}
                {NEBBIA_SCENERY.map(part => (
                    <ToggleRow
                        key={part}
                        disabled={resolved.behind === 'backdrop' && part !== 'spot'}
                        label={t(`${sceneryKey}_${part}`)}
                        checked={resolved.scenery.includes(part)}
                        onChange={next => onTuningChange({ scenery: NEBBIA_SCENERY.filter(c => (c === part ? next : resolved.scenery.includes(c))) })}
                    />
                ))}
                {/* 街景的雨只画在聚光灯光柱里（被照亮的雨丝），聚光灯关着或强度为 0 时这项看不出来；水族箱的细气泡不看聚光灯；雪窗时街景窗外不下雨，这项不管用 */}
                <Row label={t(rainKey)} note={t(`${rainKey}Hint`)}>
                    <Segmented<NebbiaTuning['rain']>
                        disabled={resolved.behind === 'backdrop' || (!aquarium && (resolved.glass === 'snow' || !resolved.scenery.includes('spot') || resolved.spot <= 0))}
                        value={resolved.rain}
                        options={NEBBIA_RAIN.map(rain => ({ value: rain, label: t(`${rainKey}_${rain}`) }))}
                        onChange={rain => onTuningChange({ rain })}
                    />
                </Row>
            </Group>
            <Group def={WRITING_GROUP}>
                {sliders(WRITING_SLIDERS)}
                <ToggleRow
                    label={t('options.nebbiaCredits')}
                    note={t('options.nebbiaCreditsHint')}
                    checked={resolved.credits}
                    onChange={credits => onTuningChange({ credits })}
                />
            </Group>
            <Group def={APPEAR_GROUP} foot={t('options.nebbiaAppearHint')}>
                {toggles(NEBBIA_APPEAR_STYLES, resolved.appear, NEBBIA_APPEAR_LABEL_KEYS, appear => ({ appear }))}
            </Group>
            <Group def={FADE_GROUP} foot={t('options.nebbiaFadeHint')}>
                {toggles(NEBBIA_FADE_STYLES, resolved.fade, NEBBIA_FADE_LABEL_KEYS, fade => ({ fade }))}
            </Group>
            <Group def={LAYOUT_GROUP} foot={t('options.nebbiaLayoutsHint')}>
                {toggles(NEBBIA_LAYOUTS, resolved.layouts, LAYOUT_LABEL_KEYS, layouts => ({ layouts }))}
            </Group>
            <Group def={WINDOW_GROUP}>{sliders(aquarium ? AQUA_WINDOW_SLIDERS : WINDOW_SLIDERS)}</Group>
            <Group def={GLASS_GROUP}>
                <Row label={t('options.nebbiaGlassStyle')} note={t('options.nebbiaGlassHint')}>
                    <Segmented<NebbiaTuning['glass']>
                        value={resolved.glass}
                        options={NEBBIA_GLASS.map(glass => ({ value: glass, label: t(`options.nebbiaGlass_${glass}`) }))}
                        onChange={glass => onTuningChange({ glass })}
                    />
                </Row>
                {sliders(GLASS_SLIDERS[resolved.glass])}
            </Group>
            <Group def={RENDER_GROUP}>
                <LyricRenderQualityRows
                    value={resolved.render}
                    onChange={patch => onTuningChange({ render: { ...resolved.render, ...patch } })}
                    antialias={false}
                />
            </Group>
        </>
    );
};

export default NebbiaSettingsPanel;
