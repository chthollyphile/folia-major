import type { CommandPaletteSurface } from './types';
import type { CommandPaletteContext } from '../types';
import { useHifiSettingsStore } from '../../../stores/useHifiSettingsStore';

// src/components/command-palette/surfaces/volumeSurface.ts
// Declares the volume command's inline slider: a numeric input plus a panel body that previews
// while dragging and commits on release; its icon toggles mute.

/**
 * On HiFi without software volume mpv plays at 100% and the DAC or amplifier sets the loudness, so the
 * palette's volume commands and this slider leave the stored volume alone and say why. Mute still works:
 * it reaches mpv on its own. Read at each call: the route changes with each song.
 */
export const isHifiVolumeFixed = (context: CommandPaletteContext) => (
    context.playback.isHifiRoute() && !useHifiSettingsStore.getState().softwareVolume
);

export const hifiVolumeFixedText = (context: CommandPaletteContext) => (
    context.shared.t('hifi.player.volumeFixed', 'Volume is controlled by your DAC or amplifier')
);

/** Says, in place of a volume change, that the volume is not Folia's to change while HiFi plays. */
export const tellHifiVolumeFixed = (context: CommandPaletteContext) => {
    context.shared.setStatusMsg({ type: 'info', text: hifiVolumeFixedText(context) });
};

export const volumeSurface: CommandPaletteSurface = {
    load: () => import('./VolumeSurfaceView'),
    // The slider mirrors the raw input character by character, so it cannot wait for the
    // match debounce.
    useLiveQuery: true,
    inputProps: () => ({ type: 'number', inputMode: 'decimal', min: 0, max: 100, step: 1 }),
    mapProps: ({ context, query, isDaylight, theme, setQuery }) => ({
        isDaylight,
        isMuted: context.playback.isMuted,
        isVolumeFixed: isHifiVolumeFixed(context),
        query,
        theme,
        volume: context.playback.volume,
        onQueryChange: setQuery,
        onVolumeChange: (volume: number) => {
            if (isHifiVolumeFixed(context)) {
                tellHifiVolumeFixed(context);
                return;
            }
            context.playback.setVolume(volume);
        },
        onVolumePreview: (volume: number) => {
            if (!isHifiVolumeFixed(context)) context.playback.previewVolume(volume);
        },
        // Mute reaches mpv on its own, so the icon toggles it on fixed-volume HiFi too.
        onToggleMute: () => context.playback.toggleMute(),
    }),
};
