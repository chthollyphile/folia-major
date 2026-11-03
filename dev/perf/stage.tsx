import React, { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { createRoot } from 'react-dom/client';
import { useShallow } from 'zustand/react/shallow';
import '../../src/i18n/config';
import '../../src/index.css';
import '../../src/stores/useMotionSettingsStore';
import AppShell from '../../src/components/app/AppShell';
import { usePlaybackVisualizerBridge } from '../../src/components/app/playback/bridges/usePlaybackVisualizerBridge';
import { createLyricsSetter } from '../../src/components/app/playback/createLyricsSetter';
import { buildAppStyle } from '../../src/components/app/presentation/buildAppStyle';
import { buildVisualizerTheme } from '../../src/components/app/presentation/buildVisualizerTheme';
import { PlayerBottomBarLayoutContext } from '../../src/components/floating-player/PlayerBottomBarLayoutContext';
import { getStoredVisualizerTunings } from '../../src/components/visualizer/tuningRegistry';
import { useVisualizerRendererModel } from '../../src/components/visualizer/useVisualizerRendererModel';
import VisualizerRenderer from '../../src/components/visualizer/VisualizerRenderer';
import { DAYLIGHT_THEME, DEFAULT_THEME } from '../../src/services/baseThemes';
import { audioBands, audioPower, currentTime, lyricCurrentTime } from '../../src/stores/motionSignals';
import { useAppViewStore } from '../../src/stores/useAppViewStore';
import { useLyricSettingsStore } from '../../src/stores/useLyricSettingsStore';
import {
    selectDisplaySong,
    setCachedCoverUrl,
    setCurrentLineIndex,
    setCurrentSong,
    setDuration,
    setLyricsState,
    setPlayerState,
    usePlaybackStore,
} from '../../src/stores/usePlaybackStore';
import { useThemeSettingsStore } from '../../src/stores/useThemeSettingsStore';
import { selectTypographySettingsSnapshot, useTypographySettingsStore } from '../../src/stores/useTypographySettingsStore';
import { useVisualizerSettingsStore } from '../../src/stores/useVisualizerSettingsStore';
import { PlayerState, type Line, type LyricData, type SongResult } from '../../src/types';
import { isBuiltinVisualizerBackgroundMode, isBuiltinVisualizerMode } from '../../src/types/visualizerModes';
import { findLatestActiveLineIndex } from '../../src/utils/appPlaybackHelpers';
import { resolveLyricProcessingOptions } from '../../src/utils/lyrics/filtering';
import { finalizeParsedLyricLines } from '../../src/utils/lyrics/parserCore';
import { ensureLyricDataRenderHints } from '../../src/utils/lyrics/renderHints';

// dev/perf/stage.tsx
// The measuring page: one lyric style over one background, put together the way the app does it,
// playing the test song from dev/perf/song.mjs. dev/perf/run.mjs and dev/perf/shots.mjs drive it
// through `window.__perf`; dev/perf/README.md says what the app has around a style that this page
// does not.
//
// What is the app's own code here, unchanged: the settings stores (a scenario's options go in
// through the stores' own actions), useVisualizerRendererModel (the props, and the same re-render
// on every new lyric line), VisualizerRenderer with its Suspense boundary and harmony layer, the
// layer and context App.tsx wraps it in, AppShell with the app's colour variables,
// usePlaybackVisualizerBridge, which reads the song clock from the audio element and the band
// levels from an analyser each frame, and the way lyrics reach the store: what the app's lyric
// parsers do to the lines of a lyric file once they are read (the '......' line in every gap of
// more than three seconds, the render hints), then createLyricsSetter with a new user's settings.
//
// Two ways to run it:
//   - live (measuring): the WAV really plays, silently, through an analyser set up like the app's.
//   - shot (pictures, `?shot=1`): no audio. dev/perf/clock.js has taken the page off real time; the
//     song clock is counted in that clock's steps of 1/60 s and the band levels come from the table
//     song.mjs worked out. The same steps give the same picture. dev/perf/shots.mjs drives it
//     through `window.__perf.shot`.

/** One scenario as the runner hands it over in the address (`?scenario=<json>`). */
interface PerfScenarioInput {
    style: string;
    background: string;
    /** Options to change, by the settings store's field name: `{ lumiereTuning: { renderQuality: 'low' } }`. */
    tunings?: Record<string, object>;
}

interface PerfSong {
    id: string;
    title: string;
    artist: string;
    album: string;
    cover: string;
    lines: Line[];
}

interface PerfSongFile {
    durationSeconds: number;
    window: { startSeconds: number; lengthSeconds: number };
    signal: { rate: number; spectrumBins: number };
    songs: Record<'a' | 'b', PerfSong>;
}

interface LongFrameScript {
    name: string;
    count: number;
    duration: number;
    forcedStyleAndLayout: number;
}

interface WindowReport {
    /** Milliseconds between the first and the last recorded frame. */
    elapsedMs: number;
    /** The gaps between one animation frame and the next, in milliseconds. */
    frameGapsMs: number[];
    longFrames: {
        count: number;
        totalDurationMs: number;
        blockingDurationMs: number;
        scripts: LongFrameScript[];
    };
}

/**
 * What dev/perf/shots.mjs does to the page in shot mode. Every time is a song time or a length in
 * seconds; nothing here waits on real time except `rest`.
 */
interface ShotApi {
    /** Steps with the song where it is: time passes for the style, not for the song. */
    run: (seconds: number) => Promise<void>;
    /** Puts the song clock at a time (never an earlier one) and plays. */
    play: (fromSongSeconds: number) => void;
    /** Moves the song clock forward to a time, as a seek does. */
    jumpTo: (songSeconds: number) => void;
    /** Steps until the song clock reads exactly this time. */
    runTo: (songSeconds: number) => Promise<void>;
    pause: () => void;
    /** Changes to the other song the way the measured page does, the wait in between in stepped time. */
    changeSong: () => void;
    setDaylight: (on: boolean) => void;
    /** Resolves when the page has stood still for a few frames of the screen: the last step is on it. */
    rest: () => Promise<void>;
    state: () => Record<string, unknown>;
}

interface PerfApi {
    ready: Promise<void>;
    info: () => Record<string, unknown>;
    playFrom: (songSeconds: number) => Promise<void>;
    pause: () => void;
    useSong: (key: 'a' | 'b') => void;
    waitForSongTime: (songSeconds: number) => Promise<void>;
    startWindow: () => void;
    endWindowAfter: (seconds: number, options?: { swapSongAfterSeconds?: number }) => Promise<WindowReport>;
    benchmark: () => number;
    /** In shot mode only. */
    shot?: ShotApi;
}

/** The stepped clock dev/perf/clock.js installs before any other script, in shot mode only. */
interface PerfClock {
    run: (steps: number) => Promise<void>;
    rest: (frames?: number) => Promise<void>;
    frameMs: number;
}

declare global {
    interface Window {
        __perf?: PerfApi;
        __perfClock?: PerfClock;
    }
}

const SONG_BASE = '/perf-song/';
/**
 * In a song change, the time between the first half (new song, lyrics, the player idle) and the
 * second (lyrics once more, play): in the app a local song spends it looking for a match and
 * reading its lyrics a second time.
 */
const SONG_CHANGE_SETTLE_MS = 250;

const query = new URLSearchParams(window.location.search);
const scenario: PerfScenarioInput = { style: 'classic', background: 'latent', ...JSON.parse(query.get('scenario') ?? '{}') };
const isShot = query.get('shot') === '1';

const nextFrame = () => new Promise<number>(resolve => { window.requestAnimationFrame(resolve); });
const wait = (ms: number) => new Promise<void>(resolve => { window.setTimeout(resolve, ms); });

const toSongResult = (song: PerfSong, durationSeconds: number): SongResult => ({
    id: song.id,
    name: song.title,
    artists: [{ id: `${song.id}-artist`, name: song.artist }],
    album: { id: `${song.id}-album`, name: song.album },
    durationMs: durationSeconds * 1000,
} as SongResult);

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** True when `held` has every field `patch` names, with the patch's value; records inside records are followed. */
const holdsPatch = (held: unknown, patch: unknown): boolean => (isRecord(patch)
    ? isRecord(held) && Object.entries(patch).every(([key, value]) => holdsPatch(held[key], value))
    : JSON.stringify(held) === JSON.stringify(patch));

/** The fields `patch` names, with the values `held` has for them. */
const readPatched = (held: unknown, patch: unknown): unknown => (isRecord(patch)
    ? Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, readPatched(isRecord(held) ? held[key] : undefined, value)]))
    : held);

