import { describe, expect, it, vi } from 'vitest';
import { subtitleSettingsSurface } from '@/components/command-palette/surfaces/subtitleSettingsSurface';
import type { CommandPaletteContext } from '@/components/command-palette/types';
import type { CommandSurfaceRenderArgs } from '@/components/command-palette/surfaces/types';

// test/unit/command-palette/subtitleSettingsSurface.test.ts
// The subtitle panel's 「更多选项」 link closes the palette and opens the lyric style window on its
// subtitle tab, where the settings the panel leaves out live.

describe('the subtitle settings surface', () => {
    it('its more-options link closes the palette, then opens the subtitle tab of the lyric style window', () => {
        const calls: string[] = [];
        const openSettings = vi.fn(() => calls.push('open'));
        const close = vi.fn(() => calls.push('close'));
        const context = { settings: { openSettings } } as unknown as CommandPaletteContext;
        const props = subtitleSettingsSurface.mapProps!({
            context, close, isDaylight: false, theme: {} as never,
        } as unknown as CommandSurfaceRenderArgs) as { onOpenMoreSettings: () => void };

        props.onOpenMoreSettings();

        expect(openSettings).toHaveBeenCalledWith('options', 'visualizer', 'subtitle');
        expect(calls).toEqual(['close', 'open']);
    });
});
