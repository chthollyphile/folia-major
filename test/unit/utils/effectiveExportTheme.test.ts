import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/utils/effectiveExportTheme.test.ts
// Locks readEffectiveExportTheme (the theme the OBS copy link bakes). It follows the last-applied
// pointer, not whatever happens to be saved: AI active -> the cached AI theme, custom active -> the
// saved custom theme, default preset -> null. That last case matters — a user who once saved a
// custom theme and then went back to the preset must not get the stale custom theme baked in.

vi.mock('@/services/themePreferences', () => ({ readStoredLastAppliedThemePointer: vi.fn() }));
vi.mock('@/services/themeCache', () => ({ getLastDualTheme: vi.fn() }));
vi.mock('@/utils/appearanceCodec', () => ({
    readSavedCustomTheme: vi.fn(),
    compressConfig: vi.fn(() => 'folia-theme://x'),
}));

import { readEffectiveExportTheme } from '@/services/obs/currentObsUrl';
import { readStoredLastAppliedThemePointer } from '@/services/themePreferences';
import { getLastDualTheme } from '@/services/themeCache';
import { readSavedCustomTheme } from '@/utils/appearanceCodec';

const pointerMock = vi.mocked(readStoredLastAppliedThemePointer);
const aiMock = vi.mocked(getLastDualTheme);
const customMock = vi.mocked(readSavedCustomTheme);

const AI = { light: { name: 'ai-l' }, dark: { name: 'ai-d' } } as never;
const CUSTOM = { light: { name: 'custom-l' }, dark: { name: 'custom-d' } } as never;

describe('readEffectiveExportTheme', () => {
    beforeEach(() => {
        pointerMock.mockReset();
        aiMock.mockReset().mockResolvedValue(AI);
        customMock.mockReset().mockReturnValue(CUSTOM);
    });

    it('bakes the cached AI theme when AI is active', async () => {
        pointerMock.mockReturnValue('ai');
        expect(await readEffectiveExportTheme()).toBe(AI);
        expect(customMock).not.toHaveBeenCalled();
    });

    it('bakes the saved custom theme when custom is active', async () => {
        pointerMock.mockReturnValue('custom');
        expect(await readEffectiveExportTheme()).toBe(CUSTOM);
        expect(aiMock).not.toHaveBeenCalled();
    });

    it('returns null on the default preset, ignoring a leftover saved custom theme', async () => {
        pointerMock.mockReturnValue('default');
        expect(await readEffectiveExportTheme()).toBeNull();
        expect(customMock).not.toHaveBeenCalled();
        expect(aiMock).not.toHaveBeenCalled();
    });

    it('returns null when AI is active but no AI theme is cached (avoids a stale bake)', async () => {
        pointerMock.mockReturnValue('ai');
        aiMock.mockResolvedValue(null);
        expect(await readEffectiveExportTheme()).toBeNull();
    });

    it('returns null when custom is active but nothing was saved', async () => {
        pointerMock.mockReturnValue('custom');
        customMock.mockReturnValue(undefined);
        expect(await readEffectiveExportTheme()).toBeNull();
    });
});
