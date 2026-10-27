import type { LatentBackgroundTuning, MonetBackgroundTuning, VisualizerBackgroundMode, VisualizerMode } from '../../types';
import i18n from '../../i18n/config';
import { VISUALIZER_REGISTRY, hasVisualizerMode } from '../../components/visualizer/registry';
import { VISUALIZER_BACKGROUND_REGISTRY, hasVisualizerBackgroundMode } from '../../components/visualizer/backgrounds/registry';
import { DEFAULT_VISUALIZER_BACKGROUND_MODE, DEFAULT_VISUALIZER_MODE } from '../../types/visualizerModes';
import { useVisualizerSettingsStore } from '../../stores/useVisualizerSettingsStore';
import { useVideoLayerSettingsStore } from '../../stores/useVideoLayerSettingsStore';
import { useThemeSettingsStore } from '../../stores/useThemeSettingsStore';
import { ControlError, optionalBoolean, requireString } from '../errors';
import type { ControlHandler } from '../types';

// src/control/handlers/visualizer.ts
// Lyric visualizers, backgrounds and their tuning, smart beat, the video layer, and appearance.

const modeLabel = (labelKey: string, labelFallback: string): string => {
    const translated = i18n.t(labelKey);
    return !translated || translated === labelKey ? labelFallback : translated;
};

