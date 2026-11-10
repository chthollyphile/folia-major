// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stores read localStorage at import time; see foliumUiRegistries.test.ts.
const storage = vi.hoisted(() => {
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
    return items;
});

// The sheet is drawn in a layer of the app shell; here it is its title, header actions, content and note, in place, while open.
vi.mock('@/components/shared/Sheet', () => ({
    default: ({ isOpen, title, headerActions, children, footerNote }: {
        isOpen: boolean;
        title: string;
        headerActions?: React.ReactNode;
        children?: React.ReactNode;
        footerNote?: React.ReactNode;
    }) => (isOpen ? React.createElement('div', { role: 'dialog', 'aria-label': title }, headerActions, children, footerNote) : null),
}));

import i18n from '@/i18n/config';
import type { HifiEngineState, HifiMpvAudioParams, HifiSourceSpec } from '@/types/hifi';
import type { HifiLoadState } from '@/services/hifi/hifiTrackStore';
import HifiBadge, { HifiProgressRow } from '@/components/hifi/HifiBadge';
import HifiSignalPathPanel from '@/components/hifi/HifiSignalPathPanel';
import { PlaybackSignalPathButton } from '@/components/hifi/PlaybackSignalPathButton';
import { closeHifiSignalPath, openHifiSignalPath, useHifiPanelStore } from '@/components/hifi/hifiPanelStore';
import AudioEqualizerDialog from '@/components/panelTab/AudioEqualizerDialog';
import ReplayGainControl from '@/components/panelTab/ReplayGainControl';
import SoundTiles from '@/components/panelTab/controls/SoundTiles';
import VolumeRow from '@/components/panelTab/controls/VolumeRow';
import { PanelSlider } from '@/components/panelTab/controls/PanelSlider';
import { useHifiEngineStore } from '@/services/hifi/hifiEngineStore';
import { useHifiTrackStore } from '@/services/hifi/hifiTrackStore';
import { useAudioSettingsStore } from '@/stores/useAudioSettingsStore';
import { useHifiSettingsStore } from '@/stores/useHifiSettingsStore';
import { setPlaybackRoute, usePlaybackStore } from '@/stores/usePlaybackStore';
import { cleanProbe, easyEffectsProbe, fixtureProbe } from './pipewireProbeFixture';

// test/unit/hifi/hifiPlayerSurfaces.test.ts
// The player surfaces on the HiFi route, drawn in jsdom with the real stores: the badge (and the progress row
// it shares with the bar) and the sheet it opens, the controls tab tiles and volume row, the slider's
// out-of-reach state, the audio effects window and the ReplayGain row. On the web route every one of them
// looks as it did before HiFi. On Linux with PipeWire, the sheet's PipeWire step, its reason and config
// line or command and the footnote that this is only what PipeWire reports, a stream that ends at a virtual
// device, the badge losing its accent colour when a PipeWire check fails, and the probe that keeps running
// while the sheet is closed so the badge can say rate passthrough.

const params = (format: string, samplerate: number): HifiMpvAudioParams => ({ format, samplerate, channelCount: 2, channels: 'stereo' });

const spec: HifiSourceSpec = {
    origin: 'local',
    codec: 'FLAC',
    container: 'FLAC',
    bitDepth: 24,
    sampleRate: 96000,
    channels: 2,
    lossless: true,
    isDsd: false,
    dsdRate: null,
    bitrate: null,
};

const engineState = (trackKey: string): HifiEngineState => ({
    status: 'playing',
    processRunning: true,
    trackKey,
    songKey: 'local:1',
    sourceKind: 'local',
    localSourceKey: 'source-1',
    durationSec: 200,
    positionSec: 12,
    paused: false,
    loopFile: false,
    audioParams: params('s32', 96000),
    audioOutParams: params('s32', 96000),
    currentAo: 'wasapi',
    audioDevice: 'wasapi/{d10}',
    exclusive: true,
    spdif: null,
    volume: 100,
    track: { codec: 'flac', codecDesc: null, decoder: 'flac', demuxSamplerate: 96000, demuxChannelCount: 2, demuxBitrate: null, formatName: 'flac' },
    next: null,
    errorCode: null,
    circuitOpen: false,
    seq: 3,
});

