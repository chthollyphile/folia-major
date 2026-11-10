import { Radio } from 'lucide-react';
import { defineCommand } from '../commandFactories';
import { fmModeSurface } from '../surfaces/fmModeSurface';
import { getPersonalFmPickerTitle, getPersonalFmSelectionLabel } from '../../../services/onlineMusic/fmModes';
import type { CommandPaletteCommand } from '../types';

// src/components/command-palette/commands/stationModeCommand.ts
// The FM mode picker for an extra radio a provider offers, while FM plays one: the same surface as the
// Personal FM mode command, which stands down meanwhile, so only one of the two is ever offered. Its chip
// and the picker's title name the radio on air.

/** Shared with the player panel's FM tab, which opens this command's surface directly. */
export const STATION_MODE_COMMAND_ID = 'playback-station-mode';

export const stationModeCommand: CommandPaletteCommand = defineCommand({
    id: STATION_MODE_COMMAND_ID,
    group: 'playback',
    title: 'Radio mode',
    description: 'Switch the mode or scene of the radio on air',
    // Same rule as the Personal FM mode command: no keyword is a space-separated prefix of another.
    keywords: ['station mode', 'radio scene', '电台场景', '切换电台模式', 'diantai'],
    icon: Radio,
    surface: fmModeSurface,
    requiresInput: true,
    isAvailable: context => Boolean(context?.playback.isPersonalFmModeSupported && context.playback.personalFmStation),
    placeholder: context => context.shared.t('commandPalette.fmModeFilterPlaceholder', 'Type to filter modes and scenes'),
    activeTitle: context => getPersonalFmPickerTitle(context.playback.personalFmCatalog),
    getPreview: (_input, context) => getPersonalFmSelectionLabel(context.playback.personalFmSelection, context.shared.t, context.playback.personalFmCatalog),
    execute: () => false,
});