/**
 * Puts a scenario's style, background and options into the settings store, through the store's own
 * actions, then reads every one of them back. A store action drops a field it does not know and
 * turns a value it does not accept into the default, both without a word; the scenario would then
 * be measured with the default under the option's name. So a field that does not hold what the
 * scenario asked for stops the page. Returns the options as the store holds them.
 */
const applyScenario = (): Record<string, unknown> => {
    // The store keeps any string as a style or a background, and the renderer then draws its default under that name.
    if (!isBuiltinVisualizerMode(scenario.style) || !isBuiltinVisualizerBackgroundMode(scenario.background)) {
        throw new Error(`[perf] no style named "${scenario.style}" or no background named "${scenario.background}"`);
    }
    const settings = useVisualizerSettingsStore.getState();
    settings.handleSetVisualizerMode(scenario.style, { notify: false });
    settings.handleSetVisualizerBackgroundMode(scenario.background);
    const setters = new Map(getStoredVisualizerTunings().map(tuning => [tuning.settingsKey, tuning.settingsSetterKey]));
    Object.entries(scenario.tunings ?? {}).forEach(([settingsKey, patch]) => {
        const setterKey = setters.get(settingsKey);
        const setter = setterKey ? (useVisualizerSettingsStore.getState() as unknown as Record<string, unknown>)[setterKey] : undefined;
        if (typeof setter !== 'function') {
            throw new Error(`[perf] no stored tuning named "${settingsKey}"`);
        }
        (setter as (patch: object) => void)(patch);
    });
    useAppViewStore.setState({ view: 'player' });

    const held = useVisualizerSettingsStore.getState() as unknown as Record<string, unknown>;
    if (held.visualizerMode !== scenario.style || held.visualizerBackgroundMode !== scenario.background) {
        throw new Error(`[perf] the store did not take the scenario: style "${scenario.style}" is "${String(held.visualizerMode)}", background "${scenario.background}" is "${String(held.visualizerBackgroundMode)}"`);
    }
    return Object.fromEntries(Object.entries(scenario.tunings ?? {}).map(([settingsKey, patch]) => {
        if (!holdsPatch(held[settingsKey], patch)) {
            throw new Error(`[perf] the store did not take an option: ${settingsKey} was given ${JSON.stringify(patch)} and holds ${JSON.stringify(readPatched(held[settingsKey], patch))}`);
        }
        return [settingsKey, readPatched(held[settingsKey], patch)];
    }));
};

