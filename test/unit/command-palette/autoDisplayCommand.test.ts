import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMMAND_PALETTE_COMMANDS } from '../../../src/components/command-palette/commandRegistry';
import { refreshWallpaperDisplays } from '../../../src/components/modal/settings/pages/desktop/wallpaperDisplays';
import type { CommandPaletteContext } from '../../../src/components/command-palette/types';

// The command uses the same live display availability as the settings row.
const command = COMMAND_PALETTE_COMMANDS.find(item => item.id === 'desktop-toggle-auto-display')!;
afterEach(() => vi.unstubAllGlobals());

describe('automatic display command availability', () => {
    it('appears only when Windows offers more than one display', async () => {
        const displays = [{ id: 1 }];
        vi.stubGlobal('window', { electron: { platform: 'win32', getWallpaperDisplays: async () => ({ displays }) } });
        refreshWallpaperDisplays(); await Promise.resolve();
        expect(command.isAvailable?.({} as CommandPaletteContext)).toBe(false);
        displays.push({ id: 2 });
        refreshWallpaperDisplays(); await Promise.resolve();
        expect(command.isAvailable?.({} as CommandPaletteContext)).toBe(true);
    });
});
