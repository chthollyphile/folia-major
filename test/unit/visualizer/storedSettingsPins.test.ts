import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_CADENZA_TUNING,
    DEFAULT_CAPPELLA_TUNING,
    DEFAULT_CLADDAGH_TUNING,
    DEFAULT_CLASSIC_TUNING,
    DEFAULT_DIORAMA_TUNING,
    DEFAULT_FUME_TUNING,
    DEFAULT_LATENT_BACKGROUND_TUNING,
    DEFAULT_LUMIERE_TUNING,
    DEFAULT_MONET_BACKGROUND_TUNING,
    DEFAULT_MONET_TUNING,
    DEFAULT_NOMAND_BACKGROUND_TUNING,
    DEFAULT_PARTITA_TUNING,
    DEFAULT_PENDOLO_TUNING,
    DEFAULT_SONNET_TUNING,
    DEFAULT_SORA_BACKGROUND_TUNING,
    DEFAULT_TEMPERA_TUNING,
    DEFAULT_TILT_TUNING,
} from '@/types';

// test/unit/visualizer/storedSettingsPins.test.ts
// Pins what the lyric styles and the backgrounds keep in localStorage: for every one of them, what
// the app reads at start-up from each shape a disk can hold today (nothing, the current shape, a
// part of it, each old shape, values out of range or of the wrong kind, text that is not JSON),
// and the exact text it writes on a change and on a reset.
//
// A wrong key name or a lost old shape breaks nothing that a build or another test sees: a
// listener's style just looks reset after an update. These pins are what stands in the way. They
// were recorded before the storage code was moved into the styles' own folders and must pass
// unchanged after every step of that move: a pin that has to change means the step is wrong.
//
// Each case starts the settings store anew over a storage of its own, the way the app starts.
//
// The first start loads every style's folder. On a busy machine that passes the suite's 5 s, and a
// pin that times out also leaves a stray entry in the snapshot file: this file gets a longer limit.
vi.setConfig({ testTimeout: 30_000 });

type Stored = Record<string, string>;
type AnyState = Record<string, unknown> & Record<string, (...args: never[]) => unknown>;

const json = (value: unknown) => JSON.stringify(value);

/** Starts the app's settings store over `stored`, as a start of the app does. */
const start = async (stored: Stored) => {
    const values = new Map(Object.entries(stored));
    const storage: Storage = {
        get length() {
            return values.size;
        },
        getItem: key => values.get(key) ?? null,
        key: index => Array.from(values.keys())[index] ?? null,
        setItem: (key, value) => {
            values.set(key, String(value));
        },
        removeItem: (key) => {
            values.delete(key);
        },
        clear: () => values.clear(),
    };
    vi.resetModules();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', { localStorage: storage });
    // Clearing an uploaded picture deletes it from the browser's database first, and an upload
    // writes it there: not here.
    for (const [path, clear, save] of [
        ['@/services/monetBackgroundImage', 'clearMonetBackgroundImage', 'saveMonetBackgroundImage'],
        ['@/services/monetPortraitImage', 'clearMonetPortraitImage', 'saveMonetPortraitImage'],
        ['@/services/cappellaEmojiPack', 'clearCustomCappellaEmojiPack', 'saveCustomCappellaEmojiPack'],
        ['@/services/cappellaAvatarPack', 'clearCustomCappellaAvatar', 'saveCustomCappellaAvatar'],
    ] as const) {
        vi.doMock(path, async importOriginal => ({ ...(await importOriginal<object>()), [clear]: async () => {}, [save]: async () => {} }));
    }
    const { useVisualizerSettingsStore } = await import('@/stores/useVisualizerSettingsStore');
    const { useVisualizerAssetStore } = await import('@/stores/useVisualizerAssetStore');
    const { useStatusMessageStore } = await import('@/stores/useStatusMessageStore');
    const { default: i18n } = await import('@/i18n/config');
    const state = () => useVisualizerSettingsStore.getState() as unknown as AnyState;
    return {
        state,
        assets: useVisualizerAssetStore,
        /** The notice the app shows now, and a way to take it off before the next step. */
        notice: () => useStatusMessageStore.getState().message,
        clearNotice: () => useStatusMessageStore.getState().setMessage(null),
        t: (key: string) => i18n.t(key),
        /** Everything the store holds that is not an action, each as the text it would be written as: that pins the order of an object's fields too. */
        held: () => Object.fromEntries(Object.entries(state()).filter(([, value]) => typeof value !== 'function').map(([key, value]) => [key, json(value)])),
        text: (key: string) => values.get(key) ?? null,
        // The language the app runs in is stored by the language setting, not by these settings.
        keys: () => [...values.keys()].filter(key => key !== 'i18nextLng').sort(),
    };
};

afterEach(() => {
    vi.doUnmock('@/services/monetBackgroundImage');
    vi.doUnmock('@/services/monetPortraitImage');
    vi.doUnmock('@/services/cappellaEmojiPack');
    vi.doUnmock('@/services/cappellaAvatarPack');
    vi.unstubAllGlobals();
});