/** The song mpv plays: the track store's current entry and the engine state for the same trackKey. */
const playOnHifi = (engineTrackKey = 'local:1#a', loadState: HifiLoadState = 'ready') => {
    act(() => {
        useHifiTrackStore.setState({
            current: {
                trackKey: 'local:1#a',
                songKey: 'local:1',
                origin: 'local',
                song: { id: 1, name: 'Track One', artists: [], album: { id: 1, name: 'Album' }, durationMs: 200000 } as never,
                localSourceKey: 'source-1',
                stillWanted: () => true,
            },
            loadState,
            loadError: null,
            sourceSpec: spec,
        });
        useHifiEngineStore.setState({ engine: engineState(engineTrackKey) });
        setPlaybackRoute('hifi');
    });
};

const initialAudio = useAudioSettingsStore.getState();
const initialHifiSettings = useHifiSettingsStore.getState();

describe('the HiFi player surfaces', () => {
    let root: Root;
    let place: HTMLElement;
    const draw = (element: React.ReactElement) => {
        act(() => root.render(element));
    };
    const press = (element: Element) => act(() => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const sliders = () => Array.from(place.querySelectorAll<HTMLElement>('[role="slider"]'));

    beforeEach(async () => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        await i18n.changeLanguage('en');
        storage.clear();
        useAudioSettingsStore.setState(initialAudio, true);
        useHifiSettingsStore.setState(initialHifiSettings, true);
        useHifiTrackStore.setState({ current: null, loadState: 'idle', loadError: null, sourceSpec: null });
        useHifiEngineStore.setState({ engine: null });
        setPlaybackRoute('web');
        closeHifiSignalPath();
        useHifiEngineStore.setState({ outputProbe: null });
        place = document.body.appendChild(document.createElement('div'));
        root = createRoot(place);
    });

    afterEach(() => {
        act(() => root.unmount());
        place.remove();
        setPlaybackRoute('web');
        delete (window as { electron?: unknown }).electron;
    });

    describe('the badge', () => {
        it('is not there on the web route', () => {
            draw(React.createElement(HifiBadge));
            expect(place.innerHTML).toBe('');
        });

        it('opens the signal path without the click reaching the capsule', () => {
            playOnHifi();
            const capsuleClick = vi.fn();
            draw(React.createElement('div', { onClick: capsuleClick }, React.createElement(HifiBadge)));
            const badge = place.querySelector('button')!;
            expect(badge.getAttribute('aria-haspopup')).toBe('dialog');
            // Rate from the output, bit depth from the file (mpv decodes this 24-bit FLAC as s32).
            const text = i18n.t('hifi.player.badgeWithFormat', {
                verdict: i18n.t('hifi.signal.verdictShort.bitPerfect'),
                format: `${i18n.t('hifi.signal.sampleRate', { value: '96' })} / ${i18n.t('hifi.signal.bitDepth', { bits: 24 })}`,
            });
            expect(badge.getAttribute('aria-label')).toBe(i18n.t('hifi.player.badgeAria', { badge: text }));
            expect(badge.textContent).toContain(text);
            press(badge);
            expect(useHifiPanelStore.getState().isSignalPathOpen).toBe(true);
            expect(capsuleClick).not.toHaveBeenCalled();
        });

        it('shows a note, not a warning, when the only change keeps every value, and the same in the sheet', () => {
            playOnHifi();
            const withOutput = (format: string) => act(() => {
                useHifiEngineStore.setState({ engine: { ...engineState('local:1#a'), audioOutParams: params(format, 96000) } });
            });
            // The 24-bit FLAC decoded as s32 goes out as float: every value kept, still "converted".
            withOutput('float');
            draw(React.createElement(React.Fragment, null, React.createElement(HifiBadge), React.createElement(HifiSignalPathPanel)));
            const badge = place.querySelector('button')!;
            expect(badge.textContent).toContain(i18n.t('hifi.signal.verdictShort.converted'));
            expect(badge.querySelector('svg')!.getAttribute('class')).toContain('lucide-badge-info');
            expect(badge.className).toContain('text-[color:var(--text-accent)]');
            act(() => openHifiSignalPath());
            const status = document.querySelector('[role="status"]')!;
            expect(status.textContent).toBe(i18n.t('hifi.signal.verdict.converted'));
            expect(status.closest('section')!.querySelector('svg')!.getAttribute('class')).toContain('lucide-badge-info');
            act(() => closeHifiSignalPath());

            // Narrowed to 16 bit: precision lost, the warning stays.
            withOutput('s16');
            expect(badge.querySelector('svg')!.getAttribute('class')).toContain('lucide-triangle-alert');
            expect(badge.className).toContain('text-[color:var(--text-secondary)]');
        });

        it('stays out of reach while the controls are', () => {
            playOnHifi();
            draw(React.createElement(HifiBadge, { disabled: true }));
            press(place.querySelector('button')!);
            expect(useHifiPanelStore.getState().isSignalPathOpen).toBe(false);
        });

        it('picks its length by the width of its row, not of the window, and starts as a chip', () => {
            playOnHifi();
            draw(React.createElement(HifiBadge));
            const badge = place.querySelector('button')!;
            const [chip, short, full] = Array.from(badge.querySelectorAll('span'));
            // No container query matches (or none applies) → only the chip shows: an icon and "HiFi".
            expect(badge.querySelector('svg')!.getAttribute('class')).toContain('@sm:hidden');
            expect(chip.textContent).toBe(i18n.t('hifi.player.badgeChip'));
            expect(chip.className.split(' ')).toContain('@sm:hidden');
            expect(short.className.split(' ')).toEqual(expect.arrayContaining(['hidden', '@sm:block', '@md:hidden']));
            expect(full.className.split(' ')).toEqual(expect.arrayContaining(['hidden', '@md:block']));
            // The window breakpoints would show the full line at 700 px, where the row is about 290 px wide.
            expect(badge.outerHTML).not.toMatch(/(^|[\s"])(max-)?sm:/);
            // It may shrink and cut its text rather than push the bar.
            expect(badge.className.split(' ')).toEqual(expect.arrayContaining(['min-w-0', 'overflow-hidden']));
            expect(badge.className.split(' ')).not.toContain('shrink-0');
        });

        it('keeps the progress bar at a usable width in the row it shares with the badge', () => {
            playOnHifi();
            draw(React.createElement(HifiProgressRow, { className: 'col-span-3 w-full px-2', children: React.createElement('div', { 'data-bar': '' }) }));
            const row = place.firstElementChild as HTMLElement;
            expect(row.className.split(' ')).toEqual(expect.arrayContaining(['col-span-3', 'w-full', 'px-2', '@container', 'flex']));
            const bar = place.querySelector('[data-bar]')!.parentElement!;
            // 10rem: both time labels (88 px) and at least 72 px of bar.
            expect(bar.className.split(' ')).toEqual(expect.arrayContaining(['min-w-40', 'flex-1']));
            expect(row.querySelector('button')).not.toBeNull();
        });

        it('says only HiFi for a restored track mpv has not loaded yet, even beside an engine state with its key', () => {
            playOnHifi('local:1#a', 'deferred');
            draw(React.createElement(HifiBadge));
            const badge = place.querySelector('button')!;
            expect(badge.getAttribute('aria-label')).toBe(i18n.t('hifi.player.badgeAria', { badge: i18n.t('hifi.player.badgeChip') }));
            expect(badge.querySelector('svg')).toBeNull();
        });
    });

    describe('the signal path sheet', () => {
        it('lists the five stages and switches to Web Audio when the playback route changes', () => {
            playOnHifi();
            openHifiSignalPath();
            draw(React.createElement(HifiSignalPathPanel));
            const dialog = place.querySelector('[role="dialog"]')!;
            expect(dialog.getAttribute('aria-label')).toBe(i18n.t('hifi.signal.title'));
            expect(dialog.querySelector('[role="status"]')!.textContent).toBe(i18n.t('hifi.signal.verdict.bitPerfect'));
            expect(dialog.querySelectorAll('ol > li')).toHaveLength(5);
            expect(dialog.textContent).toContain(i18n.t('hifi.signal.bypassedNote'));

            act(() => setPlaybackRoute('web'));
            expect(useHifiPanelStore.getState().isSignalPathOpen).toBe(true);
            expect(place.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(i18n.t('hifi.web.title'));
            expect(place.querySelector('[role="status"]')?.textContent).toBe(i18n.t('hifi.route.webEngine'));
            expect(place.querySelector('ol')).toBeNull();
        });

        it('opens the same sheet from the quality entry on Web Audio and updates when the source changes', () => {
            usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: 'blob:original', currentSong: null });
            draw(React.createElement(React.Fragment, null,
                React.createElement(PlaybackSignalPathButton),
                React.createElement(HifiSignalPathPanel),
            ));
            const button = () => place.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
            expect(button().textContent).toBe(i18n.t('hifi.player.signalPathTile', { verdict: i18n.t('hifi.route.webEngine') }));
            expect(place.textContent).not.toContain(i18n.t('hifi.web.transcodeLabel'));
            act(() => button().click());
            expect(place.querySelector('[role="dialog"]')).not.toBeNull();
            act(() => usePlaybackStore.setState({ audioSrc: 'folia-transcode://cache/test.wav' }));
            expect(place.querySelector('[role="dialog"]')?.textContent).toContain(i18n.t('hifi.web.transcoded'));
            expect(button().textContent).toBe(i18n.t('hifi.player.signalPathTile', { verdict: i18n.t('hifi.route.transcoded') }));
            act(() => usePlaybackStore.setState({ audioSrc: null }));
            expect(place.querySelector('[role="dialog"]')?.textContent).toContain(i18n.t('hifi.web.noSource'));
            expect(button().textContent).toBe(i18n.t('hifi.web.openSignalPath'));
        });

        it('names the native route on the quality entry', () => {
            playOnHifi();
            draw(React.createElement(PlaybackSignalPathButton));
            const button = place.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
            expect(button.textContent).toBe(i18n.t('hifi.player.signalPathTile', { verdict: i18n.t('hifi.route.nativePassthrough') }));
            expect(button.getAttribute('class')).toContain('bg-[var(--st-raise)]');
        });

        it('does not compare against the engine state of another track', () => {
            playOnHifi('local:0#old');
            openHifiSignalPath();
            draw(React.createElement(HifiSignalPathPanel));
            expect(place.querySelector('[role="status"]')!.textContent).toBe(i18n.t('hifi.signal.verdict.unknown'));
        });

        it('says a restored track is checked once it plays', () => {
            playOnHifi('local:1#a', 'deferred');
            openHifiSignalPath();
            draw(React.createElement(HifiSignalPathPanel));
            expect(place.querySelector('[role="status"]')!.textContent).toBe(i18n.t('hifi.signal.verdict.unknown'));
            expect(place.textContent).toContain(i18n.t('hifi.signal.verdictDesc.notLoaded'));
        });

        it('points Linux at a direct device when PipeWire mixes the output', () => {
            (window as { electron?: unknown }).electron = { platform: 'linux' };
            playOnHifi();
            act(() => useHifiEngineStore.setState({ engine: { ...engineState('local:1#a'), currentAo: 'pipewire', audioDevice: 'auto' } }));
            openHifiSignalPath();
            draw(React.createElement(HifiSignalPathPanel));
            expect(place.querySelector('[role="status"]')!.textContent).toBe(i18n.t('hifi.signal.verdict.sharedMixer'));
            expect(place.textContent).toContain(i18n.t('hifi.signal.verdictDesc.sharedMixerLinux'));
            expect(place.textContent).toContain(i18n.t('hifi.signal.outputShared'));
        });
    });

    describe('the PipeWire step on Linux', () => {
        /** mpv on PipeWire for the song playOnHifi set up, and a probe made for it. */
        const playOnPipewire = (probe = fixtureProbe(), probeTrackKey = 'local:1#a') => {
            (window as { electron?: unknown }).electron = { platform: 'linux' };
            playOnHifi();
            act(() => useHifiEngineStore.setState({
                engine: { ...engineState('local:1#a'), currentAo: 'pipewire', audioDevice: 'auto', exclusive: false },
                outputProbe: { probe, trackKey: probeTrackKey },
            }));
        };
        const footnote = () => i18n.t('hifi.signal.system.footnote');

        it('lists what PipeWire reports after the output, why it resampled, the config line, and the footnote', () => {
            playOnPipewire();
            openHifiSignalPath();
            draw(React.createElement(HifiSignalPathPanel));
            const dialog = place.querySelector('[role="dialog"]')!;
            expect(dialog.querySelector('[role="status"]')!.textContent).toBe(i18n.t('hifi.signal.verdict.sharedMixer'));
            expect(dialog.textContent).toContain(i18n.t('hifi.signal.verdictDesc.sharedMixerPipewire'));
            const stages = dialog.querySelectorAll('ol > li');
            expect(stages).toHaveLength(6);
            expect(stages[5].textContent).toContain(i18n.t('hifi.signal.stage.system'));
            const checks = Array.from(stages[5].querySelectorAll('[data-system-check]'));
            expect(checks.map(check => [check.getAttribute('data-system-check'), check.getAttribute('data-ok')])).toEqual([
                ['rate', 'false'], ['filters', 'false'], ['streamVolume', 'true'], ['deviceVolume', 'false'], ['otherStreams', 'true'], ['channels', 'true'],
            ]);
            const hint = stages[5].querySelector('[data-system-hint="notAllowed"]')!;
            expect(hint.textContent).toContain(i18n.t('hifi.signal.system.hintNotAllowed', { rate: i18n.t('hifi.signal.sampleRate', { value: '96' }) }));
            expect(hint.querySelector('pre')!.textContent).toBe('context.properties = { default.clock.allowed-rates = [ 44100 48000 88200 96000 176400 192000 ] }');
            expect(hint.querySelector('button')).not.toBeNull();
            expect(dialog.querySelector('[role="note"]')!.textContent).toBe(footnote());
        });

        it('does not list the PipeWire step\'s changes again under its checks', () => {
            playOnPipewire();
            openHifiSignalPath();
            draw(React.createElement(HifiSignalPathPanel));
            const system = place.querySelectorAll('[role="dialog"] ol > li')[5];
            // Only the checks list: the resample, filter and volume changes are what the checks already say.
            expect(system.querySelectorAll('ul')).toHaveLength(1);
            expect(system.querySelector('ul')!.getAttribute('aria-label')).toBe(i18n.t('hifi.signal.system.checksLabel'));
            expect(system.textContent).not.toContain(i18n.t('hifi.signal.conversion.filter', { names: 'Equalizer Sink, remap-FL-FR-to-FR-FL' }));
            expect(system.textContent).toContain(i18n.t('hifi.signal.system.filtersWarn', { names: 'Equalizer Sink, remap-FL-FR-to-FR-FL' }));
        });

        it('offers the command that undoes a forced clock rate, labelled as a command', () => {
            const probe = fixtureProbe();
            playOnPipewire({ ...probe, graph: { ...probe.graph, forceRate: 48000 } });
            openHifiSignalPath();
            draw(React.createElement(HifiSignalPathPanel));
            expect(place.querySelector('[data-system-hint="notAllowed"]')).toBeNull();
            const hint = place.querySelector('[data-system-hint="forced"]')!;
            const pre = hint.querySelector('pre')!;
            expect(pre.textContent).toBe('pw-metadata -n settings 0 clock.force-rate 0');
            expect(pre.getAttribute('aria-label')).toBe(i18n.t('hifi.signal.system.commandLabel'));
            expect(hint.querySelector('button')).not.toBeNull();
        });

        it('says a stream into a virtual device ends there: no device rate, no reasons, the footnote, a muted badge', () => {
            playOnPipewire(easyEffectsProbe(96000));
            openHifiSignalPath();
            draw(React.createElement(React.Fragment, null, React.createElement(HifiSignalPathPanel), React.createElement(HifiBadge)));
            const dialog = place.querySelector('[role="dialog"]')!;
            expect(dialog.querySelector('[role="status"]')!.textContent).toBe(i18n.t('hifi.signal.verdict.sharedMixer'));
            expect(dialog.textContent).toContain(i18n.t('hifi.signal.verdictDesc.sharedMixerVirtual'));
            expect(dialog.textContent).not.toContain(i18n.t('hifi.signal.verdictDesc.sharedMixerPipewire'));
            const system = dialog.querySelectorAll('ol > li')[5];
            expect(Array.from(system.querySelectorAll('[data-system-check]')).map(check => [check.getAttribute('data-system-check'), check.getAttribute('data-ok')])).toEqual([
                ['rate', 'false'], ['filters', 'false'], ['streamVolume', 'true'],
            ]);
            expect(system.textContent).toContain(i18n.t('hifi.signal.system.rateVirtual', { name: 'Easy Effects Sink' }));
            expect(dialog.querySelector('[data-system-hint]')).toBeNull();
            expect(dialog.querySelector('[role="note"]')!.textContent).toBe(footnote());
            const badge = Array.from(place.querySelectorAll('button')).find(button => button.getAttribute('aria-haspopup') === 'dialog')!;
            expect(badge.getAttribute('aria-label')).toContain(i18n.t('hifi.signal.verdictShort.sharedMixer'));
            expect(badge.className).not.toContain('var(--text-accent)');
        });

        it('says rate passthrough, never bit-perfect, and still adds the footnote', () => {
            playOnPipewire(cleanProbe(96000));
            openHifiSignalPath();
            draw(React.createElement(HifiSignalPathPanel));
            expect(place.querySelector('[role="status"]')!.textContent).toBe(i18n.t('hifi.signal.verdict.ratePassthrough'));
            expect(place.textContent).not.toContain(i18n.t('hifi.signal.verdict.bitPerfect'));
            expect(place.querySelector('[data-system-hint]')).toBeNull();
            expect(place.querySelector('[role="note"]')!.textContent).toBe(footnote());
        });

        it('gives rate passthrough its own label and icon on the badge, in the accent colour', () => {
            playOnPipewire(cleanProbe(96000));
            draw(React.createElement(HifiBadge));
            const badge = place.querySelector('button')!;
            expect(badge.getAttribute('aria-label')).toContain(i18n.t('hifi.signal.verdictShort.ratePassthrough'));
            expect(badge.className).toContain('var(--text-accent)');
            const icon = badge.querySelector('svg')!.getAttribute('class');

            act(() => useHifiEngineStore.setState({ outputProbe: null, engine: engineState('local:1#a') }));
            const bitPerfectIcon = place.querySelector('button svg')!.getAttribute('class');
            expect(place.querySelector('button')!.getAttribute('aria-label')).toContain(i18n.t('hifi.signal.verdictShort.bitPerfect'));
            expect(icon).not.toBe(bitPerfectIcon);
        });

        it('draws rate passthrough in the secondary colour on the badge while a PipeWire check fails', () => {
            playOnPipewire(cleanProbe(96000, { otherStreams: [{ nodeId: 140, name: 'Firefox', own: false }] }));
            draw(React.createElement(HifiBadge));
            const badge = place.querySelector('button')!;
            expect(badge.getAttribute('aria-label')).toContain(i18n.t('hifi.signal.verdictShort.ratePassthrough'));
            expect(badge.className).toContain('var(--text-secondary)');
            expect(badge.className).not.toContain('var(--text-accent)');

            act(() => useHifiEngineStore.setState({ outputProbe: { probe: fixtureProbe({ streamRate: 96000, deviceRate: 96000, allowedRates: [96000] }), trackKey: 'local:1#a' } }));
            // Filters and soft volume on the way: the rate passes, the colour stays secondary.
            expect(place.querySelector('button')!.getAttribute('aria-label')).toContain(i18n.t('hifi.signal.verdictShort.ratePassthrough'));
            expect(place.querySelector('button')!.className).toContain('var(--text-secondary)');
        });

        it('does not light the signal path tile for rate passthrough while a PipeWire check fails, like the badge', () => {
            playOnPipewire(cleanProbe(96000, { otherStreams: [{ nodeId: 140, name: 'Firefox', own: false }] }));
            draw(React.createElement(SoundTiles, { loopMode: 'off', onToggleLoop: vi.fn(), loopToggleDisabled: false }));
            const tile = place.querySelectorAll('button')[1];
            expect(tile.textContent).toContain(i18n.t('hifi.signal.verdictShort.ratePassthrough'));
            expect(tile.className).not.toContain('bg-[var(--st-raise)]');
        });

        it('ignores a probe made for another track', () => {
            playOnPipewire(cleanProbe(96000), 'local:0#old');
            openHifiSignalPath();
            draw(React.createElement(HifiSignalPathPanel));
            expect(place.querySelector('[role="status"]')!.textContent).toBe(i18n.t('hifi.signal.verdict.sharedMixer'));
            expect(place.querySelectorAll('ol > li')).toHaveLength(5);
            expect(place.textContent).not.toContain(footnote());
        });

        it('has no footnote without PipeWire', () => {
            playOnHifi();
            openHifiSignalPath();
            draw(React.createElement(HifiSignalPathPanel));
            expect(place.textContent).not.toContain(footnote());
        });

        it('keeps probing while the sheet is closed, so the badge can say rate passthrough', async () => {
            vi.useFakeTimers();
            try {
                const probeOutput = vi.fn(async () => cleanProbe(96000));
                (window as { electron?: unknown }).electron = { platform: 'linux', hifi: { probeOutput } };
                playOnHifi();
                act(() => useHifiEngineStore.setState({
                    engine: { ...engineState('local:1#a'), currentAo: 'pipewire', audioDevice: 'auto', exclusive: false },
                }));
                draw(React.createElement(React.Fragment, null, React.createElement(HifiSignalPathPanel), React.createElement(HifiBadge)));
                expect(place.querySelector('[role="dialog"]')).toBeNull();
                expect(place.querySelector('button')!.getAttribute('aria-label')).toContain(i18n.t('hifi.signal.verdictShort.sharedMixer'));

                await act(async () => {
                    vi.advanceTimersByTime(1500);
                });
                expect(probeOutput).toHaveBeenCalledOnce();
                expect(place.querySelector('button')!.getAttribute('aria-label')).toContain(i18n.t('hifi.signal.verdictShort.ratePassthrough'));
            } finally {
                vi.useRealTimers();
            }
        });
    });

    describe('the controls tab', () => {
        const tiles = () => React.createElement(SoundTiles, { loopMode: 'off', onToggleLoop: vi.fn(), loopToggleDisabled: false });

        it('keeps the loop, automix and effects tiles on the web route', () => {
            draw(tiles());
            expect(place.querySelectorAll('button')).toHaveLength(3);
            expect(place.querySelector('[data-ponder="audio-equalizer"]')).not.toBeNull();
        });

        it('puts one signal path tile over two columns in place of automix and effects on HiFi', () => {
            playOnHifi();
            draw(tiles());
            const buttons = place.querySelectorAll('button');
            expect(buttons).toHaveLength(2);
            expect(place.querySelector('[data-ponder="audio-equalizer"]')).toBeNull();
            expect(buttons[1].closest('.col-span-2')).not.toBeNull();
            // Lit: the path is bit-perfect.
            expect(buttons[1].className).toContain('bg-[var(--st-raise)]');
            press(buttons[1]);
            expect(useHifiPanelStore.getState().isSignalPathOpen).toBe(true);
        });

        const volumeRow = (onVolumePreview = vi.fn(), onToggleMute = vi.fn()) => React.createElement(VolumeRow, {
            volume: 0.4,
            isMuted: false,
            onVolumePreview,
            onVolumeChange: vi.fn(),
            onToggleMute,
        });

        it('leaves the volume row as it was on the web route', () => {
            draw(volumeRow());
            expect(sliders()[0].getAttribute('aria-disabled')).toBeNull();
            expect(sliders()[0].getAttribute('aria-valuenow')).toBe('40');
            expect(place.textContent).not.toContain(i18n.t('hifi.player.volumeFixed'));
        });

        it('hands the volume to the DAC on HiFi: the slider is out of reach, dimmed with its reading, and reads 100%', () => {
            playOnHifi();
            draw(volumeRow());
            expect(sliders()[0].getAttribute('aria-disabled')).toBe('true');
            expect(sliders()[0].getAttribute('aria-valuenow')).toBe('100');
            expect(sliders()[0].className).toContain('opacity-40');
            const reading = Array.from(place.querySelectorAll('span')).find(span => span.textContent === '100%')!;
            expect(reading.className).toContain('opacity-40');
            expect(place.textContent).toContain(i18n.t('hifi.player.volumeFixed'));
        });

        it('keeps mute in reach on HiFi: it goes to mpv, apart from the volume', () => {
            playOnHifi();
            const onToggleMute = vi.fn();
            draw(volumeRow(vi.fn(), onToggleMute));
            const mute = place.querySelector('button')!;
            expect(mute.getAttribute('aria-disabled')).toBeNull();
            press(mute);
            expect(onToggleMute).toHaveBeenCalledOnce();
        });

        it('reads 0% on HiFi while muted', () => {
            playOnHifi();
            draw(React.createElement(VolumeRow, { volume: 0.4, isMuted: true, onVolumePreview: vi.fn(), onVolumeChange: vi.fn(), onToggleMute: vi.fn() }));
            expect(sliders()[0].getAttribute('aria-valuenow')).toBe('0');
        });

        it('keeps the volume in reach on HiFi with software volume on', () => {
            useHifiSettingsStore.setState({ softwareVolume: true });
            playOnHifi();
            draw(volumeRow());
            expect(sliders()[0].getAttribute('aria-disabled')).toBeNull();
            expect(sliders()[0].getAttribute('aria-valuenow')).toBe('40');
        });
    });

    describe('the slider out of reach', () => {
        it('moves for no key and no press, and commits nothing', () => {
            const onPreview = vi.fn();
            const onCommit = vi.fn();
            draw(React.createElement(PanelSlider, { value: 0.5, onPreview, onCommit, label: 'Volume', valueText: '50%', disabled: true }));
            const slider = sliders()[0];
            expect(slider.className).toContain('opacity-40');
            act(() => {
                slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
                slider.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowUp', bubbles: true }));
                // jsdom has no PointerEvent; React takes a mouse event of that type all the same.
                slider.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }));
                slider.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
            });
            expect(onPreview).not.toHaveBeenCalled();
            expect(onCommit).not.toHaveBeenCalled();
        });

        it('still moves for a key when in reach', () => {
            const onPreview = vi.fn();
            draw(React.createElement(PanelSlider, { value: 0.5, onPreview, onCommit: vi.fn(), label: 'Volume', valueText: '50%' }));
            act(() => {
                sliders()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
            });
            expect(onPreview).toHaveBeenCalledWith(0.55);
        });
    });

    describe('the audio effects window', () => {
        beforeEach(() => {
            useAudioSettingsStore.getState().openAudioEqualizer();
        });

        it('says it is bypassed on HiFi and keeps the switch, presets, bands and effects out of reach', () => {
            playOnHifi();
            draw(React.createElement(AudioEqualizerDialog, { isDaylight: false }));
            expect(place.querySelector('[role="note"]')!.textContent).toContain(i18n.t('hifi.player.bypassNoticeTitle'));
            expect((place.querySelector('[role="switch"]') as HTMLButtonElement).disabled).toBe(true);
            sliders().forEach(slider => expect(slider.closest('[inert]')).not.toBeNull());
            const preset = Array.from(place.querySelectorAll('button')).find(button => button.textContent === i18n.t('ui.equalizerPreset.flat'));
            expect(preset?.closest('[inert]')).not.toBeNull();
        });

        it('has no notice and nothing out of reach on the web route', () => {
            draw(React.createElement(AudioEqualizerDialog, { isDaylight: false }));
            expect(place.querySelector('[role="note"]')).toBeNull();
            expect((place.querySelector('[role="switch"]') as HTMLButtonElement).disabled).toBe(false);
            expect(place.querySelector('[inert]')).toBeNull();
        });
    });

    describe('the ReplayGain row', () => {
        const row = () => React.createElement(ReplayGainControl, { values: { trackGain: -6.2 }, mode: 'track', onChangeMode: vi.fn() });

        it('says it is bypassed on HiFi, beside the measured gain', () => {
            playOnHifi();
            draw(row());
            expect(place.textContent).toContain(`${i18n.t('hifi.player.replayGainBypassed')} · ${i18n.t('localMusic.replayGainTrack')} -6.2 dB`);
        });

        it('shows only the measured gain on the web route', () => {
            draw(row());
            expect(place.textContent).not.toContain(i18n.t('hifi.player.replayGainBypassed'));
        });
    });
});