/**
 * The song createLyricsSetter reads, kept the way src/components/app/playback/usePlaybackRuntimeRefs.ts
 * keeps it: it follows the store's song in an effect, so it still names the song before while the
 * first lyrics of a new one are set.
 */
const currentSongFullRef: MutableRefObject<SongResult | null> = { current: null };

/**
 * What the app does to the lines of a lyric file once a parser has read them, for a local song
 * (LyricParserFactory.parse without options, as resolveLocalSongLyrics calls it): every parser ends
 * in finalizeParsedLyricLines, which puts a '......' line into every gap of more than three seconds
 * and adds the render hints, and the factory then ensures them (the line rules run later, in the setter). Reading the text of a
 * file is not repeated here: the test song's lines are data already. Each call gives new line
 * objects, as a parse does.
 */
const parsedLyricsOf = (song: PerfSong): LyricData | null => {
    const options = resolveLyricProcessingOptions({});
    const lines = song.lines.map(line => ({ ...line, words: line.words.map(word => ({ ...word })) }));
    return ensureLyricDataRenderHints({ lines: finalizeParsedLyricLines(lines, options), isWordByWord: true });
};

/**
 * The app's lyric setter, built as App.tsx builds it, from the lyric settings store. The page
 * starts from an empty localStorage, so these are a new user's settings: no line rules, staff
 * credits handled by the 'smart' policy.
 */
const createAppLyricsSetter = () => {
    const settings = useLyricSettingsStore.getState();
    return createLyricsSetter(setLyricsState, settings.lyricLineRules, currentSongFullRef, {
        policy: settings.lyricStaffPolicy,
        minDwellSeconds: settings.lyricStaffMinDwellSeconds,
        absorbMode: settings.lyricStaffAbsorbMode,
        pattern: settings.lyricStaffPattern,
    });
};

