import React, { useEffect, useRef, useState } from 'react';
import { Blend, SlidersHorizontal, Volume1, Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../../types';
import { useSettingsUiStore } from '../../../stores/useSettingsUiStore';

// src/components/panelTab/controls/VolumeRow.tsx
// 单行音量：静音、滑杆、百分比、均衡器入口挤在同一行，省掉原来单独占一行的标题。

interface VolumeRowProps {
    volume: number;
    isMuted: boolean;
    onVolumePreview: (val: number) => void;
    onVolumeChange: (val: number) => void;
    onToggleMute: () => void;
    theme: Theme;
    isDaylight: boolean;
}

const VolumeRow: React.FC<VolumeRowProps> = ({
    volume,
    isMuted,
    onVolumePreview,
    onVolumeChange,
    onToggleMute,
    theme,
    isDaylight,
}) => {
    const { t } = useTranslation();
    const audioEqualizerSettings = useSettingsUiStore(state => state.audioEqualizerSettings);
    const openAudioEqualizer = useSettingsUiStore(state => state.openAudioEqualizer);
    const automixEnabled = useSettingsUiStore(state => state.automixEnabled);
    const toggleAutomix = useSettingsUiStore(state => state.handleToggleAutomix);
    const [sliderVolume, setSliderVolume] = useState(isMuted ? 0 : volume);
    const isDraggingRef = useRef(false);
    const pendingVolumeRef = useRef(sliderVolume);
    const wellBg = isDaylight ? 'bg-black/5' : 'bg-black/20';

    useEffect(() => {
        if (!isDraggingRef.current) {
            const nextVolume = isMuted ? 0 : volume;
            setSliderVolume(nextVolume);
            pendingVolumeRef.current = nextVolume;
        }
    }, [volume, isMuted]);

    const handleSliderInput = (nextVolume: number) => {
        isDraggingRef.current = true;
        pendingVolumeRef.current = nextVolume;
        setSliderVolume(nextVolume);
        onVolumePreview(nextVolume);
    };

    const commitVolumeChange = () => {
        if (!isDraggingRef.current) {
            return;
        }
        isDraggingRef.current = false;
        onVolumeChange(pendingVolumeRef.current);
    };

    return (
        <div className={`flex items-center gap-2.5 ${wellBg} px-2.5 py-2 rounded-xl`}>
            <button
                onClick={(event) => {
                    event.stopPropagation();
                    onToggleMute();
                }}
                className="shrink-0 opacity-40 transition-opacity hover:opacity-100"
                title={t('ui.volume')}
                aria-label={t('ui.volume')}
            >
                {isMuted || sliderVolume === 0 ? <VolumeX size={16} /> : sliderVolume < 0.5 ? <Volume1 size={16} /> : <Volume2 size={16} />}
            </button>

            <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={sliderVolume}
                onInput={(e) => handleSliderInput(parseFloat(e.currentTarget.value))}
                onChange={(e) => handleSliderInput(parseFloat(e.currentTarget.value))}
                onMouseUp={commitVolumeChange}
                onTouchEnd={commitVolumeChange}
                onKeyUp={commitVolumeChange}
                onBlur={commitVolumeChange}
                className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-white/10 accent-(--text-primary)"
                style={{ accentColor: theme.primaryColor }}
                aria-label={t('ui.volume')}
            />

            <span className="w-8 shrink-0 text-right text-[10px] font-bold opacity-60 tabular-nums">
                {Math.round(sliderVolume * 100)}%
            </span>

            <button
                type="button"
                onClick={openAudioEqualizer}
                className={`shrink-0 rounded-md transition-opacity hover:opacity-100 ${audioEqualizerSettings.enabled ? 'opacity-100' : 'opacity-40'}`}
                style={audioEqualizerSettings.enabled ? { color: theme.accentColor } : undefined}
                title={t('ui.openEqualizer')}
                aria-label={t('ui.openEqualizer')}
            >
                <SlidersHorizontal size={14} />
            </button>

            <button
                type="button"
                onClick={() => toggleAutomix(!automixEnabled)}
                className={`shrink-0 rounded-md transition-opacity hover:opacity-100 ${automixEnabled ? 'opacity-100' : 'opacity-40'}`}
                style={automixEnabled ? { color: theme.accentColor } : undefined}
                title={t('ui.automix')}
                aria-label={t('ui.automix')}
                aria-pressed={automixEnabled}
            >
                <Blend size={14} />
            </button>
        </div>
    );
};

export default VolumeRow;
