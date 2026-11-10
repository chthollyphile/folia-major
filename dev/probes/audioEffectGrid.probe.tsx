import React, { useState } from 'react';
import AudioEffectGrid from '../../src/components/panelTab/equalizer/AudioEffectGrid';
import { SettingsKitThemeContext, settingsTokens } from '../../src/components/modal/settings/kit/kitTheme';
import { kitMotionTokens } from '../../src/components/modal/settings/kit/motion';
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
 * 两种主题都挂出来，是因为激活时标注用的是强调色（--st-accent），亮色和暗色下是两个值。
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
            {[false, true].map((isDaylight) => {
                const theme = isDaylight ? DAYLIGHT_THEME : DEFAULT_THEME;
                return (
                    <div
                        key={String(isDaylight)}
                        data-probe-daylight={String(isDaylight)}
                        // 效果链用设置窗口的共用变量画，文字颜色、颜色和动效变量平时由对话框外框给，探针里自己给；
                        // 宽度和对话框里那一块一样，所以也是三列。
                        className="st-window w-full max-w-[864px] rounded-2xl bg-[var(--st-win)] p-4 text-[color:var(--st-t1)]"
                        style={{
                            ['--text-primary' as string]: theme.primaryColor,
                            ...settingsTokens(isDaylight, theme),
                            ...kitMotionTokens(false),
                        }}
                    >
                        <SettingsKitThemeContext.Provider value={{ isDaylight, theme }}>
                            <AudioEffectGrid effects={effects} onEffectChange={onEffectChange} onCommit={() => {}} />
                        </SettingsKitThemeContext.Provider>
                    </div>
                );
            })}
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