const noop = () => undefined;
const zero = () => 0;
const never = () => false;

/** The app's own per-frame bridge from the audio element and the analyser to the visual signals. */
const LiveBridge: React.FC<{ audio: HTMLAudioElement; analyser: AnalyserNode }> = ({ audio, analyser }) => {
    const audioRef = useRef<HTMLAudioElement | null>(audio);
    const analyserRef = useRef<AnalyserNode | null>(analyser);
    const animationFrameRef = useRef(0);
    const stageLyricsClockRef = useRef({ startTimeSec: 0, endTimeSec: 0, baseTimeSec: 0, startedAtMs: null as number | null });
    usePlaybackVisualizerBridge({
        audioRef,
        analyserRef,
        animationFrameRef,
        effectiveLoopMode: 'off',
        isNowPlayingStageActive: false,
        isPlayerCapStageActive: false,
        stageActiveEntryKind: null,
        stageLyricsSession: null,
        stageLyricsClockRef,
        getSyntheticStageLyricsTime: zero,
        syncStageLyricsClock: noop,
        getNowPlayingDisplayTime: zero,
        getPlayerCapDisplayTime: zero,
        syncNowPlayingClock: noop,
        lyricTimelineOffsetMs: 0,
        isTransitionAudible: never,
    });
    return null;
};

/** The page: what App.tsx builds around VisualizerRenderer, with the app's stores behind it. */
const Stage: React.FC<{ bridge: React.ReactNode }> = ({ bridge }) => {
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const typography = useTypographySettingsStore(useShallow(selectTypographySettingsSnapshot));
    const visualizerMode = useVisualizerSettingsStore(state => state.visualizerMode);
    const displaySongId = usePlaybackStore(state => selectDisplaySong(state)?.id);
    const currentSong = usePlaybackStore(state => state.currentSong);
    useEffect(() => {
        currentSongFullRef.current = currentSong;
    }, [currentSong]);
    const appStyle = useMemo(() => buildAppStyle({
        bgMode: 'default',
        isDaylight,
        theme: DEFAULT_THEME,
        daylightTheme: DAYLIGHT_THEME,
        defaultTheme: DEFAULT_THEME,
        transparentBackground: false,
    }), [isDaylight]);
    const { visualizerTheme, visualizerSubtitleTheme, visualizerGeometrySeed } = useMemo(() => buildVisualizerTheme({
        appStyle,
        theme: DEFAULT_THEME,
        lyricsFontStyle: typography.lyricsFontStyle,
        lyricsFontWeight: typography.lyricsFontWeight,
        lyricsCustomFontFamily: typography.lyricsCustomFontFamily,
        lyricsFontFallbackFamilies: typography.lyricsFontFallbackFamilies,
        subtitleFontInheritsLyrics: typography.subtitleFontInheritsLyrics,
        subtitleFontStyle: typography.subtitleFontStyle,
        subtitleFontWeight: typography.subtitleFontWeight,
        subtitleFontFamily: typography.subtitleFontFamily,
        subtitleFontFallbackFamilies: typography.subtitleFontFallbackFamilies,
        currentSongId: displaySongId,
        visualizerMode,
    }), [appStyle, displaySongId, typography, visualizerMode]);
    const model = useVisualizerRendererModel({
        theme: visualizerTheme,
        subtitleTheme: visualizerSubtitleTheme,
        seed: visualizerGeometrySeed,
        isObsBrowserSourceRendering: false,
        shouldPauseVisualizerBackground: false,
        hideTranslationSubtitle: false,
        isPlayerPageTransparent: false,
        onLyricLineSeek: noop,
        onBack: noop,
    });

    return (
        <AppShell
            appStyle={appStyle}
            isElectronWindow={false}
            hideFullscreenButton
            usesCustomWindowChrome={false}
            useCustomWindowRadius={false}
            showTransparentWindowBorder={false}
            isPlayerView
            isTitlebarRevealed={false}
            alwaysShowMainWindowTitlebar={false}
            isMainWindowClickThroughEnabled={false}
            showMainWindowClickThroughToggle={false}
            onToggleMainWindowClickThrough={noop}
            isDaylight={isDaylight}
            theme={DEFAULT_THEME}
            audioElement={bridge}
        >
            <div className="absolute inset-0 z-0" data-testid="player-visual-surface" data-perf-stage="">
                <PlayerBottomBarLayoutContext.Provider value>
                    <VisualizerRenderer {...model} />
                </PlayerBottomBarLayoutContext.Provider>
            </div>
        </AppShell>
    );
};

