import { describe, expect, it } from 'vitest';
import i18n from '../../../src/i18n/config';
import { DEFAULT_PERSONAL_FM_CATALOG, getPersonalFmPickerTitle } from '../../../src/services/onlineMusic/fmModes';
import { fmModeCommand } from '../../../src/components/command-palette/commands/fmModeCommand';
import type { CommandPaletteContext } from '../../../src/components/command-palette/types';

// test/unit/command-palette/fmPickerTitle.test.ts
// The FM picker's title and its command's chip say the same thing: the radio on air by its own name, the
// Personal FM otherwise.

const stationCatalog = { ...DEFAULT_PERSONAL_FM_CATALOG, name: { labelKey: '', labelFallback: 'Fixture Radio' } };
const contextWith = (personalFmCatalog?: typeof stationCatalog) => ({
    playback: { personalFmCatalog },
}) as unknown as CommandPaletteContext;

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
});