// What a current version writes: every field present and in range, none at its default where a
// different value is as easy.
const CURRENT: Record<string, unknown> = {
    classic_tuning: { enableWordRotation: false, breathingFloatMultiplier: 1.6, useLegacyLayout: true, wordSpacing: 1.2 },
    cadenza_tuning: { fontScale: 1.3, widthRatio: 0.6, motionAmount: 0.8, glowIntensity: 1.4, beamIntensity: 0 },
    partita_tuning: { showGuideLines: false, useSemanticLayout: false, staggerMin: 40, staggerMax: 150 },
    fume_tuning: {
        hidePrintSymbols: true, disableGeometricBackground: false, backgroundObjectOpacity: 0.3, textHoldRatio: 0.7,
        cameraTrackingMode: 'stepped', cameraSpeed: 1.4, glowIntensity: 0.6, heroScale: 1.2,
    },
    claddagh_tuning: { focusScaleRatio: 0.9, radiusScale: 1.2, ellipseTiltDeg: 30, showAxisLine: false, letterSpacingOffset: 4 },
    cappella_tuning: { showEmoMessages: false, emojiPackSource: 'custom', avatarSource: 'color' },
    tilt_tuning: { splitProbability: 0.4, tiltStyleProbability: 0.6, colorScheme: 'swap' },
    diorama_tuning: {
        ...DEFAULT_DIORAMA_TUNING,
        cameraSpeed: 1.3, motionAmount: 0.9, audioReactivity: 0.5,
        geometryVisibility: { ...DEFAULT_DIORAMA_TUNING.geometryVisibility, rings: !DEFAULT_DIORAMA_TUNING.geometryVisibility.rings },
        showParticles: !DEFAULT_DIORAMA_TUNING.showParticles, glowIntensity: 0.8, soulIntensity: 1.2, gradientIntensity: 0.4,
    },
    monet_tuning: {
        ...DEFAULT_MONET_TUNING,
        keywordColoringEnabled: !DEFAULT_MONET_TUNING.keywordColoringEnabled, showDescription: !DEFAULT_MONET_TUNING.showDescription,
        audioStyle: 'line', audioPlacement: 'lyrics', audioGain: 1.5,
        fontScale: 1.2, portraitSource: 'custom', portraitOffsetX: -40, portraitStyle: 'rectangular',
    },
    pendolo_tuning: {
        ...DEFAULT_PENDOLO_TUNING,
        arcRadius: 0.6, arcAngleDeg: 120, wheelCenterX: 0.1, wheelCenterY: 0.4, tickSnappiness: 1.5, activeScale: 1.3,
        showGearDecor: 'full', showCenterGradient: !DEFAULT_PENDOLO_TUNING.showCenterGradient, enableLineGlow: !DEFAULT_PENDOLO_TUNING.enableLineGlow,
    },
    sonnet_tuning: {
        ...DEFAULT_SONNET_TUNING,
        cameraIntensity: 1.4, typographyMotion: 0.6, mgDensity: 1.8, showOnlyText: !DEFAULT_SONNET_TUNING.showOnlyText,
        outerFrameMode: 'frame', textureResolution: 2, postProcessGrain: 0.3, postProcessVignette: 1.5,
    },
    tempera_tuning: {
        ...DEFAULT_TEMPERA_TUNING,
        cameraIntensity: 0.5, glyphMotion: 1.5, wholeLineLyrics: !DEFAULT_TEMPERA_TUNING.wholeLineLyrics, colorMode: 'gradient',
        layerImages: [{ id: 'a', name: 'A', align: 'left', verticalAlign: 'top', scale: 0.5, opacity: 0.8 }],
        layerImageDepth: 'front', layerImageFrequency: 0.4, textureResolution: 1.5, postProcessContrast: 0.6,
    },
    lumiere_tuning: {
        ...DEFAULT_LUMIERE_TUNING,
        lightIntensity: 1.5, fogDensity: 0.4, windowNeighbors: DEFAULT_LUMIERE_TUNING.windowNeighbors === 1 ? 2 : 1, fogOctaves: 3,
        hideTrails: !DEFAULT_LUMIERE_TUNING.hideTrails, themeColorMix: 0.7, renderQuality: 'low',
    },
    monet_background_tuning: {
        ...DEFAULT_MONET_BACKGROUND_TUNING,
        backgroundSource: 'uploaded-global', backgroundLayout: 'half-pane-gradient', backgroundBlurPx: 24, backgroundOverlayOpacity: 0.3,
        backgroundSaturation: 1.4, backgroundHalfPaneOffsetX: -12, backgroundWashColorMode: 'custom', backgroundWashCustomColor: '#aabbcc',
        backgroundDriftEnabled: !DEFAULT_MONET_BACKGROUND_TUNING.backgroundDriftEnabled,
    },
    nomand_background_tuning: {
        ...DEFAULT_NOMAND_BACKGROUND_TUNING,
        imageSource: 'uploaded-global', effect: 'halftone-dots', ditheringType: '8x8', size: 6, colorSteps: 5,
        inverted: !DEFAULT_NOMAND_BACKGROUND_TUNING.inverted, flutedGlassSize: 0.5, halftoneDotsRadius: 1.5, lensDistortionBulge: -0.5,
        overlayEnabled: !DEFAULT_NOMAND_BACKGROUND_TUNING.overlayEnabled, overlayOpacity: 0.3,
    },
    latent_background_tuning: {
        ...DEFAULT_LATENT_BACKGROUND_TUNING,
        displayMode: 'mesh', colorSource: 'cover-only', dynamicOnlyInPlayer: !DEFAULT_LATENT_BACKGROUND_TUNING.dynamicOnlyInPlayer,
        ditheringSpeed: 1.5, ditheringSize: 4, meshDistortion: 1.2, meshSwirl: 0.6, overlayOpacity: 0.4,
    },
    sora_background_tuning: { blank: !DEFAULT_SORA_BACKGROUND_TUNING.blank },
};

