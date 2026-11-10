import React, { useEffect, useRef, useState } from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHifiSettingsStore } from '../../../stores/useHifiSettingsStore';
import { useIsHifiRoute } from '../../hifi/useHifiSignalPath';
import { PanelIconButton } from '../shell/PanelIconButton';
import { PanelSlider } from './PanelSlider';

// src/components/panelTab/controls/VolumeRow.tsx
// 单行音量：静音、滑杆、百分比。拖动时只预听，松手才把音量记下来。

interface VolumeRowProps {
    volume: number;
    isMuted: boolean;
    onVolumePreview: (val: number) => void;
    onVolumeChange: (val: number) => void;
    onToggleMute: () => void;
}

const VolumeRow: React.FC<VolumeRowProps> = ({
    volume,
    isMuted,
    onVolumePreview,
    onVolumeChange,
    onToggleMute,
}) => {
    const { t } = useTranslation();
    const isHifiRoute = useIsHifiRoute();
    const hifiSoftwareVolume = useHifiSettingsStore(state => state.softwareVolume);
    // HiFi 没开软件音量时 mpv 固定 100% 输出，响度在 DAC / 功放上调：滑杆够不着、和读数一起变暗，显示的是实际输出的
    // 100%（静音时 0%）。静音照样能按：它单独下发给 mpv 的 mute，不碰音量。
    const isVolumeFixed = isHifiRoute && !hifiSoftwareVolume;
    const [sliderVolume, setSliderVolume] = useState(isMuted ? 0 : volume);
    const isDraggingRef = useRef(false);
    const pendingVolumeRef = useRef(sliderVolume);

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

    // 拖到一半这一页就没了（面板关掉、换了标签页）：把正在试听的音量记下来，不然下次调音量会跳回去。
    const onVolumeChangeRef = useRef(onVolumeChange);
    useEffect(() => {
        onVolumeChangeRef.current = onVolumeChange;
    }, [onVolumeChange]);
    useEffect(() => () => {
        if (isDraggingRef.current) {
            onVolumeChangeRef.current(pendingVolumeRef.current);
        }
    }, []);

    const shownVolume = isVolumeFixed ? (isMuted ? 0 : 1) : sliderVolume;
    const percent = `${Math.round(shownVolume * 100)}%`;

    return (
        <>
            <div className="flex h-10 items-center gap-2">
                <PanelIconButton
                    label={t('ui.volume')}
                    onClick={(event) => {
                        event.stopPropagation();
                        onToggleMute();
                    }}
                >
                    {isMuted || shownVolume === 0 ? <VolumeX size={17} /> : shownVolume < 0.5 ? <Volume1 size={17} /> : <Volume2 size={17} />}
                </PanelIconButton>

                <PanelSlider
                    value={shownVolume}
                    onPreview={handleSliderInput}
                    onCommit={commitVolumeChange}
                    label={t('ui.volume')}
                    valueText={percent}
                    disabled={isVolumeFixed}
                />

                <span className={`w-[38px] shrink-0 text-right text-xs tabular-nums text-[color:var(--st-t2)]${isVolumeFixed ? ' opacity-40' : ''}`}>
                    {percent}
                </span>
            </div>
            {isVolumeFixed && (
                <p className="-mt-1 px-1 pb-1 text-xs leading-4 text-[color:var(--st-t3)]">{t('hifi.player.volumeFixed')}</p>
            )}
        </>
    );
};

export default VolumeRow;
