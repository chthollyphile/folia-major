import React, { useState } from 'react';
import AudioEffectGrid from '../../src/components/panelTab/equalizer/AudioEffectGrid';
import { buildEqualizerStyles } from '../../src/components/panelTab/equalizer/equalizerStyles';
import { createNeutralAudioEffects, type AudioEffectId } from '../../src/utils/audioEffects';
import { AUDIO_SOUND_PRESETS } from '../../src/utils/audioPresets';
import { DEFAULT_THEME, DAYLIGHT_THEME } from '../../src/services/baseThemes';
import type { ProbeDefinition } from './definition';
// dev/probes/audioEffectGrid.probe.tsx

/**
 * 效果链滑块，主要用来看「噪声」标注。
 *
 * 九个滑块里只有两个会自己发出声音——黑胶噪声和比特降质。这两个被当成故障报过：
 * 在安静的前奏上，它们听起来就是「这版本坏了」，而不是「我开了个效果器」。标注要
 * 在滑块还没推上去的时候就看得见，所以中性和激活两种状态都得检查。
 *
 * 两种主题都挂出来，是因为标注用的是 selectedAccentColor，白天配色下它是另一个值。
 */
const PRESETS = ['flat', 'lofi', 'radio', 'vocal'] as const;

const AudioEffectGridProbe: React.FC = () => {
    const [effects, setEffects] = useState(() => createNeutralAudioEffects());
    const onEffectChange = (id: AudioEffectId, value: number) => setEffects(prev => ({ ...prev, [id]: value }));

    return (
        <div className="flex flex-col gap-6 p-8">
            <div className="flex flex-wrap gap-2">
                {PRESETS.map(name => (
                    <button
                        key={name}
                        type="button"
                        data-probe-preset={name}
                        className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/10"
                        onClick={() => setEffects({ ...AUDIO_SOUND_PRESETS[name].effects })}
                    >
                        {name}
                    </button>
                ))}
            </div>
            {[false, true].map(isDaylight => (
                <div
                    key={String(isDaylight)}
                    data-probe-daylight={String(isDaylight)}
                    className={isDaylight ? 'rounded-2xl bg-zinc-200 p-4' : 'rounded-2xl bg-zinc-900 p-4'}
                >
                    <AudioEffectGrid
                        effects={effects}
                        styles={buildEqualizerStyles(isDaylight, isDaylight ? DAYLIGHT_THEME : DEFAULT_THEME)}
                        onEffectChange={onEffectChange}
                        onCommit={() => {}}
                    />
                </div>
            ))}
        </div>
    );
};

const probe: ProbeDefinition = {
    id: 'audioEffectGrid',
    title: '效果链滑块 / 噪声标注',
    description: '看两个会自己发声的滑块（黑胶噪声、比特降质）有没有带上「噪声」标注，中性与激活两态、两种主题。',
    Component: AudioEffectGridProbe,
};

export default probe;
