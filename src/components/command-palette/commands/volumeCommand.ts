import { Volume2 } from 'lucide-react';
import { defineCommand } from '../commandFactories';
import { hifiVolumeFixedText, isHifiVolumeFixed, tellHifiVolumeFixed, volumeSurface } from '../surfaces/volumeSurface';
import type { CommandPaletteCommand } from '../types';

// src/components/command-palette/commands/volumeCommand.ts
// Volume accepts a 0-100 percentage by keyboard and, through its surface, a draggable slider.
// On HiFi without software volume it changes nothing and says that the DAC or amplifier sets the level.

const parseVolumePercent = (input: string) => {
    const trimmedInput = input.trim();
    if (!trimmedInput) {
        return null;
    }
    const value = Number(trimmedInput);
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
};

export const volumeCommand: CommandPaletteCommand = defineCommand({
    id: 'playback-volume',
    executeShortcut: 'v',
    group: 'playback',
    title: 'Volume',
    description: 'Adjust playback volume',
    keywords: ['volume slider', '音量', '音量条'],
    icon: Volume2,
    // A phone has volume keys of its own, so the row a finger opens leaves this out.
    capsuleAction: 'mouse-only',
    surface: volumeSurface,
    placeholder: context => context.shared.t('commandPalette.volumeInputPlaceholder', 'Enter a volume from 0 to 100'),
    requiresInput: true,
    getInitialInput: context => String(Math.round(context.playback.volume * 100)),
    getPreview: (input, context) => {
        if (isHifiVolumeFixed(context)) {
            return hifiVolumeFixedText(context);
        }

        if (!input.trim()) {
            return context.shared.t('commandPalette.volumeCurrent', 'Current volume: {{value}}%')
                .replace('{{value}}', String(Math.round(context.playback.volume * 100)));
        }

        const value = parseVolumePercent(input);
        if (value === null) {
            return context.shared.t('commandPalette.volumeInvalid', 'Enter a number from 0 to 100');
        }

        return context.shared.t('commandPalette.volumeSetPreview', 'Set volume to {{value}}%')
            .replace('{{value}}', String(value));
    },
    execute: (input, context) => {
        if (isHifiVolumeFixed(context)) {
            tellHifiVolumeFixed(context);
            return true;
        }

        const value = parseVolumePercent(input);
        if (value === null) {
            return false;
        }

        context.playback.setVolume(value / 100);
        return true;
    },
});
