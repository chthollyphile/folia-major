// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stores read localStorage at import time; see audioSettingsSetters.test.ts.
vi.hoisted(() => {
    const items = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => items.get(key) ?? null,
            setItem: (key: string, value: string) => { items.set(key, String(value)); },
            removeItem: (key: string) => { items.delete(key); },
            clear: () => items.clear(),
            key: (index: number) => Array.from(items.keys())[index] ?? null,
            get length() { return items.size; },
        },
    });
});
vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: vi.fn() },
    useTranslation: () => ({ t: (key: string) => key }),
}));

// Through the registry: commands/playbackCommands.ts imported first runs into the registry's own import of it.
import { COMMAND_PALETTE_COMMANDS } from '@/components/command-palette/commandRegistry';
import { volumeSurface } from '@/components/command-palette/surfaces/volumeSurface';
import CommandPaletteVolumeControl from '@/components/command-palette/CommandPaletteVolumeControl';
import type { CommandPaletteContext } from '@/components/command-palette/types';
import type { CommandSurfaceRenderArgs } from '@/components/command-palette/surfaces/types';
import { useHifiSettingsStore } from '@/stores/useHifiSettingsStore';

// test/unit/command-palette/hifiFixedVolume.test.ts
// On HiFi without software volume mpv plays at 100% and the DAC or amplifier sets the loudness. The
// palette's volume up, volume down and set-volume commands, and the volume surface's slider, then
// leave the stored volume alone and say so in a status message, instead of changing a number nobody
// hears. With software volume on, or on the Web engine, they change it as before. Mute keeps working.

const FIXED = { type: 'info', text: 'hifi.player.volumeFixed' };

const contextFor = ({ route = true }: { route?: boolean } = {}) => {
    const playback = {
        volume: 0.5,
        isMuted: false,
        isHifiRoute: () => route,
        setVolume: vi.fn(),
        stepVolume: vi.fn(),
        previewVolume: vi.fn(),
        toggleMute: vi.fn(),
    };
    const shared = { t: (key: string) => key, setStatusMsg: vi.fn() };
    return { playback, shared, context: { playback, shared } as unknown as CommandPaletteContext };
};
const commandById = (id: string) => {
    const command = COMMAND_PALETTE_COMMANDS.find(entry => entry.id === id);
    if (!command) throw new Error(`no command ${id}`);
    return command;
};
const volumeCommand = commandById('playback-volume');
const surfaceProps = (context: CommandPaletteContext) => volumeSurface.mapProps!({
    context, query: '', isDaylight: false, theme: {} as never, setQuery: vi.fn(),
} as unknown as CommandSurfaceRenderArgs) as {
    isVolumeFixed: boolean;
    onVolumeChange: (volume: number) => void;
    onVolumePreview: (volume: number) => void;
    onToggleMute: () => void;
};

beforeEach(() => {
    useHifiSettingsStore.setState({ softwareVolume: false });
});

describe('volume up and down', () => {
    it.each([['playback-volume-up'], ['playback-volume-down']])('%s on fixed-volume HiFi says the DAC sets the level and changes nothing', async (id) => {
        const { playback, shared, context } = contextFor();
        await commandById(id).execute('', context);
        expect(playback.stepVolume).not.toHaveBeenCalled();
        expect(shared.setStatusMsg).toHaveBeenCalledWith(FIXED);
    });

    it('step as before with software volume on, and on the Web engine', async () => {
        useHifiSettingsStore.setState({ softwareVolume: true });
        const withSoftwareVolume = contextFor();
        await commandById('playback-volume-up').execute('', withSoftwareVolume.context);
        expect(withSoftwareVolume.playback.stepVolume).toHaveBeenCalledWith(0.05);

        useHifiSettingsStore.setState({ softwareVolume: false });
        const onWeb = contextFor({ route: false });
        await commandById('playback-volume-down').execute('', onWeb.context);
        expect(onWeb.playback.stepVolume).toHaveBeenCalledWith(-0.05);
        expect(onWeb.shared.setStatusMsg).not.toHaveBeenCalled();
    });

    it('mute still works on fixed-volume HiFi', async () => {
        const { playback, shared, context } = contextFor();
        await commandById('playback-mute').execute('', context);
        expect(playback.toggleMute).toHaveBeenCalledOnce();
        expect(shared.setStatusMsg).not.toHaveBeenCalled();
    });
});