const TUNING_KEYS = Object.keys(CURRENT);

/** The same `text` under every tuning key. */
const everywhere = (text: string): Stored => Object.fromEntries(TUNING_KEYS.map(key => [key, text]));

const DEFAULTS: Record<string, unknown> = {
    classic_tuning: DEFAULT_CLASSIC_TUNING, cadenza_tuning: DEFAULT_CADENZA_TUNING, partita_tuning: DEFAULT_PARTITA_TUNING,
    fume_tuning: DEFAULT_FUME_TUNING, claddagh_tuning: DEFAULT_CLADDAGH_TUNING, cappella_tuning: DEFAULT_CAPPELLA_TUNING,
    tilt_tuning: DEFAULT_TILT_TUNING, diorama_tuning: DEFAULT_DIORAMA_TUNING, monet_tuning: DEFAULT_MONET_TUNING,
    pendolo_tuning: DEFAULT_PENDOLO_TUNING, sonnet_tuning: DEFAULT_SONNET_TUNING, tempera_tuning: DEFAULT_TEMPERA_TUNING,
    lumiere_tuning: DEFAULT_LUMIERE_TUNING, monet_background_tuning: DEFAULT_MONET_BACKGROUND_TUNING,
    nomand_background_tuning: DEFAULT_NOMAND_BACKGROUND_TUNING, latent_background_tuning: DEFAULT_LATENT_BACKGROUND_TUNING,
    sora_background_tuning: DEFAULT_SORA_BACKGROUND_TUNING,
};