export const visualizerHandlers: Record<string, ControlHandler> = {
    folia_visualizer_list: () => {
        const state = useVisualizerSettingsStore.getState();
        return {
            visualizers: VISUALIZER_REGISTRY.map(entry => ({
                mode: entry.mode,
                label: modeLabel(entry.labelKey, entry.labelFallback),
                labelKey: entry.labelKey,
                order: entry.order,
                hasCommand: Boolean(entry.command),
                isCurrent: entry.mode === state.visualizerMode,
            })),
            backgrounds: VISUALIZER_BACKGROUND_REGISTRY.map(entry => ({
                mode: entry.mode,
                label: modeLabel(entry.labelKey, entry.labelFallback),
                labelKey: entry.labelKey,
                order: entry.order,
                hasCommand: Boolean(entry.command),
                isCurrent: entry.mode === state.visualizerBackgroundMode,
            })),
            current: {
                mode: state.visualizerMode,
                background: state.visualizerBackgroundMode,
                randomPerSong: state.randomVisualizerModePerSong,
            },
            defaults: {
                mode: DEFAULT_VISUALIZER_MODE,
                background: DEFAULT_VISUALIZER_BACKGROUND_MODE,
            },
        };
    },

    folia_visualizer_set: (args, deps) => {
        const mode = requireString(args.mode, 'mode');
        if (!hasVisualizerMode(mode)) {
            throw new ControlError('bad_request', `Unknown visualizer mode "${mode}"`, {
                modes: VISUALIZER_REGISTRY.map(entry => entry.mode),
            });
        }
        deps.context.visualizer.setVisualizerMode(mode as VisualizerMode);
        const state = useVisualizerSettingsStore.getState();
        return { mode: state.visualizerMode, randomPerSong: state.randomVisualizerModePerSong };
    },

    folia_background_set: (args, deps) => {
        const mode = requireString(args.mode, 'mode');
        if (!hasVisualizerBackgroundMode(mode)) {
            throw new ControlError('bad_request', `Unknown background mode "${mode}"`, {
                modes: VISUALIZER_BACKGROUND_REGISTRY.map(entry => entry.mode),
            });
        }
        deps.context.visualizer.setVisualizerBackgroundMode(mode as VisualizerBackgroundMode);
        return { background: useVisualizerSettingsStore.getState().visualizerBackgroundMode };
    },

    folia_visual_tuning: (args, deps) => {
        const target = requireString(args.target, 'target');
        if (target !== 'monet' && target !== 'latent') {
            throw new ControlError('bad_request', '"target" must be "monet" or "latent"');
        }
        if (typeof args.patch !== 'object' || args.patch === null || Array.isArray(args.patch)) {
            throw new ControlError('bad_request', '"patch" must be a JSON object');
        }
        const patch = args.patch as Record<string, unknown>;
        const state = useVisualizerSettingsStore.getState();
        if (target === 'monet') {
            deps.context.visualizer.setMonetBackgroundTuning(patch as Partial<MonetBackgroundTuning>);
            return { target, tuning: useVisualizerSettingsStore.getState().monetBackgroundTuning };
        }
        deps.context.visualizer.setLatentBackgroundTuning(patch as Partial<LatentBackgroundTuning>);
        return { target, tuning: useVisualizerSettingsStore.getState().latentBackgroundTuning, previous: state.latentBackgroundTuning };
    },

    folia_smart_beat: (args) => {
        const enabled = optionalBoolean(args.enabled, 'enabled');
        if (enabled !== undefined) {
            useVisualizerSettingsStore.getState().handleSetSmartBeat({ mode: enabled ? 'on' : 'off' });
        }
        const { smartBeat } = useVisualizerSettingsStore.getState();
        return { enabled: smartBeat.mode !== 'off', mode: smartBeat.mode };
    },

    folia_video_layer: async (args) => {
        const enabled = optionalBoolean(args.enabled, 'enabled');
        const pickFile = optionalBoolean(args.pickFile, 'pickFile');
        if (enabled !== undefined) {
            useVideoLayerSettingsStore.getState().setVideoLayerEnabled(enabled);
        }
        let pickedFile: string | null = null;
        if (pickFile === true) {
            try {
                pickedFile = await useVideoLayerSettingsStore.getState().pickLocalFile();
            } catch (error) {
                throw new ControlError('playback_failed', 'The video file picker failed', {
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        }
        const state = useVideoLayerSettingsStore.getState();
        return {
            enabled: state.videoLayerEnabled,
            localFileName: state.localFileName,
            localFileStatus: state.localFileStatus,
            pickedFile,
        };
    },

    folia_appearance: (args, deps) => {
        const daylight = optionalBoolean(args.daylight, 'daylight');
        const followSystemTheme = optionalBoolean(args.followSystemTheme, 'followSystemTheme');
        const coverColorBg = optionalBoolean(args.coverColorBg, 'coverColorBg');
        const staticMode = optionalBoolean(args.staticMode, 'staticMode');
        const disableHomeDynamicBackground = optionalBoolean(
            args.disableHomeDynamicBackground,
            'disableHomeDynamicBackground',
        );
        const generateAITheme = optionalBoolean(args.generateAITheme, 'generateAITheme');
        const openThemeEditor = optionalBoolean(args.openThemeEditor, 'openThemeEditor');

        const theme = useThemeSettingsStore.getState();
        if (daylight !== undefined) theme.setDaylightPreference(daylight);
        if (followSystemTheme !== undefined) theme.setFollowSystemTheme(followSystemTheme);
        if (coverColorBg !== undefined) theme.handleToggleCoverColorBg(coverColorBg);
        if (staticMode !== undefined) theme.handleToggleStaticMode(staticMode);
        if (disableHomeDynamicBackground !== undefined) {
            theme.handleToggleDisableHomeDynamicBackground(disableHomeDynamicBackground);
        }

        let generatedTheme = false;
        if (generateAITheme === true) {
            if (!deps.context.settings.canGenerateAITheme) {
                throw new ControlError('unavailable', 'AI theme generation is not available right now');
            }
            deps.context.settings.generateAITheme();
            generatedTheme = true;
        }
        let openedThemeEditor = false;
        if (openThemeEditor === true) {
            if (!deps.context.settings.canOpenThemeQuickEditor) {
                throw new ControlError('unavailable', 'The theme quick editor cannot open right now');
            }
            deps.context.settings.openThemeQuickEditor();
            openedThemeEditor = true;
        }

        const after = useThemeSettingsStore.getState();
        return {
            daylight: after.isDaylight,
            followSystemTheme: after.followSystemTheme,
            coverColorBg: after.useCoverColorBg,
            staticMode: after.staticMode,
            disableHomeDynamicBackground: after.disableHomeDynamicBackground,
            canGenerateAITheme: deps.context.settings.canGenerateAITheme,
            isGeneratingTheme: deps.context.settings.isGeneratingTheme,
            themeGenerationSource: deps.context.settings.themeGenerationSource,
            generatedTheme,
            openedThemeEditor,
        };
    },
};
