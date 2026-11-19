import React from 'react';
import { useTranslation } from 'react-i18next';
import { Toggle } from '../../modal/settings/kit';
import { useAutomixSettingsStore } from '../../../stores/useAutomixSettingsStore';
import {
    STEM_MIXER_GAIN_MAX,
    STEM_MIXER_GAIN_MIN,
    STEM_MIXER_STEMS,
    STEM_MIXER_PRESETS,
    useStemMixerStore,
    type StemMixerBlock,
    type StemMixerPreset,
    type StemMixerStatus,
} from '../../../stores/useStemMixerStore';
import { stemMixerBlock } from '../../../services/stemMixer/stemMixerAvailability';
import EqualizerSection from './EqualizerSection';
import Fader from './Fader';

// src/components/panelTab/equalizer/StemMixerSection.tsx
// 音效窗口里的「分轨调音台」一节：总开关（开着时在 GPU 上实时分离正在放的歌）、鼓 / 贝斯 / 其他 / 人声四个
// 推子（0.0–2.0×，1.0× 在正中）、三组强度（原样、伴奏、只听人声），标题行右边是此刻的状态。
// 不能用时说明原因：automix 开着（给一个关掉它的按钮，不替用户关）、HiFi 或外部播放器在放、GPU 分不了。
// 开关与强度在 useStemMixerStore，发声在 services/stemMixer。

const PRESETS: StemMixerPreset[] = ['reset', 'karaoke', 'vocals'];
const FADER_STEP = 0.05;

// 预设按钮的样子同 ModCurveNotice 的动作按钮；选中的那组同 PresetChips 选中的样子。
const CHIP_CLASS = 'st-t-fast h-7 whitespace-nowrap rounded-lg px-3 text-[13px] transition-[background-color,color,scale] active:scale-[0.96]';
const CHIP_IDLE = 'bg-[var(--st-fill)] text-[color:var(--st-t2)] hover:bg-[var(--st-fill2)] hover:text-[color:var(--st-t1)]';
const CHIP_CHOSEN = 'bg-[var(--st-accent)] text-[color:var(--st-on-accent)]';

const formatGain = (gain: number) => `${gain.toFixed(2)}×`;

type StemMixerSectionProps = {
    isHifiRoute: boolean;
    isExternalRoute: boolean;
};

/** 标题行右边的一句：此刻在做什么。 */
const statusHint = (status: StemMixerStatus, t: (key: string, options?: Record<string, unknown>) => string): string | undefined => {
    switch (status.phase) {
        case 'waiting': return t('ui.stemMixer.status.waiting');
        case 'separating': return t('ui.stemMixer.status.separating');
        case 'ready': return t('ui.stemMixer.status.ready');
        case 'notFollowing': return t('ui.stemMixer.status.notFollowing');
        case 'tooLong': return t('ui.stemMixer.status.tooLong');
        case 'failed': return t('ui.stemMixer.status.failed');
        case 'off':
        case 'blocked':
            return undefined;
    }
};

const StemMixerSection: React.FC<StemMixerSectionProps> = ({ isHifiRoute, isExternalRoute }) => {
    const { t } = useTranslation();
    const enabled = useStemMixerStore(state => state.stemMixerEnabled);
    const gains = useStemMixerStore(state => state.stemMixerGains);
    const status = useStemMixerStore(state => state.stemMixerStatus);
    const toggle = useStemMixerStore(state => state.handleToggleStemMixer);
    const setGain = useStemMixerStore(state => state.handleSetStemMixerGain);
    const commitGains = useStemMixerStore(state => state.handleCommitStemMixerGains);
    const applyPreset = useStemMixerStore(state => state.handleApplyStemMixerPreset);
    const automixEnabled = useAutomixSettingsStore(state => state.automixEnabled);
    const toggleAutomix = useAutomixSettingsStore(state => state.handleToggleAutomix);

    // 每次按此刻的设置判断（不用播放端报的，它晚一拍）；关着时也先说清楚开了会怎样。
    const block: StemMixerBlock | null = stemMixerBlock({ automix: automixEnabled, hifi: isHifiRoute, external: isExternalRoute });
    // GPU 分不了：开关也够不着（命令面板按同一个判断不出现）。
    const deviceBlocked = block === 'noGpu' || block === 'tooSlow';
    const live = enabled && block === null;
    const chosen = PRESETS.find(preset => STEM_MIXER_PRESETS[preset].every((gain, index) => gain === gains[index])) ?? null;

    // 关着时变淡、仍够得着：先调好再开。
    const controls = (
        <div className={`st-t-move transition-opacity${live ? '' : ' opacity-40'}`}>
            <div className="grid grid-cols-4 gap-2 px-4 pt-3">
                {STEM_MIXER_STEMS.map((stem, index) => {
                    const gain = gains[index];
                    const name = t(`ui.stemMixer.stem.${stem}`);
                    return (
                        <div key={stem} className="flex min-h-[168px] flex-col items-center gap-1.5 font-mono text-[11px] leading-4">
                            <span aria-hidden className={gain === 1 ? 'text-[color:var(--st-t3)]' : 'text-[color:var(--st-t1)]'}>{formatGain(gain)}</span>
                            <Fader
                                value={gain}
                                min={STEM_MIXER_GAIN_MIN}
                                max={STEM_MIXER_GAIN_MAX}
                                step={FADER_STEP}
                                label={name}
                                valueText={formatGain(gain)}
                                onPreview={value => setGain(stem, value)}
                                onCommit={commitGains}
                            />
                            <span aria-hidden className="font-sans text-xs text-[color:var(--st-t2)]">{name}</span>
                        </div>
                    );
                })}
            </div>
            <div className="flex flex-wrap gap-1.5 px-4 pb-3.5 pt-3">
                {PRESETS.map(preset => (
                    <button
                        key={preset}
                        type="button"
                        aria-pressed={chosen === preset}
                        className={`${CHIP_CLASS} ${chosen === preset ? CHIP_CHOSEN : CHIP_IDLE}`}
                        onClick={() => applyPreset(preset)}
                    >
                        {t(`ui.stemMixer.preset.${preset}`)}
                    </button>
                ))}
            </div>
        </div>
    );

    return (
        <EqualizerSection title={t('ui.stemMixer.title')} hint={live ? statusHint(status, t) : undefined}>
            <div className="flex items-start gap-3 px-4 pt-3">
                <div className="min-w-0 flex-1">
                    <p className="text-[13px] leading-5">{t('ui.stemMixer.hint')}</p>
                    <p className="mt-0.5 text-xs leading-[18px] text-[color:var(--st-t2)]">
                        {block ? t(`ui.stemMixer.block.${block}`) : t('ui.stemMixer.status.off')}
                    </p>
                    {block === 'automix' && enabled && (
                        <button type="button" className={`mt-2 ${CHIP_CLASS} ${CHIP_IDLE}`} onClick={() => toggleAutomix(false)}>
                            {t('ui.stemMixer.block.automixAction')}
                        </button>
                    )}
                </div>
                <label className="flex shrink-0 cursor-pointer items-center pt-0.5">
                    <span className="sr-only">{t('ui.stemMixer.toggle')}</span>
                    <Toggle checked={enabled && !deviceBlocked} onChange={toggle} disabled={deviceBlocked} />
                </label>
            </div>
            {/* GPU 分不了时不画推子，只留原因。 */}
            {deviceBlocked ? <div className="pb-3.5" /> : controls}
        </EqualizerSection>
    );
};

export default StemMixerSection;
