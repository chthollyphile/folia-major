import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../types';

// src/components/command-palette/CommandPaletteVolumeControl.tsx
// Keeps drag previews local and commits the persisted player volume only when interaction finishes.
// On HiFi without software volume the slider is locked at what mpv puts out and says the DAC sets the level.
// The icon is a button that toggles mute, which still works on fixed-volume HiFi.
// Grown out of the player bar it sits at the bottom, the slider just above the input.

type CommandPaletteVolumeControlProps = {
    isDaylight: boolean;
    /**
     * Which side of the body the palette input sits on. Grown out of the player bar (`bottom`) the
     * pointer has just clicked the bar's volume button, so the slider hugs the input there and a
     * small move lands on it; the top overlay keeps it centred.
     */
    inputEdge?: 'top' | 'bottom';
    /**
     * Where the click that opened the palette landed (viewport px), or null. The track's centre line is
     * placed exactly on it, so after clicking the bar's volume button the pointer is already on the
     * slider. Clamped into the body when the point lies outside it.
     */
    openPointer?: { x: number; y: number } | null;
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
    inputEdge = 'top',
    openPointer = null,
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
    const rootRef = useRef<HTMLDivElement | null>(null);
    const blockRef = useRef<HTMLDivElement | null>(null);
    const trackRef = useRef<HTMLInputElement | null>(null);
    const [blockTop, setBlockTop] = useState<number | null>(null);
    const pointerY = openPointer?.y ?? null;

    // Measured once the block is laid out: the capsule shell only clips (no transform), so the rects
    // are where the panel ends up from its first frame.
    useLayoutEffect(() => {
        const root = rootRef.current;
        const block = blockRef.current;
        const track = trackRef.current;
        if (pointerY === null || !root || !block || !track) {
            setBlockTop(null);
            return;
        }
        const rootRect = root.getBoundingClientRect();
        // The track's top edge goes on a whole device pixel nearest to centring it on the pointer;
        // the panel itself may sit at a fractional y, so the offset absorbs that fraction.
        const dpr = window.devicePixelRatio || 1;
        const trackTopY = Math.round((pointerY - track.offsetHeight / 2) * dpr) / dpr;
        const maxTop = Math.max(0, rootRect.height - block.offsetHeight);
        const top = trackTopY - rootRect.top - track.offsetTop;
        setBlockTop(top >= 0 && top <= maxTop ? top : Math.min(Math.max(Math.round(top), 0), maxTop));
    }, [pointerY]);

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
        <div
            ref={rootRef}
            className={`relative flex h-full justify-center px-4 ${inputEdge === 'bottom' ? 'items-end pb-1' : 'items-center py-10'}`}
        >
            <div
                ref={blockRef}
                className={`w-full max-w-lg px-6 ${inputEdge === 'bottom' ? 'pb-3 pt-7' : 'py-7'}`}
                // Pinned under the opening click; until measured (and without one) the flex layout places it.
                style={pointerY === null ? undefined : {
                    position: 'absolute',
                    left: '50%',
                    // Same width as inside the root's px-4: an absolute box sizes against the padding box.
                    width: 'calc(100% - 2rem)',
                    top: blockTop ?? 0,
                    transform: 'translateX(-50%)',
                    visibility: blockTop === null ? 'hidden' : undefined,
                }}
            >
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
                    ref={trackRef}
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