describe('what is read at start-up', () => {
    it('with nothing stored', async () => {
        const app = await start({});
        expect(app.held()).toMatchSnapshot();
        // Reading stores nothing.
        expect(app.keys()).toEqual([]);
    });

    it('from the current shape of every key', async () => {
        const stored: Stored = {
            ...Object.fromEntries(Object.entries(CURRENT).map(([key, value]) => [key, json(value)])),
            visualizer_mode: 'pendolo',
            visualizer_background_mode: 'nomand',
            background_opacity: '0.4',
            visualizer_opacity: '0.6',
            disable_visualizer_vignette: 'true',
            disable_visualizer_geometric_background: 'true',
            random_visualizer_mode_per_song: 'true',
            url_background_list: json([{ id: 'one', url: 'https://example.com/a', note: 'First' }, { id: 'two', url: 'https://example.com/b', note: 'Second' }]),
            url_background_selected_id: 'two',
        };
        const app = await start(stored);
        expect(app.held()).toMatchSnapshot();
        expect(Object.fromEntries(app.keys().map(key => [key, app.text(key)]))).toEqual(stored);
    });

    it('from a stored object that holds one field only: the rest are the defaults', async () => {
        const app = await start({
            classic_tuning: json({ wordSpacing: 1.5 }),
            cadenza_tuning: json({ glowIntensity: 0.5 }),
            partita_tuning: json({ staggerMin: 150 }),
            fume_tuning: json({ heroScale: 0.9 }),
            claddagh_tuning: json({ ellipseTiltDeg: 10 }),
            cappella_tuning: json({ avatarSource: 'builtin' }),
            tilt_tuning: json({ colorScheme: 'accentAll' }),
            diorama_tuning: json({ showParticles: false }),
            monet_tuning: json({ fontScale: 0.8 }),
            pendolo_tuning: json({ showGearDecor: 'none' }),
            sonnet_tuning: json({ outerFrameMode: 'full' }),
            tempera_tuning: json({ colorMode: 'mono' }),
            lumiere_tuning: json({ renderQuality: 'balanced' }),
            monet_background_tuning: json({ backgroundBlurPx: 10 }),
            nomand_background_tuning: json({ effect: 'dithering' }),
            latent_background_tuning: json({ displayMode: 'dithering' }),
            sora_background_tuning: json({}),
        });
        expect(app.held()).toMatchSnapshot();
    });

    it('from the old shapes still on disks', async () => {
        const app = await start({
            // The style was once spelled cadenze: its key and the chosen style's name.
            cadenze_tuning: json({ fontScale: 1.4, widthRatio: 0.5, motionAmount: 1.2, glowIntensity: 0.7, beamIntensity: 0.9 }),
            visualizer_mode: 'cadenze',
            // Before the hold ratio was a number.
            fume_tuning: json({ hidePrintSymbols: true, textHoldStyle: 'dimmed', cameraSpeed: 1.2 }),
            // Before the monet background had a key of its own: its settings lay in the style's.
            monet_tuning: json({
                keywordColoringEnabled: false, showDescription: false, fontScale: 1.1,
                backgroundSource: 'uploaded-global', backgroundBlurPx: 30, backgroundOverlayOpacity: 0.5, backgroundGrayscale: 0.2,
                backgroundCropMode: 'cover', coverPaneRatio: 0.4, lyricsFocusScale: 1.1,
            }),
            // Before the geometry had kinds and the cloud had a density.
            diorama_tuning: json({ cameraSpeed: 1.1, showParticles: false, geometryVisibility: { enabled: false } }),
            // Fields that were added later are missing.
            classic_tuning: json({ enableWordRotation: false, breathingFloatMultiplier: 0.5 }),
            partita_tuning: json({ showGuideLines: false, staggerMin: 120, staggerMax: 30 }),
            pendolo_tuning: json({ arcRadius: 0.5, showGearDecor: 'subtle' }),
            sonnet_tuning: json({ cameraIntensity: 1.2, showGuide: false }),
            tempera_tuning: json({ cameraIntensity: 1.2, colorMode: 'duo' }),
            lumiere_tuning: json({ lightIntensity: 1.2, windowNeighbors: 2, anOldField: 3 }),
            cappella_tuning: json({ showEmoMessages: false }),
            tilt_tuning: json({ splitProbability: 0.5, tiltStyleProbability: 0.5 }),
            nomand_background_tuning: json({ imageSource: 'uploaded-global', ditheringType: '2x2', size: 4, colorSteps: 3 }),
            latent_background_tuning: json({ displayMode: 'both', ditheringSpeed: 0.5 }),
        });
        expect(app.held()).toMatchSnapshot();
    });

    it('prefers the new key where an old one is there as well', async () => {
        const app = await start({
            cadenza_tuning: json({ fontScale: 1.2 }),
            cadenze_tuning: json({ fontScale: 1.5 }),
            fume_tuning: json({ textHoldStyle: 'dimmed', textHoldRatio: 0.8 }),
            monet_background_tuning: json({ backgroundBlurPx: 12 }),
            monet_tuning: json({ backgroundBlurPx: 44, fontScale: 1.3 }),
        });
        const held = app.held();
        expect({ cadenza: held.cadenzaTuning, fume: held.fumeTuning, monetBackground: held.monetBackgroundTuning, monet: held.monetTuning }).toMatchSnapshot();
    });

    it('from values out of range, of the wrong kind, and of no known name', async () => {
        const app = await start({
            classic_tuning: json({ enableWordRotation: 'yes', breathingFloatMultiplier: 9, useLegacyLayout: 1, wordSpacing: -3 }),
            cadenza_tuning: json({ fontScale: 99, widthRatio: 'wide', motionAmount: null, glowIntensity: -1, beamIntensity: 5 }),
            partita_tuning: json({ showGuideLines: 0, useSemanticLayout: 'no', staggerMin: 500, staggerMax: -20 }),
            fume_tuning: json({
                hidePrintSymbols: 'x', backgroundObjectOpacity: 7, textHoldRatio: -1, cameraTrackingMode: 'fast',
                cameraSpeed: 0, glowIntensity: 9, heroScale: 0.1, textHoldStyle: 'standard',
            }),
            claddagh_tuning: json({ focusScaleRatio: '0.8', radiusScale: 9, ellipseTiltDeg: -5, showAxisLine: 'no', letterSpacingOffset: 'wide' }),
            cappella_tuning: json({ showEmoMessages: 0, emojiPackSource: 'mine', avatarSource: 'photo' }),
            tilt_tuning: json({ splitProbability: 4, tiltStyleProbability: -1, colorScheme: 'rainbow' }),
            diorama_tuning: json({
                cameraSpeed: 9, motionAmount: 0, audioReactivity: -2, particleDensity: 1, particleScale: 99, particleGlowIntensity: 99,
                glowIntensity: 0, soulIntensity: 9, gradientIntensity: -1, geometryVisibility: { mode: 'corridor', rings: false },
            }),
            monet_tuning: json({ audioStyle: 'bars', audioPlacement: 'invalid', audioGain: 8, fontScale: 4, portraitSource: 'mine', portraitOffsetX: 80, portraitStyle: 'round' }),
            pendolo_tuning: json({
                arcRadius: 5, arcAngleDeg: '90', wheelCenterX: -9, wheelCenterY: null, tickSnappiness: 0, activeScale: 9,
                showGearDecor: 'huge', showCenterGradient: 'yes', showCoverOnWatchFace: 1, enableLineGlow: null,
            }),
            sonnet_tuning: json({
                cameraIntensity: 9, typographyMotion: -1, mgDensity: '1', showOnlyText: 1, outerFrameMode: 'thick',
                textureResolution: 0.1, postProcessGrain: 4, postProcessVignette: 9, postProcessLensDispersion: -2,
            }),
            tempera_tuning: json({
                cameraIntensity: 9, glyphMotion: -1, wholeLineLyrics: 'yes', glyphSettleStretch: 4, colorMode: 'rainbow',
                layerImages: [
                    { id: 'kept', name: 7, align: 'middle', verticalAlign: 'free', scale: 9, opacity: -1 },
                    { name: 'no id' }, null, 'text', { id: '' },
                    ...Array.from({ length: 12 }, (_, index) => ({ id: `more-${index}` })),
                ],
                layerImageDepth: 'middle', layerImageFrequency: 3, textureResolution: 99, postProcessLensDistortion: 9,
            }),
            lumiere_tuning: json({
                lightIntensity: 9, audioResponse: -1, fogDensity: '1', unlitOpacity: 0, windowNeighbors: 3, fogOctaves: 4.6,
                lineArt: 'yes', themeColorMix: 4, renderQuality: 'ultra',
            }),
            monet_background_tuning: json({
                backgroundSource: 'web', backgroundLayout: 'tiles', backgroundBlurPx: 999, backgroundOverlayOpacity: -1,
                backgroundGrayscale: 4, backgroundSaturation: 9, backgroundWash: 'x', backgroundHalfPaneOffsetX: -999,
                backgroundWashColorMode: 'auto', backgroundWashCustomColor: 'AABBCC', backgroundDriftStrength: 9,
            }),
            nomand_background_tuning: json({
                imageSource: 'web', effect: 'blur', ditheringType: '16x16', size: 999, colorSteps: 4.6, flutedGlassSize: 0,
                halftoneDotsRadius: 9, lensDistortionBulge: -9, overlayEnabled: 'yes', overlayOpacity: 4,
            }),
            latent_background_tuning: json({
                displayMode: 'stars', colorSource: 'theme', dynamicOnlyInPlayer: 1, ditheringSpeed: 9, ditheringSize: 0,
                ditheringOpacity: -1, meshSwirl: 4, overlayEnabled: null, overlayOpacity: '0.5',
            }),
            sora_background_tuning: json({ blank: 'yes' }),
            visualizer_mode: 'mod:someone:style',
            visualizer_background_mode: 'mod:someone:background',
            background_opacity: 'dark',
            visualizer_opacity: '7',
            url_background_list: json([{ id: 'ok', url: 'example.com' }, { id: '', url: 'https://x.test' }, { id: 'bad', url: 'ftp://x.test' }, 5, null]),
            url_background_selected_id: '',
        });
        expect(app.held()).toMatchSnapshot();
    });

    const BROKEN_TEXTS = [
        ['text that is not JSON', '{"cut off'],
        ['the JSON null', 'null'],
        ['a JSON number', '5'],
        ['a JSON list', '[1,2]'],
        ['a JSON text', '"words"'],
        ['an empty text', ''],
    ];

    it.each(BROKEN_TEXTS)('from %s under every key', async (_name, text) => {
        const app = await start({ ...everywhere(text), url_background_list: text });
        expect(app.held()).toMatchSnapshot();
    });

    // The two keys of an earlier version: cadenze_tuning (the style's old spelling) and
    // monet_tuning, which once held the monet background's settings too.
    it.each(BROKEN_TEXTS)('from %s under an older key, and beside a good one', async (_name, text) => {
        const read = async (stored: Stored) => {
            const held = (await start(stored)).held();
            return { cadenza: held.cadenzaTuning, monet: held.monetTuning, monetBackground: held.monetBackgroundTuning };
        };
        expect({
            underTheOlderKeysAlone: await read({ cadenze_tuning: text, monet_tuning: text }),
            underTheNewKeysBesideGoodOlderOnes: await read({
                cadenza_tuning: text, cadenze_tuning: json({ fontScale: 1.4 }),
                monet_background_tuning: text, monet_tuning: json({ fontScale: 1.1, backgroundBlurPx: 30 }),
            }),
            underTheOlderKeysBesideGoodNewOnes: await read({
                cadenza_tuning: json({ fontScale: 1.2 }), cadenze_tuning: text,
                monet_background_tuning: json({ backgroundBlurPx: 12 }), monet_tuning: text,
            }),
        }).toMatchSnapshot();
    });
});

