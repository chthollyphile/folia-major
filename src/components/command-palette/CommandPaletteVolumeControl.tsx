import React, { useEffect, useRef, useState } from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../types';

// src/components/command-palette/CommandPaletteVolumeControl.tsx
// Keeps drag previews local and commits the persisted player volume only when interaction finishes.
// On HiFi without software volume the slider is locked at what mpv puts out and says the DAC sets the level.
// The icon is a button that toggles mute, which still works on fixed-volume HiFi.

type CommandPaletteVolumeControlProps = {
    isDaylight: boolean;
    isMuted: boolean;
    /** HiFi without software volume: mpv plays at 100% and the DAC or amplifier sets the loudness. */
    isVolumeFixed?: boolean;
    query: string;
    theme: Theme;
    volume: number;
    onQueryChange: (query: string) => void;
    onVolumeChange: (volume: number) => void;
    onVolumePreview: (volume: number) => void;
    onToggleMute: () => void;
};

const parsePercent = (value: string) => {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
};

const CommandPaletteVolumeControl: React.FC<CommandPaletteVolumeControlProps> = ({
    isDaylight,
    isMuted,
    isVolumeFixed = false,
    query,
    theme,
    volume,
    onQueryChange,
    onVolumeChange,
    onVolumePreview,
    onToggleMute,
}) => {
    const { t } = useTranslation();
    const [sliderVolume, setSliderVolume] = useState(volume);
    const isDraggingRef = useRef(false);
    const pendingVolumeRef = useRef(volume);

    useEffect(() => {
        const queryPercent = parsePercent(query);
        if (queryPercent !== null) {
            const nextVolume = queryPercent / 100;
            setSliderVolume(nextVolume);
            pendingVolumeRef.current = nextVolume;
            return;
        }

        if (!isDraggingRef.current && query.trim() === '') {
            setSliderVolume(volume);
            pendingVolumeRef.current = volume;
        }
    }, [query, volume]);

    const handleSliderInput = (nextVolume: number) => {
        if (isVolumeFixed) {
            return;
        }
        isDraggingRef.current = true;
        pendingVolumeRef.current = nextVolume;
        setSliderVolume(nextVolume);
        onQueryChange(String(Math.round(nextVolume * 100)));
        if (!isMuted) {
            onVolumePreview(nextVolume);
        }
    };

    const commitVolumeChange = () => {
        if (!isDraggingRef.current) {
            return;
        }
        isDraggingRef.current = false;
        onVolumeChange(pendingVolumeRef.current);
    };

    // Fixed: what mpv puts out, 100% (0% muted), as the panel's volume row shows it.
    const shownVolume = isVolumeFixed ? (isMuted ? 0 : 1) : sliderVolume;
    const VolumeIcon = isMuted || shownVolume === 0
        ? VolumeX
        : shownVolume < 0.5 ? Volume1 : Volume2;
    const percent = Math.round(shownVolume * 100);
    const muteLabel = isMuted ? t('commandPalette.volumeUnmute') : t('commandPalette.volumeMute');
    const hint = isVolumeFixed
        ? t('hifi.player.volumeFixed')
        : isMuted ? t('commandPalette.volumeMutedHint') : t('commandPalette.volumeControlHint');

    return (
        <div className="flex h-full items-center justify-center px-4 py-10">
            <div className="w-full max-w-lg px-6 py-7">
                <div className="mb-5 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={onToggleMute}
                            className={`-m-1.5 shrink-0 rounded-full p-1.5 transition-colors ${isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/10'}`}
                            aria-label={muteLabel}
                            aria-pressed={isMuted}
                            title={muteLabel}
                        >
                            <VolumeIcon size={22} style={{ color: theme.accentColor }} />
                        </button>
                        <div>
                            <div className="text-sm font-medium">{t('commandPalette.volumeControlTitle')}</div>
                            <div className="mt-0.5 text-xs opacity-50">{hint}</div>
                        </div>
                    </div>
                    <div className={`text-2xl font-semibold tabular-nums${isVolumeFixed ? ' opacity-40' : ''}`} style={{ color: theme.primaryColor }}>
                        {percent}%
                    </div>
                </div>

                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={shownVolume}
                    disabled={isVolumeFixed}
                    onInput={(event) => handleSliderInput(Number(event.currentTarget.value))}
                    onChange={(event) => handleSliderInput(Number(event.currentTarget.value))}
                    onPointerUp={commitVolumeChange}
                    onPointerCancel={commitVolumeChange}
                    onKeyUp={commitVolumeChange}
                    onBlur={commitVolumeChange}
                    className={`h-2 w-full appearance-none rounded-full ${isVolumeFixed ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
                    style={{
                        accentColor: theme.accentColor,
                        backgroundColor: isDaylight ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.10)',
                    }}
                    aria-label={t('ui.volume')}
                />
            </div>
        </div>
    );
};

export default CommandPaletteVolumeControl;
