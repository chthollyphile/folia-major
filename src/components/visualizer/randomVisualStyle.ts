import { VISUALIZER_REGISTRY } from './registry';
import { VISUALIZER_BACKGROUND_REGISTRY } from './backgrounds/registry';
import { useDesktopSettingsStore } from '../../stores/useDesktopSettingsStore';
import { resolveReducedMotion, useMotionSettingsStore } from '../../stores/useMotionSettingsStore';
import { useThemeSettingsStore } from '../../stores/useThemeSettingsStore';
import { useTypographySettingsStore } from '../../stores/useTypographySettingsStore';
import { useVisualizerAssetStore } from '../../stores/useVisualizerAssetStore';
import { useVisualizerSettingsStore } from '../../stores/useVisualizerSettingsStore';
import type { RandomVisualStyleOptions } from '../../types/randomVisualStyle';
import { getRandomLyricsStyleCandidates } from '../../utils/randomLyricsStyle';
import { chooseVisualStyleValue, randomizeVisualStyleTunings, randomVisualStyleNumber } from '../../utils/randomVisualStyle';

// src/components/visualizer/randomVisualStyle.ts
// A manual draw becomes ordinary persisted settings, unchanged by later song transitions.

/** Randomize renderer settings, optionally including common appearance and shell backgrounds. */
export const randomizeVisualStyle = ({ scope = 'lyrics', random = Math.random, preferredMode }: RandomVisualStyleOptions = {}): void => {
    const state = useVisualizerSettingsStore.getState();
    if (state.randomVisualizerModePerSong) state.handleToggleRandomVisualizerModePerSong(false);
    const assets = useVisualizerAssetStore.getState();
    const tuning = randomizeVisualStyleTunings(state, scope, random);
    const context = {
        availableModes: VISUALIZER_REGISTRY.map(entry => entry.mode),
        currentMode: state.visualizerMode,
        wallpaperMode: useDesktopSettingsStore.getState().wallpaperMode,
        reducedMotion: resolveReducedMotion(useMotionSettingsStore.getState(), 'uiMicroMotion'),
    };
    const compatible = getRandomLyricsStyleCandidates({ ...context, avoidCurrent: false });
    const candidates = getRandomLyricsStyleCandidates(context);
    const mode = preferredMode && compatible.includes(preferredMode) ? preferredMode
        : candidates.length ? chooseVisualStyleValue(candidates, random) : state.visualizerMode;
    state.handleSetVisualizerMode(mode, { notify: false });
    state.handleSetClassicTuning(tuning.classicTuning);
    state.handleSetCadenzaTuning(tuning.cadenzaTuning);
    state.handleSetPartitaTuning(tuning.partitaTuning);
    state.handleSetFumeTuning(tuning.fumeTuning);
    state.handleSetCladdaghTuning(tuning.claddaghTuning);
    state.handleSetCappellaTuning({
        ...tuning.cappellaTuning,
        emojiPackSource: assets.storedCappellaEmojiPack.length ? chooseVisualStyleValue(['builtin', 'custom'] as const, random) : 'builtin',
        avatarSource: chooseVisualStyleValue(assets.storedCappellaAvatarPack.length
            ? ['cover', 'builtin', 'color', 'custom'] as const : ['cover', 'builtin', 'color'] as const, random),
    });
    state.handleSetTiltTuning(tuning.tiltTuning);
    state.handleSetDioramaTuning(tuning.dioramaTuning);
    state.handleSetMonetTuning({
        ...tuning.monetTuning,
        portraitSource: assets.storedMonetPortraitImage ? chooseVisualStyleValue(['cover', 'custom'] as const, random) : 'cover',
    });
    state.handleSetPendoloTuning(tuning.pendoloTuning);
    state.handleSetSonnetTuning(tuning.sonnetTuning);
    state.handleSetTemperaTuning(tuning.temperaTuning);
    state.handleSetLumiereTuning(tuning.lumiereTuning);
    if (scope === 'lyrics') return;

    const backgrounds = VISUALIZER_BACKGROUND_REGISTRY.map(entry => entry.mode)
        .filter(background => background !== 'url' || state.urlBackgroundList.length > 0);
    if (backgrounds.length) state.handleSetVisualizerBackgroundMode(chooseVisualStyleValue(backgrounds, random));
    state.handleSetVisualizerOpacity(randomVisualStyleNumber(0.75, 1, random));
    state.handleSetBackgroundOpacity(randomVisualStyleNumber(0.45, 0.85, random));
    state.handleToggleDisableVisualizerVignette(random() < 0.5);
    state.handleToggleDisableVisualizerGeometricBackground(random() < 0.5);
    if (state.urlBackgroundList.length) state.handleSetUrlBackgroundSelectedId(chooseVisualStyleValue(state.urlBackgroundList, random).id);
    const backgroundSource = assets.storedMonetBackgroundImage
        ? chooseVisualStyleValue(['cover-derived', 'uploaded-global'] as const, random) : 'cover-derived';
    state.handleSetMonetBackgroundTuning({ ...tuning.monetBackgroundTuning, backgroundSource });
    state.handleSetNomandBackgroundTuning({ ...tuning.nomandBackgroundTuning, imageSource: backgroundSource });
    state.handleSetLatentBackgroundTuning(tuning.latentBackgroundTuning);
    state.handleSetSoraBackgroundTuning(tuning.soraBackgroundTuning);
    const typography = useTypographySettingsStore.getState();
    typography.handleSetLyricsFontStyle(chooseVisualStyleValue(['sans', 'serif', 'mono'] as const, random));
    typography.handleSetLyricsFontScale(chooseVisualStyleValue([0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2], random));
    typography.handleSetLyricsFontWeight(chooseVisualStyleValue([null, 300, 400, 500, 600, 700], random));
    // Keep font uploads, URL entries and image contents; only appearance choices change.
    useThemeSettingsStore.getState().handleToggleCoverColorBg(random() < 0.5);
};