describe('set volume', () => {
    it('on fixed-volume HiFi: the preview says why, and running it says so and keeps the volume', async () => {
        const { playback, shared, context } = contextFor();
        expect(volumeCommand.getPreview?.('40', context)).toBe('hifi.player.volumeFixed');
        expect(await volumeCommand.execute('40', context)).toBe(true);
        expect(playback.setVolume).not.toHaveBeenCalled();
        expect(shared.setStatusMsg).toHaveBeenCalledWith(FIXED);
    });

    it('sets it as before on the Web engine', async () => {
        const { playback, context } = contextFor({ route: false });
        expect(volumeCommand.getPreview?.('40', context)).toBe('commandPalette.volumeSetPreview');
        expect(await volumeCommand.execute('40', context)).toBe(true);
        expect(playback.setVolume).toHaveBeenCalledWith(0.4);
    });
});

describe('the volume surface', () => {
    it('on fixed-volume HiFi: marks the slider fixed, previews nothing, and a commit says so instead of saving', () => {
        const { playback, shared, context } = contextFor();
        const props = surfaceProps(context);
        expect(props.isVolumeFixed).toBe(true);
        props.onVolumePreview(0.3);
        props.onVolumeChange(0.3);
        expect(playback.previewVolume).not.toHaveBeenCalled();
        expect(playback.setVolume).not.toHaveBeenCalled();
        expect(shared.setStatusMsg).toHaveBeenCalledWith(FIXED);
    });

    it('previews and saves as before with software volume on', () => {
        useHifiSettingsStore.setState({ softwareVolume: true });
        const { playback, context } = contextFor();
        const props = surfaceProps(context);
        expect(props.isVolumeFixed).toBe(false);
        props.onVolumePreview(0.3);
        props.onVolumeChange(0.3);
        expect(playback.previewVolume).toHaveBeenCalledWith(0.3);
        expect(playback.setVolume).toHaveBeenCalledWith(0.3);
    });

    it('its icon toggles mute, on fixed-volume HiFi too', () => {
        const { playback, shared, context } = contextFor();
        surfaceProps(context).onToggleMute();
        expect(playback.toggleMute).toHaveBeenCalledOnce();
        expect(shared.setStatusMsg).not.toHaveBeenCalled();
    });
});

describe('the volume control the surface draws', () => {
    let root: Root | null = null;
    let host: HTMLDivElement;
    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        host = document.createElement('div');
        root = createRoot(host);
    });
    afterEach(() => {
        act(() => root?.unmount());
        root = null;
    });
    // The query starts as the volume in percent, as the command's initial input gives it.
    const render = (isVolumeFixed: boolean, isMuted = false, onToggleMute = vi.fn()) => {
        act(() => root!.render(React.createElement(CommandPaletteVolumeControl, {
            isDaylight: false, isMuted, isVolumeFixed, query: '30', theme: { accentColor: '#fff', primaryColor: '#fff' } as never,
            volume: 0.3, onQueryChange: vi.fn(), onVolumeChange: vi.fn(), onVolumePreview: vi.fn(), onToggleMute,
        })));
        return host.querySelector('input[type="range"]') as HTMLInputElement;
    };

    it('locks the slider at what mpv puts out and says the DAC sets the level', () => {
        const slider = render(true);
        expect(slider.disabled).toBe(true);
        expect(slider.value).toBe('1');
        expect(host.textContent).toContain('hifi.player.volumeFixed');
        expect(host.textContent).toContain('100%');
        expect(host.textContent).not.toContain('commandPalette.volumeControlHint');

        render(true, true);
        expect(host.textContent).toContain('0%');
    });

    it('is the normal slider otherwise', () => {
        const slider = render(false);
        expect(slider.disabled).toBe(false);
        expect(host.textContent).toContain('commandPalette.volumeControlHint');
        expect(host.textContent).toContain('30%');
    });

    it('toggles mute when the icon is clicked, and names what a click will do', () => {
        const onToggleMute = vi.fn();
        render(true, false, onToggleMute);
        const icon = host.querySelector('button[aria-pressed]') as HTMLButtonElement;
        expect(icon.getAttribute('aria-label')).toBe('commandPalette.volumeMute');
        act(() => icon.click());
        expect(onToggleMute).toHaveBeenCalledOnce();

        render(false, true, onToggleMute);
        expect(icon.getAttribute('aria-label')).toBe('commandPalette.volumeUnmute');
        expect(icon.getAttribute('aria-pressed')).toBe('true');
    });
});