// The store's names for each key: the field that holds the tuning and the two actions.
const UNITS: Array<{ key: string; field: string; set: string; reset: string; patches: object[] }> = [
    { key: 'classic_tuning', field: 'classicTuning', set: 'handleSetClassicTuning', reset: 'handleResetClassicTuning', patches: [{ wordSpacing: 1.3 }, { breathingFloatMultiplier: 9, wordSpacing: -4 }, { enableWordRotation: false, useLegacyLayout: true }, { breathingFloatMultiplier: Number.NaN }] },
    { key: 'cadenza_tuning', field: 'cadenzaTuning', set: 'handleSetCadenzaTuning', reset: 'handleResetCadenzaTuning', patches: [{ fontScale: 1.3 }, { beamIntensity: 0.7, glowIntensity: 99 }] },
    { key: 'partita_tuning', field: 'partitaTuning', set: 'handleSetPartitaTuning', reset: 'handleResetPartitaTuning', patches: [{ staggerMin: 60 }, { staggerMin: 170, staggerMax: 30 }, { staggerMax: 999, showGuideLines: false }, { staggerMin: Number.NaN }] },
    { key: 'fume_tuning', field: 'fumeTuning', set: 'handleSetFumeTuning', reset: 'handleResetFumeTuning', patches: [{ heroScale: 1.1 }, { cameraSpeed: 9, glowIntensity: -1, backgroundObjectOpacity: 4, textHoldRatio: 0.25 }, { cameraTrackingMode: 'stepped', hidePrintSymbols: true }, { cameraTrackingMode: 'fast' }] },
    { key: 'claddagh_tuning', field: 'claddaghTuning', set: 'handleSetCladdaghTuning', reset: 'handleResetCladdaghTuning', patches: [{ radiusScale: 1.3 }, { focusScaleRatio: 9, ellipseTiltDeg: -3, letterSpacingOffset: 99 }, { showAxisLine: false }] },
    { key: 'cappella_tuning', field: 'cappellaTuning', set: 'handleSetCappellaTuning', reset: 'handleResetCappellaTuning', patches: [{ showEmoMessages: false }, { avatarSource: 'color' }, { avatarSource: 'photo' }, { emojiPackSource: 'custom' }] },
    { key: 'tilt_tuning', field: 'tiltTuning', set: 'handleSetTiltTuning', reset: 'handleResetTiltTuning', patches: [{ splitProbability: 0.2 }, { splitProbability: 4, tiltStyleProbability: -1 }, { colorScheme: 'primaryAll' }] },
    { key: 'diorama_tuning', field: 'dioramaTuning', set: 'handleSetDioramaTuning', reset: 'handleResetDioramaTuning', patches: [{ cameraSpeed: 1.2 }, { geometryVisibility: { rings: false } }, { particleDensity: 1, particleScale: 99, glowIntensity: 0 }, { showParticles: false, soulEnabled: false }] },
    { key: 'monet_tuning', field: 'monetTuning', set: 'handleSetMonetTuning', reset: 'handleResetMonetTuning', patches: [{ fontScale: 1.2, audioPlacement: 'lyrics', audioGain: 1.5 }, { fontScale: 9, portraitOffsetX: 50, audioStyle: 'bars', audioGain: 8 }, { portraitSource: 'custom', portraitStyle: 'rectangular', showDescription: false }] },
    { key: 'pendolo_tuning', field: 'pendoloTuning', set: 'handleSetPendoloTuning', reset: 'handleResetPendoloTuning', patches: [{ arcRadius: 0.5 }, { arcRadius: 9, arcAngleDeg: 1, tickSnappiness: 0, activeScale: 9 }, { showGearDecor: 'none', enableLineGlow: true }, { showGearDecor: 'huge', wheelCenterX: '0.2' }] },
    { key: 'sonnet_tuning', field: 'sonnetTuning', set: 'handleSetSonnetTuning', reset: 'handleResetSonnetTuning', patches: [{ cameraIntensity: 1.3 }, { cameraIntensity: 9, textureResolution: 0.1, postProcessGrain: 4 }, { outerFrameMode: 'none', showOnlyText: true, showGuide: false }, { outerFrameMode: 'thick', mgDensity: '2' }] },
    { key: 'tempera_tuning', field: 'temperaTuning', set: 'handleSetTemperaTuning', reset: 'handleResetTemperaTuning', patches: [{ glyphMotion: 1.3 }, { cameraIntensity: 9, layerImageFrequency: 4, textureResolution: 99 }, { colorMode: 'duo', layerImageDepth: 'front', wholeLineLyrics: true }, { layerImages: [{ id: 'p', name: 'P', align: 'free', verticalAlign: 'bottom', scale: 9, opacity: 0.5 }, { name: 'no id' }] }, { colorMode: 'rainbow', layerImageDepth: 'middle' }] },
    { key: 'lumiere_tuning', field: 'lumiereTuning', set: 'handleSetLumiereTuning', reset: 'handleResetLumiereTuning', patches: [{ lightIntensity: 1.4 }, { lightIntensity: 9, fogOctaves: 4.6, unlitOpacity: 0 }, { renderQuality: 'low', hideTrails: true, windowNeighbors: 2 }, { renderQuality: 'ultra', windowNeighbors: 3 }] },
    { key: 'monet_background_tuning', field: 'monetBackgroundTuning', set: 'handleSetMonetBackgroundTuning', reset: 'handleResetMonetBackgroundTuning', patches: [{ backgroundBlurPx: 20 }, { backgroundBlurPx: 999, backgroundSaturation: -1, backgroundHalfPaneOffsetX: 99 }, { backgroundLayout: 'half-pane-gradient', backgroundWashColorMode: 'custom', backgroundWashCustomColor: 'AABBCC' }, { backgroundWashCustomColor: 'red', backgroundSource: 'web' }] },
    { key: 'nomand_background_tuning', field: 'nomandBackgroundTuning', set: 'handleSetNomandBackgroundTuning', reset: 'handleResetNomandBackgroundTuning', patches: [{ size: 5 }, { size: 999, colorSteps: 4.6, halftoneDotsRadius: 9, lensDistortionBulge: -9 }, { effect: 'paper-texture', ditheringType: '2x2', overlayEnabled: true }, { effect: 'blur', overlayOpacity: 4 }] },
    { key: 'latent_background_tuning', field: 'latentBackgroundTuning', set: 'handleSetLatentBackgroundTuning', reset: 'handleResetLatentBackgroundTuning', patches: [{ meshSpeed: 1.2 }, { ditheringSize: 99, ditheringOpacity: -1, meshSwirl: 4 }, { displayMode: 'dithering', colorSource: 'cover-only', enhancedBeatResponse: true }, { displayMode: 'stars' }] },
    { key: 'sora_background_tuning', field: 'soraBackgroundTuning', set: 'handleSetSoraBackgroundTuning', reset: 'handleResetSoraBackgroundTuning', patches: [{ blank: true }, { blank: 'yes' }, {}] },
];