/** The graphics card the page draws with, as WebGL names it. */
const readGlRenderer = () => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) {
        return 'no WebGL';
    }
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return renderer;
};

/**
 * A fixed piece of single-thread JavaScript (number work, object sorting, a string-keyed map),
 * timed in milliseconds. It measures how fast this page's main thread is under a profile, nothing else.
 */
const benchmark = () => {
    const startedAt = performance.now();
    let hash = 0;
    for (let index = 1; index < 6_000_000; index += 1) {
        hash = (hash + Math.sqrt(index) * ((index % 7) + 1)) % 1_000_003;
    }
    let seed = 12345;
    const items: { key: number; value: number }[] = [];
    for (let index = 0; index < 250_000; index += 1) {
        seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
        items.push({ key: seed, value: index });
    }
    items.sort((left, right) => left.key - right.key);
    const counts = new Map<string, number>();
    for (let index = 0; index < 400_000; index += 1) {
        const key = `k${items[index % items.length]!.key % 4096}`;
        counts.set(key, (counts.get(key) ?? 0) + index);
    }
    if (hash < 0 || counts.size === 0) {
        throw new Error('[perf] benchmark went wrong');
    }
    return performance.now() - startedAt;
};

/** Records the gaps between animation frames and the long animation frames, from startWindow to its end. */
const createWindowRecorder = () => {
    const stamps: number[] = [];
    let recording = false;
    let longFrames: PerformanceEntry[] = [];
    let observer: PerformanceObserver | null = null;
    const tick = (now: number) => {
        if (!recording) {
            return;
        }
        stamps.push(now);
        window.requestAnimationFrame(tick);
    };
    return {
        start: () => {
            stamps.length = 0;
            longFrames = [];
            recording = true;
            try {
                observer = new PerformanceObserver(list => { longFrames.push(...list.getEntries()); });
                observer.observe({ type: 'long-animation-frame' });
            } catch {
                observer = null;
            }
            window.requestAnimationFrame(tick);
        },
        stop: (): WindowReport => {
            recording = false;
            if (observer) {
                longFrames.push(...observer.takeRecords());
                observer.disconnect();
            }
            const scripts = new Map<string, LongFrameScript>();
            let totalDurationMs = 0;
            let blockingDurationMs = 0;
            longFrames.forEach((entry) => {
                const frame = entry as PerformanceEntry & {
                    blockingDuration?: number;
                    scripts?: { invoker?: string; sourceFunctionName?: string; sourceURL?: string; duration: number; forcedStyleAndLayoutDuration?: number }[];
                };
                totalDurationMs += frame.duration;
                blockingDurationMs += frame.blockingDuration ?? 0;
                (frame.scripts ?? []).forEach((script) => {
                    const file = (script.sourceURL ?? '').split('/').pop() ?? '';
                    const name = `${script.sourceFunctionName || script.invoker || '(anonymous)'}${file ? ` @ ${file}` : ''}`;
                    const held = scripts.get(name) ?? { name, count: 0, duration: 0, forcedStyleAndLayout: 0 };
                    held.count += 1;
                    held.duration += script.duration;
                    held.forcedStyleAndLayout += script.forcedStyleAndLayoutDuration ?? 0;
                    scripts.set(name, held);
                });
            });
            const frameGapsMs: number[] = [];
            for (let index = 1; index < stamps.length; index += 1) {
                frameGapsMs.push(stamps[index]! - stamps[index - 1]!);
            }
            return {
                elapsedMs: stamps.length > 1 ? stamps[stamps.length - 1]! - stamps[0]! : 0,
                frameGapsMs,
                longFrames: {
                    count: longFrames.length,
                    totalDurationMs,
                    blockingDurationMs,
                    scripts: [...scripts.values()].sort((left, right) => right.duration - left.duration).slice(0, 8),
                },
            };
        },
    };
};

