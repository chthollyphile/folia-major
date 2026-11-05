import { describe, expect, it } from 'vitest';
import i18n from '../../../src/i18n/config';
import { DEFAULT_PERSONAL_FM_CATALOG, getPersonalFmOpenPickerLabel, getPersonalFmPickerTitle, getPersonalFmStatusText } from '../../../src/services/onlineMusic/fmModes';
import { fmModeCommand } from '../../../src/components/command-palette/commands/fmModeCommand';
import { stationModeCommand } from '../../../src/components/command-palette/commands/stationModeCommand';
import type { CommandPaletteContext } from '../../../src/components/command-palette/types';

// test/unit/command-palette/fmPickerTitle.test.ts
// The FM picker's title, its command's chip and the FM tab's hint say the same thing: the radio on air by its own
// name, the Personal FM otherwise. One of the two mode commands at a time: the radio's while FM plays one.

const stationCatalog = { ...DEFAULT_PERSONAL_FM_CATALOG, name: { labelKey: '', labelFallback: 'Fixture Radio' } };
const contextWith = (personalFmCatalog?: typeof stationCatalog) => ({
    playback: { personalFmCatalog },
}) as unknown as CommandPaletteContext;
const availability = (isPersonalFmModeSupported: boolean, personalFmStation: string | null) => {
    const context = { playback: { isPersonalFmModeSupported, personalFmStation } } as unknown as CommandPaletteContext;
    return [fmModeCommand.isAvailable?.(context), stationModeCommand.isAvailable?.(context)];
};

describe('FM picker title', () => {
    it('names the radio on air when its catalogue names it, and the Personal FM otherwise', () => {
        expect(getPersonalFmPickerTitle(stationCatalog)).toBe(i18n.t('commandPalette.fmModeTitleOf', { name: 'Fixture Radio' }));
        expect(getPersonalFmPickerTitle(stationCatalog)).toContain('Fixture Radio');
        expect(getPersonalFmPickerTitle(DEFAULT_PERSONAL_FM_CATALOG)).toBe(i18n.t('commandPalette.fmModeTitle'));
        expect(getPersonalFmPickerTitle(undefined)).toBe(i18n.t('commandPalette.fmModeTitle'));
    });

    it('gives the command chip the same words as the picker', () => {
        expect(fmModeCommand.activeTitle?.(contextWith(stationCatalog))).toBe(getPersonalFmPickerTitle(stationCatalog));
        expect(fmModeCommand.activeTitle?.(contextWith())).toBe(getPersonalFmPickerTitle());
    });

    it('gives the radio command the same chip as the picker', () => {
        expect(stationModeCommand.activeTitle?.(contextWith(stationCatalog))).toBe(getPersonalFmPickerTitle(stationCatalog));
        expect(stationModeCommand.surface).toBe(fmModeCommand.surface);
    });

    it('offers the Personal FM mode command without a radio on air, the radio mode command with one, never both', () => {
        expect(availability(true, null)).toEqual([true, false]);
        expect(availability(true, 'radio')).toEqual([false, true]);
        // A Personal FM without modes offers neither, and so does a radio without a catalogue.
        expect(availability(false, null)).toEqual([false, false]);
        expect(availability(false, 'radio')).toEqual([false, false]);
        expect(fmModeCommand.isAvailable?.(undefined)).toBe(false);
        expect(stationModeCommand.isAvailable?.(undefined)).toBe(false);
    });

    it('names the radio on air in the FM tab hint, the Personal FM otherwise', () => {
        expect(getPersonalFmOpenPickerLabel(stationCatalog)).toBe(i18n.t('personalFmMode.openPickerOf', { name: 'Fixture Radio' }));
        expect(getPersonalFmOpenPickerLabel(stationCatalog)).toContain('Fixture Radio');
        expect(getPersonalFmOpenPickerLabel()).toBe(i18n.t('personalFmMode.openPicker'));
        expect(getPersonalFmOpenPickerLabel(DEFAULT_PERSONAL_FM_CATALOG)).toBe(i18n.t('personalFmMode.openPicker'));
    });

    it('names the radio on air in the status lines of a mode switch, the Personal FM otherwise', () => {
        expect(getPersonalFmStatusText('applied', stationCatalog)).toBe(i18n.t('personalFmMode.statusAppliedOf', { name: 'Fixture Radio' }));
        expect(getPersonalFmStatusText('empty', stationCatalog)).toBe(i18n.t('personalFmMode.statusEmptyOf', { name: 'Fixture Radio' }));
        expect(getPersonalFmStatusText('failed', stationCatalog)).toBe(i18n.t('personalFmMode.statusFailedOf', { name: 'Fixture Radio' }));
        for (const kind of ['applied', 'empty', 'failed'] as const) {
            expect(getPersonalFmStatusText(kind, stationCatalog)).toContain('Fixture Radio');
        }
        expect(getPersonalFmStatusText('applied')).toBe(i18n.t('personalFmMode.statusApplied'));
        expect(getPersonalFmStatusText('failed', DEFAULT_PERSONAL_FM_CATALOG)).toBe(i18n.t('personalFmMode.statusFailed'));
    });
});
