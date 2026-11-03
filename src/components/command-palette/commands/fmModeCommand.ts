import { Radio } from 'lucide-react';
import { defineCommand } from '../commandFactories';
import { fmModeSurface } from '../surfaces/fmModeSurface';
import { getPersonalFmSelectionLabel } from '../../../services/onlineMusic/fmModes';
import type { CommandPaletteCommand } from '../types';

// src/components/command-palette/commands/fmModeCommand.ts
// A state command: the list row already shows which Personal FM mode is in effect, and opening it
// reveals the picker surface. Hidden when the active provider has no FM modes.

/** Shared with the player panel's FM tab, which opens this command's surface directly. */
export const PERSONAL_FM_MODE_COMMAND_ID = 'playback-fm-mode';

export const fmModeCommand: CommandPaletteCommand = defineCommand({
    id: PERSONAL_FM_MODE_COMMAND_ID,
    group: 'playback',
    title: 'Personal FM mode',
    description: 'Switch the Personal FM mode or scene',
    // No keyword may be a space-separated prefix of another one the user is likely to type in
    // full: the matcher would read the remainder as command input, and this command takes none.
    keywords: ['fm mode', 'fm scene', 'radio mode', '私人 fm 模式', '私人fm模式', 'fm 模式', 'fm模式', '私人电台', '电台模式', '场景电台', 'sirenfmmoshi', 'sirenfm', 'fmmoshi', 'srfmms', 'srfm', 'fmms'],
    icon: Radio,
    surface: fmModeSurface,
    requiresInput: true,
    isAvailable: context => context?.playback.isPersonalFmModeSupported ?? false,
    placeholder: context => context.shared.t('commandPalette.fmModeFilterPlaceholder', 'Type to filter modes and scenes'),
    getPreview: (_input, context) => getPersonalFmSelectionLabel(context.playback.personalFmSelection, context.shared.t, context.playback.personalFmCatalog),
    execute: () => false,
});