const start = async () => {
    const songFile = await (await fetch(`${SONG_BASE}lyrics.json`)).json() as PerfSongFile;
    const songs = songFile.songs;
    let activeSong: 'a' | 'b' = 'a';

    const appliedTunings = applyScenario();
    const setLyrics = createAppLyricsSetter();
    const coverOf = (key: 'a' | 'b') => `${window.location.origin}${SONG_BASE}${songs[key].cover}`;

    /** Makes a song the current one in one step, outside any measured window: its lyrics, no line yet, the song, its cover. */
    const holdSong = (key: 'a' | 'b') => {
        const song = songs[key];
        activeSong = key;
        setLyrics(parsedLyricsOf(song));
        setCurrentLineIndex(-1);
        setCurrentSong(toSongResult(song, songFile.durationSeconds));
        setCachedCoverUrl(coverOf(key));
    };

    holdSong('a');
    setDuration(songFile.durationSeconds);

    let bridge: React.ReactNode = null;
    let api: Omit<PerfApi, 'ready' | 'info' | 'benchmark'>;
    const unavailable = (name: string) => () => { throw new Error(`[perf] ${name} is not available in this mode`); };

    if (isShot) {
        // No audio: the song clock is counted in the stepped clock's steps, the band levels are read from the table.
        const signal = new Uint8Array(await (await fetch(`${SONG_BASE}signal.bin`)).arrayBuffer());
        const recordBytes = 6 + songFile.signal.spectrumBins;
        const clock = window.__perfClock;
        if (!clock) {
            throw new Error('[perf] shot mode needs dev/perf/clock.js injected before the page');
        }
        const stepsPerSecond = Math.round(1000 / clock.frameMs);
        const toSteps = (seconds: number) => Math.round(seconds * stepsPerSecond);
        /** The song clock in steps of 1/60 s: a whole number, so a picture's song time is reached exactly. */
        let songStep = 0;
        let playing = false;
        let lineIndex = -2;
        /** How many steps had been taken when the style first had something in the stage (-1: not yet). */
        let stepsTaken = 0;
        let mountedAtStep = -1;
        const stageElements = () => document.querySelector('[data-perf-stage]')?.querySelectorAll('*').length ?? 0;
        /** Writes the song clock, the band levels of that moment and the lyric line, as the app's bridge does each frame while a song sounds. */
        const writeSongTime = () => {
            const songTime = songStep / stepsPerSecond;
            currentTime.set(songTime);
            lyricCurrentTime.set(songTime);
            const frame = Math.max(0, Math.min(Math.floor(songTime * songFile.signal.rate), signal.length / recordBytes - 1));
            const record = signal.subarray(frame * recordBytes, (frame + 1) * recordBytes);
            audioPower.set(record[0]!);
            audioBands.bass.set(record[1]!);
            audioBands.lowMid.set(record[2]!);
            audioBands.mid.set(record[3]!);
            audioBands.vocal.set(record[4]!);
            audioBands.treble.set(record[5]!);
            const spectrum = new Uint8Array(1024);
            const repeat = 1024 / songFile.signal.spectrumBins;
            for (let bin = 0; bin < 1024; bin += 1) {
                spectrum[bin] = record[6 + Math.floor(bin / repeat)]!;
            }
            audioBands.spectrum.set(spectrum);
            // The lines as the store holds them: the app's lyric path has added lines to the song's own.
            const found = findLatestActiveLineIndex(usePlaybackStore.getState().lyrics?.lines ?? [], songTime);
            if (found !== lineIndex) {
                lineIndex = found;
                setCurrentLineIndex(found);
            }
        };
        // One call per step. While a song plays its clock moves one step on. While none does, the
        // signals get what the app's bridge writes then (usePlaybackVisualizerBridge.ts): a slow
        // breath on every band, no spectrum, and the song clock left where it is.
        const drive = () => {
            stepsTaken += 1;
            if (mountedAtStep < 0 && stageElements() > 2) {
                mountedAtStep = stepsTaken;
            }
            if (playing) {
                songStep += 1;
                writeSongTime();
            } else {
                const breath = (Math.sin(Date.now() / 2000) + 1) * 20;
                audioPower.set(breath);
                audioBands.bass.set(breath);
                audioBands.lowMid.set(breath);
                audioBands.mid.set(breath);
                audioBands.vocal.set(breath);
                audioBands.treble.set(breath);
                audioBands.spectrum.set(new Uint8Array(0));
            }
            window.requestAnimationFrame(drive);
        };
        window.requestAnimationFrame(drive);
        const jumpTo = (songSeconds: number) => {
            if (toSteps(songSeconds) < songStep) {
                throw new Error(`[perf] a pictured scenario only plays forward: the song is at ${songStep / stepsPerSecond} s and was sent back to ${songSeconds} s`);
            }
            songStep = toSteps(songSeconds);
            writeSongTime();
        };
        // The song change of the measured page (changeSong in the other branch), with the stepped
        // clock in place of the audio element: the new song with its lyrics, no line, the clock at 0
        // and the player idle in one go; SONG_CHANGE_SETTLE_MS of stepped time later the song and
        // its lyrics once more, and it plays.
        const changeSong = () => {
            const key = activeSong === 'a' ? 'b' : 'a';
            const song = songs[key];
            activeSong = key;
            setLyrics(parsedLyricsOf(song));
            setCurrentLineIndex(-1);
            lineIndex = -1;
            currentTime.set(0);
            setCurrentSong(toSongResult(song, songFile.durationSeconds));
            playing = false;
            songStep = 0;
            setCachedCoverUrl(coverOf(key));
            setPlayerState(PlayerState.IDLE);
            window.setTimeout(() => {
                setCurrentSong(toSongResult(song, songFile.durationSeconds));
                setLyrics(parsedLyricsOf(song));
                playing = true;
                setPlayerState(PlayerState.PLAYING);
            }, SONG_CHANGE_SETTLE_MS);
        };
        api = {
            playFrom: unavailable('playFrom'),
            pause: unavailable('pause'),
            useSong: holdSong,
            waitForSongTime: unavailable('waitForSongTime'),
            startWindow: unavailable('startWindow'),
            endWindowAfter: unavailable('endWindowAfter'),
            shot: {
                run: seconds => clock.run(toSteps(seconds)),
                play: (fromSongSeconds) => {
                    jumpTo(fromSongSeconds);
                    playing = true;
                    setPlayerState(PlayerState.PLAYING);
                },
                jumpTo,
                runTo: (songSeconds) => {
                    const steps = toSteps(songSeconds) - songStep;
                    if (!playing || steps < 0) {
                        throw new Error(`[perf] cannot play on to ${songSeconds} s: the song ${playing ? `is already at ${songStep / stepsPerSecond} s` : 'is not playing'}`);
                    }
                    return clock.run(steps);
                },
                pause: () => {
                    playing = false;
                    setPlayerState(PlayerState.PAUSED);
                },
                changeSong,
                setDaylight: on => useThemeSettingsStore.getState().setDaylightPreference(on),
                rest: () => clock.rest(),
                state: () => ({
                    song: activeSong,
                    songSeconds: songStep / stepsPerSecond,
                    playing,
                    playerState: usePlaybackStore.getState().playerState,
                    lineIndex,
                    daylight: useThemeSettingsStore.getState().isDaylight,
                    stageElements: stageElements(),
                    mountedAtStep,
                }),
            },
        };
    } else {
        // The WAV plays for real. The graph is the part of the app's that the visuals read: the
        // element into an analyser with the app's settings; the gain of 0 after it keeps it silent.
        const audio = new Audio();
        audio.preload = 'auto';
        audio.src = URL.createObjectURL(await (await fetch(`${SONG_BASE}song.wav`)).blob());
        await new Promise<void>((resolve, reject) => {
            audio.addEventListener('canplaythrough', () => resolve(), { once: true });
            audio.addEventListener('error', () => reject(new Error('[perf] the test song did not load')), { once: true });
        });
        const context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.6;
        const silence = context.createGain();
        silence.gain.value = 0;
        context.createMediaElementSource(audio).connect(analyser);
        analyser.connect(silence);
        silence.connect(context.destination);
        bridge = <LiveBridge audio={audio} analyser={analyser} />;

        const recorder = createWindowRecorder();
        const waitForSongTime = async (songSeconds: number) => {
            while (audio.currentTime < songSeconds) {
                if (audio.paused || audio.ended) {
                    throw new Error('[perf] the song stopped before the window');
                }
                await nextFrame();
            }
        };
        // A song change the way the app makes one for a local song (onPlayLocalSong in
        // src/components/app/playback/start/useLibraryPlaybackController.ts, and the play effect of
        // usePlaybackAudioBridge.ts). First, in one run: the new song's lyrics, no line yet, the clock
        // at 0, the new song, its source (here the same file from its start; the element stops, as it
        // does when the audio bridge calls pause() and load() for a new source), its cover, and the
        // player state IDLE. Then, once the app has looked for a match and read the lyrics a second
        // time: the song object once more, the lyrics once more, and only then play(), with PLAYING
        // when it has started.
        const changeSong = (key: 'a' | 'b') => {
            const song = songs[key];
            activeSong = key;
            setLyrics(parsedLyricsOf(song));
            setCurrentLineIndex(-1);
            currentTime.set(0);
            setCurrentSong(toSongResult(song, songFile.durationSeconds));
            audio.pause();
            audio.currentTime = 0;
            setCachedCoverUrl(coverOf(key));
            setPlayerState(PlayerState.IDLE);
            window.setTimeout(() => {
                setCurrentSong(toSongResult(song, songFile.durationSeconds));
                setLyrics(parsedLyricsOf(song));
                void audio.play().then(() => setPlayerState(PlayerState.PLAYING));
            }, SONG_CHANGE_SETTLE_MS);
        };
        api = {
            playFrom: async (songSeconds) => {
                audio.currentTime = Math.max(0, songSeconds);
                await context.resume();
                await audio.play();
                setPlayerState(PlayerState.PLAYING);
            },
            pause: () => {
                audio.pause();
                setPlayerState(PlayerState.PAUSED);
            },
            useSong: holdSong,
            waitForSongTime,
            startWindow: recorder.start,
            // The window ends `seconds` of real time after it began. With `swapSongAfterSeconds` the
            // song changes inside it (changeSong above).
            endWindowAfter: async (seconds, options) => {
                const startedAt = performance.now();
                let swapped = options?.swapSongAfterSeconds === undefined;
                while (performance.now() - startedAt < seconds * 1000) {
                    if (!swapped && performance.now() - startedAt >= options!.swapSongAfterSeconds! * 1000) {
                        swapped = true;
                        changeSong(activeSong === 'a' ? 'b' : 'a');
                    }
                    await nextFrame();
                }
                if (options?.swapSongAfterSeconds !== undefined && audio.paused) {
                    throw new Error('[perf] the song did not start again after the change');
                }
                return recorder.stop();
            },
        };
    }

    const rootElement = document.getElementById('root')!;
    createRoot(rootElement).render(
        <React.StrictMode>
            <Stage bridge={bridge} />
        </React.StrictMode>,
    );

    // Ready once the style's own code has arrived and drawn something into the stage. In shot mode
    // the clock stands still while the page loads, and a style may need time to pass before it
    // draws: there the page is ready once it has done all it can without that, and shots.mjs looks
    // at what the stage holds after its first steps.
    const ready = isShot ? window.__perfClock!.rest() : (async () => {
        const deadline = performance.now() + 20_000;
        for (;;) {
            const stage = document.querySelector('[data-perf-stage]');
            if (stage && stage.querySelectorAll('*').length > 2) {
                break;
            }
            if (!isShot && performance.now() > deadline) {
                throw new Error(`[perf] style "${scenario.style}" did not mount`);
            }
            await wait(50);
        }
        await document.fonts.ready;
    })();

    window.__perf = {
        ...api,
        ready,
        benchmark,
        info: () => ({
            style: useVisualizerSettingsStore.getState().visualizerMode,
            background: useVisualizerSettingsStore.getState().visualizerBackgroundMode,
            frameRateCap: useVisualizerSettingsStore.getState().visualizerFrameRate,
            // The scenario's options as the settings store holds them (read back, not repeated from the address).
            tunings: appliedTunings,
            // How many lines the store holds for the song: the song's own and the ones the app's lyric path added.
            lyricLines: usePlaybackStore.getState().lyrics?.lines.length ?? 0,
            mode: isShot ? 'shot' : 'live',
            viewport: [window.innerWidth, window.innerHeight],
            deviceScale: window.devicePixelRatio,
            visibility: document.visibilityState,
            glRenderer: readGlRenderer(),
            userAgent: navigator.userAgent,
            window: songFile.window,
        }),
    };
    console.log(`[perf] page up: style=${scenario.style} background=${scenario.background} mode=${isShot ? 'shot' : 'live'}`);
};

start().catch((error) => {
    console.error('[perf] the page failed to start', error);
    document.documentElement.setAttribute('data-perf-error', String(error));
});
