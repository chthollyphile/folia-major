import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useVisualizerSettingsStore } from '../../../stores/useVisualizerSettingsStore';
import type { LyricAntialias, LyricRenderOverride, LyricRenderScale } from '../../../types';
import { formatLyricRenderScale, LYRIC_ANTIALIAS_OVERRIDES, LYRIC_RENDER_SCALES } from '../../../utils/lyricRenderQuality';
import { Row, Segmented, Select } from '../../modal/settings/kit';

// src/components/visualizer/renderQuality/LyricRenderQualityRows.tsx
// 用 canvas / WebGL 画的歌词样式在自己设置面板里的「分辨率」「抗锯齿」两行（#929）：默认「跟随全局」，说明里写着全局挡位
// 现在是什么；选了具体值就只改这个样式。全局挡位的那两行在「性能与动效」页（GraphicsPage）。

export const LYRIC_ANTIALIAS_LABEL_KEYS: Record<LyricAntialias, string> = {
    auto: 'options.lyricAntialiasAuto',
    on: 'options.lyricAntialiasOn',
    off: 'options.lyricAntialiasOff',
};

/** 分辨率倍数的选项（全局挡位用；样式面板在最前面多一个「跟随全局」）。 */
export const lyricRenderScaleChoices = () => LYRIC_RENDER_SCALES.map(scale => ({ value: String(scale), label: formatLyricRenderScale(scale) }));

/** 全局挡位抗锯齿的选项。 */
export const lyricAntialiasChoices = (t: TFunction) => (['auto', 'on', 'off'] as const).map(mode => ({ value: mode, label: t(LYRIC_ANTIALIAS_LABEL_KEYS[mode]) }));

type LyricRenderQualityRowsProps = {
    value: LyricRenderOverride;
    onChange: (patch: Partial<LyricRenderOverride>) => void;
    /** 抗锯齿那一行（全屏着色器、2D canvas 的样式没有，只给分辨率）。 */
    antialias?: boolean;
};

const LyricRenderQualityRows: React.FC<LyricRenderQualityRowsProps> = ({ value, onChange, antialias = true }) => {
    const { t } = useTranslation();
    const global = useVisualizerSettingsStore(state => state.lyricRenderQuality);
    const follow = t('options.lyricRenderFollowGlobal');
    return (
        <>
            <Row
                label={t('options.lyricRenderScale')}
                note={t('options.lyricRenderScaleStyleHint', { value: formatLyricRenderScale(global.scale) })}
            >
                <Select<string>
                    value={String(value.scale)}
                    options={[{ value: 'global', label: follow }, ...lyricRenderScaleChoices()]}
                    onChange={next => onChange({ scale: next === 'global' ? 'global' : (LYRIC_RENDER_SCALES.find(scale => String(scale) === next) ?? 'global') as LyricRenderScale | 'global' })}
                />
            </Row>
            {antialias && (
                <Row
                    label={t('options.lyricAntialias')}
                    note={t('options.lyricAntialiasStyleHint', { value: t(LYRIC_ANTIALIAS_LABEL_KEYS[global.antialias]) })}
                >
                    <Segmented<LyricRenderOverride['antialias']>
                        value={value.antialias}
                        options={LYRIC_ANTIALIAS_OVERRIDES.map(mode => ({ value: mode, label: mode === 'global' ? follow : t(LYRIC_ANTIALIAS_LABEL_KEYS[mode]) }))}
                        onChange={next => onChange({ antialias: next })}
                    />
                </Row>
            )}
        </>
    );
};

export default LyricRenderQualityRows;