describe('what is written', () => {
    it.each(UNITS)('by a change and by a reset of $key', async ({ key, field, set, reset, patches }) => {
        const steps: unknown[] = [];
        for (const [from, stored] of [['nothing stored', {}], ['the current shape', { [key]: json(CURRENT[key]) }]] as const) {
            const app = await start(stored);
            const before = app.keys();
            for (const patch of patches) {
                (app.state()[set] as (patch: object) => void)(patch);
                steps.push({ from, patch: json(patch), written: app.text(key) });
                // What is held is what was written.
                expect(json(app.state()[field])).toBe(app.text(key));
            }
            (app.state()[reset] as () => void)();
            steps.push({ from, reset: true, written: app.text(key) });
            expect(app.text(key)).toBe(json(DEFAULTS[key]));
            expect(json(app.state()[field])).toBe(app.text(key));
            // No other key is touched.
            expect(app.keys()).toEqual([...new Set([...before, key])].sort());
        }
        expect(steps).toMatchSnapshot();
    });

    // The notice a reset shows, by the key of what was reset. 天空 (sora) shows none.
    const RESET_NOTICES: Record<string, string | null> = {
        classic_tuning: 'notifications.classicReset', cadenza_tuning: 'notifications.cadenzaReset', partita_tuning: 'notifications.partitaReset',
        fume_tuning: 'notifications.fumeReset', claddagh_tuning: 'notifications.claddaghReset', cappella_tuning: 'notifications.cappellaReset',
        tilt_tuning: 'notifications.tiltReset', diorama_tuning: 'notifications.dioramaReset', monet_tuning: 'notifications.monetReset',
        pendolo_tuning: 'notifications.pendoloReset', sonnet_tuning: 'notifications.sonnetReset', tempera_tuning: 'notifications.temperaReset',
        lumiere_tuning: 'notifications.lumiereReset', monet_background_tuning: 'notifications.monetBgReset',
        nomand_background_tuning: 'notifications.nomandBgReset', latent_background_tuning: 'notifications.latentBgReset',
        sora_background_tuning: null,
    };

    it('a reset says what was reset; a change says nothing', async () => {
        const app = await start({});
        for (const { key, set, reset, patches } of UNITS) {
            app.clearNotice();
            (app.state()[set] as (patch: object) => void)(patches[0]);
            expect([key, app.notice()]).toEqual([key, null]);
            (app.state()[reset] as () => void)();
            const noticeKey = RESET_NOTICES[key];
            expect([key, app.notice()]).toEqual([key, noticeKey ? { type: 'info', text: app.t(noticeKey) } : null]);
            // The notice is a sentence of the locale files, not its own key.
            if (noticeKey) expect(app.t(noticeKey)).not.toBe(noticeKey);
        }
    });

    it('nothing by an upload of the listener\'s own picture: the picture is held, no key is written', async () => {
        const app = await start({});
        const picture = new File(['x'], 'picture.png', { type: 'image/png' });
        const notes = new File(['x'], 'notes.txt', { type: 'text/plain' });
        const answers: Record<string, boolean[]> = {};
        for (const action of ['handleUploadMonetBackgroundImage', 'handleUploadMonetPortraitImage', 'handleImportCustomCappellaEmojiPack', 'handleImportCustomCappellaAvatar']) {
            const upload = app.state()[action] as unknown as (files: File[]) => Promise<{ ok: boolean }>;
            answers[action] = [(await upload([])).ok, (await upload([notes])).ok, (await upload([picture])).ok];
        }
        // No file and a file that is no picture are refused; a picture is taken.
        expect(answers).toEqual({
            handleUploadMonetBackgroundImage: [false, false, true],
            handleUploadMonetPortraitImage: [false, false, true],
            handleImportCustomCappellaEmojiPack: [false, false, true],
            handleImportCustomCappellaAvatar: [false, false, true],
        });
        const assets = app.assets.getState() as unknown as { storedMonetPortraitImage: unknown; storedCappellaEmojiPack: unknown[] };
        expect(assets.storedMonetPortraitImage).toBeTruthy();
        expect(assets.storedCappellaEmojiPack).toHaveLength(1);
        expect(app.keys()).toEqual([]);
    });

    it('keeps the custom emoji choice of 群唱 only while a custom pack is there', async () => {
        const app = await start({});
        app.assets.setState({ storedCappellaEmojiPack: [{ id: 'e', name: 'e', type: 'image/png' }] } as never);
        (app.state().handleSetCappellaTuning as (patch: object) => void)({ emojiPackSource: 'custom' });
        expect(app.text('cappella_tuning')).toBe(json({ ...DEFAULT_CAPPELLA_TUNING, emojiPackSource: 'custom' }));
        app.assets.setState({ storedCappellaEmojiPack: [] } as never);
        (app.state().handleSetCappellaTuning as (patch: object) => void)({ emojiPackSource: 'custom' });
        expect(app.text('cappella_tuning')).toBe(json(DEFAULT_CAPPELLA_TUNING));
    });

    it('when an uploaded picture is cleared: the setting that named it falls back, and only then is anything written', async () => {
        const app = await start({
            monet_background_tuning: json(CURRENT.monet_background_tuning),
            monet_tuning: json(CURRENT.monet_tuning),
            cappella_tuning: json({ showEmoMessages: false, emojiPackSource: 'custom', avatarSource: 'custom' }),
        });
        const clear = async (action: string) => (app.state()[action] as () => Promise<void>)();
        await clear('handleClearMonetBackgroundImage');
        await clear('handleClearMonetPortraitImage');
        await clear('handleClearCustomCappellaEmojiPack');
        const afterEmoji = app.text('cappella_tuning');
        await clear('handleClearCustomCappellaAvatar');
        expect({
            monetBackground: app.text('monet_background_tuning'),
            monet: app.text('monet_tuning'),
            cappellaAfterEmoji: afterEmoji,
            cappella: app.text('cappella_tuning'),
        }).toMatchSnapshot();

        // Nothing named an uploaded picture: nothing is written.
        const plain = await start({});
        for (const action of ['handleClearMonetBackgroundImage', 'handleClearMonetPortraitImage', 'handleClearCustomCappellaEmojiPack', 'handleClearCustomCappellaAvatar']) {
            await (plain.state()[action] as () => Promise<void>)();
        }
        expect(plain.keys()).toEqual([]);
    });

    it('for the chosen style, the chosen background, the opacities, the two switches of the common background and the web pages', async () => {
        const app = await start({});
        const act = (name: string, ...args: unknown[]) => (app.state()[name] as (...all: unknown[]) => void)(...args);
        const stored = () => Object.fromEntries(app.keys().map(key => [key, app.text(key)]));
        const steps: unknown[] = [];
        const step = (name: string, ...args: unknown[]) => {
            act(name, ...args);
            steps.push({ action: name, args: json(args), stored: stored() });
        };
        step('handleSetVisualizerMode', 'partita', { notify: false });
        step('handleSetVisualizerBackgroundMode', 'nomand');
        step('handleResetVisualizerBackgroundMode');
        step('handleSetBackgroundOpacity', 0.4);
        step('handleSetVisualizerOpacity', 0.05);
        step('handleSetVisualizerOpacity', 0.8);
        step('handleToggleDisableVisualizerVignette', true);
        step('handleToggleDisableVisualizerGeometricBackground', true);
        step('handleToggleDisableVisualizerVignette', false);
        step('handleAddUrlBackgroundItem', { id: 'one', url: 'example.com/a', note: ' First ' });
        step('handleAddUrlBackgroundItem', { id: 'two', url: 'https://example.com/b', note: '' });
        step('handleAddUrlBackgroundItem', { id: '', url: 'https://example.com/c' });
        step('handleSetUrlBackgroundSelectedId', 'two');
        step('handleUpdateUrlBackgroundItem', 'one', { note: 'Renamed' });
        step('handleUpdateUrlBackgroundItem', 'one', { url: 'not a url ://' });
        step('handleDeleteUrlBackgroundItem', 'two');
        step('handleDeleteUrlBackgroundItem', 'one');
        step('handleSetUrlBackgroundList', [{ id: 'x', url: 'https://example.com/x', note: 'X' }, { id: '', url: 'nope' }]);
        step('handleSetUrlBackgroundSelectedId', 'x');
        step('handleSetUrlBackgroundList', [{ id: 'y', url: 'https://example.com/y', note: 'Y' }]);
        step('handleSetUrlBackgroundSelectedId', null);
        expect(steps).toMatchSnapshot();
        expect(app.held()).toMatchSnapshot();
    });
});
