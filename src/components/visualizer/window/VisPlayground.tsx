import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Pause, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import VisualizerRenderer from '../VisualizerRenderer';
import { type StoredCustomLyricsFont, type SubtitleContentMode, type SubtitleOverlayLayout, type Theme, type VisualizerMode } from '../../../types';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { selectVisualizerSettingsSnapshot, useVisualizerSettingsStore } from '../../../stores/useVisualizerSettingsStore';
import { PictureGrid, Tooltip } from '../../modal/settings/kit';
import { kitTransition, useKitReducedMotion } from '../../modal/settings/kit/motion';
import StudioWindow from '../../shared/StudioWindow';
import { visualizersRegistry } from '@/mods/folium/registries/visualizers';
import { useFoliumRegistryEntries } from '@/mods/runtime/registry';
import { colorWithAlpha } from '../colorMix';
import { type PreviewPlaceholderId } from '../PreviewPlaceholder';
import { VISUALIZER_REGISTRY, getVisualizerModeLabel, getVisualizerRegistryEntry } from '../registry';
import VisPlaygroundPreviewHotspots, { type VisPlaygroundEditSection, type VisPlaygroundHotspotSection } from './VisPlaygroundPreviewHotspots';
import VisPlaygroundSampleStage, { SampleBox } from './VisPlaygroundSampleStage';
import VisPlaygroundSettingsPanel from './VisPlaygroundSettingsPanel';
import FontPicker, { type LocalFontEntry } from './FontPicker';
import { useTuningDrafts } from './useTuningDrafts';
import { useVisualizerStyleAssets } from '../useVisualizerStyleAssets';
import type { VisualizerBackgroundActions, VisualizerBackgroundConfig } from '../backgrounds/definition';
import { LyricPreviewProvider, type LyricPreviewLook } from '../preview/LyricPreviewContext';
import { drawLyricStyleChoice, RANDOM_VISUALIZER_CHOICE, selectLyricStyleChoice } from '../random/lyricStyleChoices';
import { usePreviewClock } from '../preview/usePreviewClock';
import PreviewSourceSwitch, { type PreviewSource } from '../preview/PreviewSourceSwitch';
import { useLivePreviewFeed } from '../preview/useLivePreviewFeed';
import { useStillClockPulse } from '../preview/stillClockPulse';
import { DEFAULT_SUBTITLE_OVERLAY_LAYOUT } from '../../../utils/lyrics/subtitleOverlayLayout';

interface VisPlaygroundProps {
    theme?: Theme;
    isDaylight: boolean;
    visualizerMode: VisualizerMode;
    initialEditSection?: VisPlaygroundEditSection;
    visualizerOpacity?: number;
    staticMode?: boolean;
    backgroundConfig?: VisualizerBackgroundConfig;
    backgroundActions?: VisualizerBackgroundActions;
    hideTranslationSubtitle?: boolean;
    showSubtitleTranslation?: boolean;
    subtitleContentMode?: SubtitleContentMode;
    subtitleOverlayLayout?: SubtitleOverlayLayout;
    subtitleOverlayOpacity?: number;
    subtitleOverlayBackground?: boolean;
    subtitleUpcomingLyricsBlur?: boolean;
    showHarmonySubtitle?: boolean;
    harmonySubtitleBackground?: boolean;
    fontStyle: Theme['fontStyle'];
    fontScale: number;
    subtitleFontScale?: number;
    fontWeight: number | null;
    customFontFamily: string | null;
    customFontLabel: string | null;
    fontFallbackFamilies?: string[];
    subtitleFontInheritsLyrics?: boolean;
    subtitleFontStyle?: Theme['fontStyle'];
    subtitleFontWeight?: number | null;
    subtitleFontFamily?: string | null;
    subtitleFontFallbackFamilies?: string[];
    onFontStyleChange: (fontStyle: Theme['fontStyle']) => void;
    onFontScaleChange: (fontScale: number) => void;
    onSubtitleFontScaleChange?: (fontScale: number) => void;
    onFontWeightChange: (fontWeight: number | null) => void;
    onCustomFontChange: (font: StoredCustomLyricsFont | null) => void;
    onUploadCustomFont?: (file: File) => Promise<{ ok: boolean; error?: string; }>;
    onFontFallbackFamiliesChange?: (families: string[]) => void;
    onSubtitleFontInheritsLyricsChange?: (inheritsLyrics: boolean) => void;
    onSubtitleFontStyleChange?: (fontStyle: Theme['fontStyle']) => void;
    onSubtitleFontWeightChange?: (fontWeight: number | null) => void;
    onSubtitleFontFamilyChange?: (fontFamily: string | null) => void;
    onSubtitleFontFallbackFamiliesChange?: (families: string[]) => void;
    onVisualizerModeChange?: (mode: VisualizerMode) => void;
    onVisualizerOpacityChange?: (opacity: number) => void;
    onToggleHideTranslationSubtitle?: (hidden: boolean) => void;
    onToggleShowSubtitleTranslation?: (shown: boolean) => void;
    onSubtitleContentModeChange?: (mode: SubtitleContentMode) => void;
    onSubtitleOverlayLayoutChange?: (layout: SubtitleOverlayLayout) => void;
    onSubtitleOverlayOpacityChange?: (opacity: number) => void;
    onToggleSubtitleOverlayBackground?: (enabled: boolean) => void;
    onToggleSubtitleUpcomingLyricsBlur?: (enabled: boolean) => void;
    onToggleShowHarmonySubtitle?: (enabled: boolean) => void;
    onToggleHarmonySubtitleBackground?: (enabled: boolean) => void;
    onClose: () => void;
}

interface PresetOption<T> {
    label: string;
    value: T;
}


const PREVIEW_THEME: Theme = {
    name: 'Preview Theme',
    backgroundColor: '#09090b',
    primaryColor: '#f4f4f5',
    accentColor: '#f4f4f5',
    secondaryColor: '#71717a',
    fontStyle: 'sans',
    animationIntensity: 'normal',
};

const FONT_SCALE_OPTIONS: PresetOption<number>[] = [
    { label: '90%', value: 0.9 },
    { label: '100%', value: 1 },
    { label: '110%', value: 1.1 },
    { label: '125%', value: 1.25 },
];

const FONT_WEIGHT_PRESETS = [
    { value: 300, labelKey: 'options.fontWeightThin' },
    { value: 400, labelKey: 'options.fontWeightRegular' },
    { value: 700, labelKey: 'options.fontWeightBold' },
] as const;


const clampFontScale = (value: number) => Math.min(1.4, Math.max(0.85, value));


/** How many pictures of lyric styles lie side by side under the sample: in the wide window, and where it is one column. */
const SHELF_COLUMNS = { wide: 7, narrow: 4 };

const VisPlayground: React.FC<VisPlaygroundProps> = ({
    theme,
    isDaylight,
    visualizerMode,
    initialEditSection = 'visualizer',
    visualizerOpacity = 1,
    staticMode = false,
    backgroundConfig,
    backgroundActions,
    hideTranslationSubtitle = false,
    showSubtitleTranslation = true,
    subtitleContentMode,
    subtitleOverlayLayout = DEFAULT_SUBTITLE_OVERLAY_LAYOUT,
    subtitleOverlayOpacity = 0.6,
    subtitleOverlayBackground = true,
    subtitleUpcomingLyricsBlur = true,
    showHarmonySubtitle = true,
    harmonySubtitleBackground = true,
    fontStyle,
    fontScale,
    subtitleFontScale = 1,
    fontWeight,
    customFontFamily,
    customFontLabel,
    fontFallbackFamilies = [],
    subtitleFontInheritsLyrics = true,
    subtitleFontStyle = 'sans',
    subtitleFontWeight = null,
    subtitleFontFamily = null,
    subtitleFontFallbackFamilies = [],
    onFontStyleChange,
    onFontScaleChange,
    onSubtitleFontScaleChange,
    onFontWeightChange,
    onCustomFontChange,
    onUploadCustomFont,
    onFontFallbackFamiliesChange,
    onSubtitleFontInheritsLyricsChange,
    onSubtitleFontStyleChange,
    onSubtitleFontWeightChange,
    onSubtitleFontFamilyChange,
    onSubtitleFontFallbackFamiliesChange,
    onVisualizerModeChange,
    onVisualizerOpacityChange,
    onToggleHideTranslationSubtitle,
    onToggleShowSubtitleTranslation,
    onSubtitleContentModeChange,
    onSubtitleOverlayLayoutChange,
    onSubtitleOverlayOpacityChange,
    onToggleSubtitleOverlayBackground,
    onToggleSubtitleUpcomingLyricsBlur,
    onToggleShowHarmonySubtitle,
    onToggleHarmonySubtitleBackground,
    onClose,
}) => {
    const resolvedSubtitleContentMode = subtitleContentMode
        ?? (showSubtitleTranslation ? 'translation' : 'none');
    const { t } = useTranslation();
    const backgroundOpacity = backgroundConfig?.common?.opacity ?? 0.75;
    const [previewPlaceholderId, setPreviewPlaceholderId] = useState<PreviewPlaceholderId>('default');
    const [isPreviewPaused, setIsPreviewPaused] = useState(false);
    const [previewSource, setPreviewSource] = useState<PreviewSource>('builtin');
    const previewBoxRef = useRef<HTMLDivElement>(null);
    // What the player shows now, when the sample is set aside for it; null while it has no lyrics.
    const livePreview = useLivePreviewFeed({ enabled: previewSource === 'live', paused: isPreviewPaused, stageRef: previewBoxRef });
    const live = livePreview.content;
    // The small pictures still use the sample's clock while the big preview shows the live picture.
    const previewClock = usePreviewClock({ mode: visualizerMode, placeholderId: previewPlaceholderId, paused: isPreviewPaused });
    const previewPlaceholder = previewClock.placeholder;
    // The sample, paused, has no change of time for a style mounted anew (a switch from the live picture).
    useStillClockPulse({ time: previewClock.currentTime, still: isPreviewPaused && live === null, boxRef: previewBoxRef, restartKey: previewSource });
    const shown = live
        ? {
            key: 'live',
            currentTime: livePreview.currentTime,
            audioPower: livePreview.audioPower,
            audioBands: livePreview.audioBands,
            duration: live.duration,
            currentLineIndex: live.currentLineIndex,
            lines: live.lines,
            songTitle: live.songTitle,
            coverUrl: live.coverUrl ?? undefined,
            seed: live.seed,
        }
        : {
            key: previewPlaceholderId,
            currentTime: previewClock.currentTime,
            audioPower: previewClock.audioPower,
            audioBands: previewClock.audioBands,
            duration: previewPlaceholder.loopDuration,
            currentLineIndex: previewClock.currentLineIndex,
            lines: previewPlaceholder.lines,
            songTitle: previewPlaceholder.title,
            coverUrl: previewPlaceholder.coverUrl,
            // One seed per sample song, as the player's is the song's: a seed that changed
            // with the style would lay the background out again on every switch.
            seed: `vis-playground-${previewPlaceholderId}`,
        };
    const [fontPickerTarget, setFontPickerTarget] = useState<'lyrics' | 'subtitle' | 'none'>('none');
    const [draftBackgroundOpacity, setDraftBackgroundOpacity] = useState(backgroundOpacity);
    const [draftVisualizerOpacity, setDraftVisualizerOpacity] = useState(visualizerOpacity);
    const [draftSubtitleOverlayOpacity, setDraftSubtitleOverlayOpacity] = useState(subtitleOverlayOpacity);
    const [draftFontScale, setDraftFontScale] = useState(fontScale);
    const [draftSubtitleFontScale, setDraftSubtitleFontScale] = useState(subtitleFontScale);
    const [draftFontWeight, setDraftFontWeight] = useState<number | null>(fontWeight);
    const [draftSubtitleFontWeight, setDraftSubtitleFontWeight] = useState<number | null>(subtitleFontWeight);
    const [activeEditSection, setActiveEditSection] = useState<VisPlaygroundEditSection>(initialEditSection);
    // The tunings of the lyric styles and the backgrounds: what is saved, and the one draft over it.
    const settings = useVisualizerSettingsStore(useShallow(selectVisualizerSettingsSnapshot));
    const tuningDrafts = useTuningDrafts(settings);
    const { gate } = tuningDrafts;
    const styleDraft = tuningDrafts.styleDraft(visualizerMode);
    const styleAssets = useVisualizerStyleAssets();

    const normalizedFontScale = clampFontScale(draftFontScale);
    const normalizedSubtitleFontScale = clampFontScale(draftSubtitleFontScale);
    const builtinFontOptions: PresetOption<Theme['fontStyle']>[] = useMemo(() => ([
        { value: 'sans', label: t('options.fontSans') },
        { value: 'serif', label: t('options.fontSerif') },
        { value: 'mono', label: t('options.fontMono') },
    ]), [t]);
    const fontWeightOptions: PresetOption<number>[] = useMemo(() => (
        FONT_WEIGHT_PRESETS.map(preset => ({
            value: preset.value,
            label: t(preset.labelKey),
        }))
    ), [t]);
    const baseTheme = theme ?? PREVIEW_THEME;
    const previewTheme = useMemo<Theme>(() => ({
        ...baseTheme,
        fontStyle,
        fontFamily: customFontFamily ?? undefined,
        fontFamilyStack: fontFallbackFamilies,
        fontWeight: fontWeight ?? undefined,
    }), [baseTheme, customFontFamily, fontFallbackFamilies, fontStyle, fontWeight]);
    const previewSubtitleTheme = useMemo<Theme>(() => (
        subtitleFontInheritsLyrics
            ? previewTheme
            : {
                ...baseTheme,
                fontStyle: subtitleFontStyle,
                fontFamily: subtitleFontFamily ?? undefined,
                fontFamilyStack: subtitleFontFallbackFamilies,
                fontWeight: subtitleFontWeight ?? undefined,
            }
    ), [
        baseTheme,
        previewTheme,
        subtitleFontFallbackFamilies,
        subtitleFontFamily,
        subtitleFontInheritsLyrics,
        subtitleFontStyle,
        subtitleFontWeight,
    ]);
    // The small pictures draw with what is saved, not with a slider's draft: a drag redraws the big
    // sample only, and the pictures follow once the pointer has let go.
    const pictureLook = useMemo<LyricPreviewLook>(() => ({
        visualizerTunings: tuningDrafts.savedTunings,
        lyricsFontScale: clampFontScale(fontScale),
        ...styleAssets,
    }), [fontScale, styleAssets, tuningDrafts.savedTunings]);
    // Mod styles come and go at runtime (Folium registries), so the shelf recomputes on registry
    // changes, not only on language changes.
    const foliumVisualizerEntries = useFoliumRegistryEntries(visualizersRegistry);
    const modeOptions = useMemo(() => (
        [
            ...VISUALIZER_REGISTRY.map(entry => ({
                label: getVisualizerModeLabel(entry.mode, t),
                value: entry.mode,
            })),
            { label: t('ui.visualizerRandom'), value: RANDOM_VISUALIZER_CHOICE },
        ]
        // eslint-disable-next-line react-hooks/exhaustive-deps
    ), [t, foliumVisualizerEntries]);
    // The window's own split: under it the column lies under the stage and the shelf is narrow.
    const isWideWindow = useMediaQuery('(min-width: 1024px)');
    const reducedKitMotion = useKitReducedMotion();
    const currentFontLabel = customFontLabel || customFontFamily || t('options.customFont');
    const fontStyleOptions: PresetOption<Theme['fontStyle'] | 'custom'>[] = useMemo(() => ([
        ...builtinFontOptions,
        { value: 'custom', label: currentFontLabel },
    ]), [builtinFontOptions, currentFontLabel]);
    const currentSubtitleFontLabel = subtitleFontFamily || t('options.customFont');
    const subtitleFontStyleOptions: PresetOption<Theme['fontStyle'] | 'custom'>[] = useMemo(() => ([
        ...builtinFontOptions,
        { value: 'custom', label: currentSubtitleFontLabel },
    ]), [builtinFontOptions, currentSubtitleFontLabel]);

    useEffect(() => { setDraftBackgroundOpacity(backgroundOpacity); }, [backgroundOpacity]);
    useEffect(() => { setDraftVisualizerOpacity(visualizerOpacity); }, [visualizerOpacity]);
    useEffect(() => { setDraftSubtitleOverlayOpacity(subtitleOverlayOpacity); }, [subtitleOverlayOpacity]);
    useEffect(() => { setDraftFontScale(fontScale); }, [fontScale]);
    useEffect(() => { setDraftSubtitleFontScale(subtitleFontScale); }, [subtitleFontScale]);
    useEffect(() => { setDraftFontWeight(fontWeight); }, [fontWeight]);
    useEffect(() => { setDraftSubtitleFontWeight(subtitleFontWeight); }, [subtitleFontWeight]);
    const lastFontWeightRef = useRef(fontWeight ?? 400);
    const lastSubtitleFontWeightRef = useRef(subtitleFontWeight ?? 400);
    useEffect(() => {
        if (fontWeight !== null) lastFontWeightRef.current = fontWeight;
    }, [fontWeight]);
    useEffect(() => {
        if (subtitleFontWeight !== null) lastSubtitleFontWeightRef.current = subtitleFontWeight;
    }, [subtitleFontWeight]);
    useEffect(() => { setActiveEditSection(initialEditSection); }, [initialEditSection]);

    const visualizerEntry = getVisualizerRegistryEntry(visualizerMode);
    const hotspotLabels = useMemo<Record<VisPlaygroundHotspotSection, string>>(() => ({
        background: t('options.previewBackgroundHotspot'),
        visualizer: t('options.previewVisualizerHotspot'),
        subtitle: t('options.previewSubtitleHotspot'),
    }), [t]);
    const controlCardBg = colorWithAlpha(previewTheme.backgroundColor, isDaylight ? 0.42 : 0.52);
    const rangeInputClass = [
        'w-full h-1.5 rounded-full appearance-none cursor-pointer',
        '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:hover:scale-125 [&::-webkit-slider-thumb]:transition-transform',
        '[&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:transition-transform',
        isDaylight
            ? 'bg-black/15 [&::-webkit-slider-thumb]:bg-zinc-700 [&::-moz-range-thumb]:bg-zinc-700'
            : 'bg-white/10 [&::-webkit-slider-thumb]:bg-white [&::-moz-range-thumb]:bg-white',
    ].join(' ');

    const handleSelectBuiltinFont = (next: Theme['fontStyle']) => {
        onCustomFontChange(null);
        onFontStyleChange(next);
    };


    const handleChooseSystemFont = (font: LocalFontEntry) => {
        if (fontPickerTarget === 'lyrics') {
            onCustomFontChange({
                source: 'system',
                family: font.family,
                label: font.label,
            });
        } else if (fontPickerTarget === 'subtitle') {
            onSubtitleFontFamilyChange?.(font.family);
        }
    };


    const handleSelectFontStyle = (next: Theme['fontStyle'] | 'custom') => {
        if (next === 'custom') {
            setFontPickerTarget('lyrics');
            return;
        }

        handleSelectBuiltinFont(next);
    };

    // The window's own sliders: the value is shown at once and saved through the gate, which
    // keeps a save for the release while a slider is held.
    const handleBackgroundOpacityDraft = (opacity: number) => {
        setDraftBackgroundOpacity(opacity);
        gate.save('backgroundOpacity', () => backgroundActions?.common?.onOpacityChange?.(opacity));
    };

    const handleVisualizerOpacityDraft = (opacity: number) => {
        setDraftVisualizerOpacity(opacity);
        gate.save('visualizerOpacity', () => onVisualizerOpacityChange?.(opacity));
    };

    const handleSubtitleOverlayOpacityDraft = (opacity: number) => {
        setDraftSubtitleOverlayOpacity(opacity);
        gate.save('subtitleOverlayOpacity', () => onSubtitleOverlayOpacityChange?.(opacity));
    };

    const handleFontScaleDraft = (scale: number) => {
        setDraftFontScale(scale);
        gate.save('fontScale', () => onFontScaleChange(scale));
    };

    const handleSubtitleFontScaleDraft = (scale: number) => {
        setDraftSubtitleFontScale(scale);
        gate.save('subtitleFontScale', () => onSubtitleFontScaleChange?.(scale));
    };

    // A weight slider shows its own value while it is held (the column keeps it): the draft follows on release.
    const handleFontWeightDraft = (weight: number | null) => {
        if (weight !== null) lastFontWeightRef.current = weight;
        if (!gate.isHeld()) setDraftFontWeight(weight);
        gate.save('fontWeight', () => onFontWeightChange(weight));
    };

    const handleSubtitleFontWeightDraft = (weight: number | null) => {
        if (weight !== null) lastSubtitleFontWeightRef.current = weight;
        if (!gate.isHeld()) setDraftSubtitleFontWeight(weight);
        gate.save('subtitleFontWeight', () => onSubtitleFontWeightChange?.(weight));
    };

    const handleFontWeightFollowChange = (follow: boolean) => {
        handleFontWeightDraft(follow ? null : lastFontWeightRef.current);
    };

    const handleSubtitleFontWeightFollowChange = (follow: boolean) => {
        handleSubtitleFontWeightDraft(follow ? null : lastSubtitleFontWeightRef.current);
    };

    // A reset also drops what a held slider of its page left waiting: let go after it, the slider
    // saves nothing over the defaults (as a tuning's reset does, see useTuningDrafts).
    const handleResetSubtitleSettings = () => {
        gate.forget('subtitleOverlayOpacity');
        gate.forget('subtitleFontScale');
        gate.forget('subtitleFontWeight');
        setDraftSubtitleOverlayOpacity(0.6);
        setDraftSubtitleFontScale(1);
        onToggleHideTranslationSubtitle?.(false);
        if (onSubtitleContentModeChange) {
            onSubtitleContentModeChange('translation');
        } else {
            onToggleShowSubtitleTranslation?.(true);
        }
        onSubtitleOverlayLayoutChange?.(DEFAULT_SUBTITLE_OVERLAY_LAYOUT);
        onToggleSubtitleOverlayBackground?.(true);
        onToggleSubtitleUpcomingLyricsBlur?.(true);
        onToggleShowHarmonySubtitle?.(true);
        onToggleHarmonySubtitleBackground?.(true);
        onSubtitleOverlayOpacityChange?.(0.6);
        onSubtitleFontScaleChange?.(1);
        onSubtitleFontInheritsLyricsChange?.(true);
        onSubtitleFontStyleChange?.('sans');
        setDraftSubtitleFontWeight(null);
        onSubtitleFontWeightChange?.(null);
        onSubtitleFontFamilyChange?.(null);
        onSubtitleFontFallbackFamiliesChange?.([]);
    };

    const handleResetCommonSettings = () => {
        gate.forget('fontScale');
        gate.forget('fontWeight');
        gate.forget('visualizerOpacity');
        setDraftFontScale(1);
        setDraftFontWeight(null);
        setDraftVisualizerOpacity(1);
        onCustomFontChange(null);
        onFontFallbackFamiliesChange?.([]);
        onFontStyleChange('sans');
        onFontScaleChange(1);
        onFontWeightChange(null);
        onVisualizerOpacityChange?.(1);
    };

    const draftBackgroundConfig: VisualizerBackgroundConfig = {
        ...backgroundConfig,
        common: {
            ...backgroundConfig?.common,
            opacity: draftBackgroundOpacity,
        },
        ...tuningDrafts.backgroundConfig,
    };
    const draftBackgroundActions: VisualizerBackgroundActions = {
        ...backgroundActions,
        common: {
            ...backgroundActions?.common,
            onOpacityChange: handleBackgroundOpacityDraft,
        },
        ...tuningDrafts.backgroundActions,
    };

    const stage = (
        <>
            {/* The sample always shows the theme being previewed, whatever the window's own colours. */}
            <SampleBox
                ref={previewBoxRef}
                room="min-h-[160px] flex-1"
                className="relative overflow-hidden rounded-xl shadow-[0_0_0_1px_var(--st-line)]"
                style={{ backgroundColor: previewTheme.backgroundColor }}
            >
                {/* The style is drawn as large as the app's window and scaled to fit. */}
                <VisPlaygroundSampleStage>
                    {/* Another sample song fades in. A newly chosen style is switched by the renderer, as in
                        the player: the background stays and only the style changes. */}
                    <motion.div
                        key={shown.key}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={kitTransition('move', reducedKitMotion)}
                        className="absolute inset-0"
                    >
                        <VisualizerRenderer
                            mode={visualizerMode}
                            animateStyleSwitch
                            currentTime={shown.currentTime}
                            duration={shown.duration}
                            currentLineIndex={shown.currentLineIndex}
                            lines={shown.lines}
                            theme={previewTheme}
                            subtitleTheme={previewSubtitleTheme}
                            isDaylight={isDaylight}
                            audioPower={shown.audioPower}
                            audioBands={shown.audioBands}
                            songTitle={shown.songTitle}
                            showText
                            staticMode={staticMode}
                            isPreviewMode
                            paused={isPreviewPaused}
                            visualizerOpacity={draftVisualizerOpacity}
                            coverUrl={shown.coverUrl}
                            background={draftBackgroundConfig}
                            lyricsFontScale={normalizedFontScale}
                            subtitleFontScale={normalizedSubtitleFontScale}
                            subtitleOverlayOpacity={draftSubtitleOverlayOpacity}
                            subtitleOverlayBackground={subtitleOverlayBackground}
                            subtitleUpcomingLyricsBlur={subtitleUpcomingLyricsBlur}
                            showHarmonySubtitle={showHarmonySubtitle}
                            harmonySubtitleBackground={harmonySubtitleBackground}
                            hideTranslationSubtitle={hideTranslationSubtitle}
                            showSubtitleTranslation={showSubtitleTranslation}
                            subtitleContentMode={resolvedSubtitleContentMode}
                            subtitleOverlayLayout={subtitleOverlayLayout}
                            visualizerTunings={tuningDrafts.sampleTunings}
                            onVisualizerTuningChange={styleDraft.change}
                            {...styleAssets}
                            seed={shown.seed}
                        />
                    </motion.div>
                </VisPlaygroundSampleStage>
                <VisPlaygroundPreviewHotspots
                    activeSection={activeEditSection}
                    onSectionChange={setActiveEditSection}
                    theme={previewTheme}
                    labels={hotspotLabels}
                />
                <PreviewSourceSwitch value={previewSource} onChange={setPreviewSource} liveEmpty={previewSource === 'live' && live === null} />
                <Tooltip text={t(isPreviewPaused ? 'options.resumePreview' : 'options.pausePreview')} className="absolute right-3 top-3 z-40 inline-flex">
                    <button
                        type="button"
                        onClick={() => setIsPreviewPaused(previous => !previous)}
                        aria-label={t(isPreviewPaused ? 'options.resumePreview' : 'options.pausePreview')}
                        className="st-t-fast grid h-8 w-8 place-items-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/65"
                    >
                        {isPreviewPaused ? <Play size={14} fill="currentColor" /> : <Pause size={14} fill="currentColor" />}
                    </button>
                </Tooltip>
            </SampleBox>
            <div className="flex shrink-0 flex-col">
                <h3 className="mb-2 flex min-h-6 items-center px-1 text-[13px] font-semibold leading-5 text-[color:var(--st-t2)]">
                    {t('options.lyricStyles')}
                    <span className="ml-1.5 font-normal text-[color:var(--st-t3)]">{modeOptions.length}</span>
                </h3>
                <PictureGrid
                    value={settings.randomVisualizerModePerSong ? RANDOM_VISUALIZER_CHOICE : visualizerMode}
                    options={modeOptions}
                    picture={drawLyricStyleChoice}
                    columns={isWideWindow ? SHELF_COLUMNS.wide : SHELF_COLUMNS.narrow}
                    onChange={mode => {
                        selectLyricStyleChoice(mode, next => onVisualizerModeChange?.(next));
                        setActiveEditSection('visualizer');
                    }}
                    label={t('ui.animationMode')}
                    maxHeight={250}
                    className="-mx-4"
                />
            </div>
        </>
    );
    const column = (
        <VisPlaygroundSettingsPanel
            activeSection={activeEditSection}
            onSectionChange={setActiveEditSection}
            t={t}
            isDaylight={isDaylight}
            theme={previewTheme}
            visualizerMode={visualizerMode}
            visualizerEntry={visualizerEntry}
            styleDraft={styleDraft}
            settings={settings}
            controlCardBg={controlCardBg}
            rangeInputClass={rangeInputClass}
            backgroundConfig={draftBackgroundConfig}
            backgroundActions={draftBackgroundActions}
            previewPlaceholderId={previewPlaceholderId}
            previewPlaceholderOptions={[
                { value: 'default', label: t('options.previewTextDefault') },
                { value: 'reserved', label: t('options.previewTextReserved') },
            ]}
            onPreviewPlaceholderChange={setPreviewPlaceholderId}
            visualizerOpacity={draftVisualizerOpacity}
            onVisualizerOpacityChange={handleVisualizerOpacityDraft}
            fontStyleValue={customFontFamily ? 'custom' : fontStyle}
            fontStyleOptions={fontStyleOptions}
            subtitleFontStyleOptions={subtitleFontStyleOptions}
            onFontStyleChange={handleSelectFontStyle}
            customFontFamily={customFontFamily}
            currentFontLabel={currentFontLabel}
            fontScale={normalizedFontScale}
            fontScaleOptions={FONT_SCALE_OPTIONS}
            onFontScaleChange={handleFontScaleDraft}
            subtitleFontScale={normalizedSubtitleFontScale}
            onSubtitleFontScaleChange={handleSubtitleFontScaleDraft}
            fontWeight={draftFontWeight}
            fontWeightOptions={fontWeightOptions}
            onFontWeightChange={handleFontWeightDraft}
            onFontWeightFollowChange={handleFontWeightFollowChange}
            onResetCommonSettings={handleResetCommonSettings}
            hideTranslationSubtitle={hideTranslationSubtitle}
            onToggleHideTranslationSubtitle={onToggleHideTranslationSubtitle}
            onToggleShowSubtitleTranslation={onToggleShowSubtitleTranslation}
            subtitleContentMode={resolvedSubtitleContentMode}
            onSubtitleContentModeChange={onSubtitleContentModeChange}
            subtitleOverlayLayout={subtitleOverlayLayout}
            onSubtitleOverlayLayoutChange={onSubtitleOverlayLayoutChange}
            subtitleOverlayOpacity={draftSubtitleOverlayOpacity}
            onSubtitleOverlayOpacityChange={handleSubtitleOverlayOpacityDraft}
            subtitleOverlayBackground={subtitleOverlayBackground}
            onToggleSubtitleOverlayBackground={onToggleSubtitleOverlayBackground}
            subtitleUpcomingLyricsBlur={subtitleUpcomingLyricsBlur}
            onToggleSubtitleUpcomingLyricsBlur={onToggleSubtitleUpcomingLyricsBlur}
            showHarmonySubtitle={showHarmonySubtitle}
            onToggleShowHarmonySubtitle={onToggleShowHarmonySubtitle}
            harmonySubtitleBackground={harmonySubtitleBackground}
            onToggleHarmonySubtitleBackground={onToggleHarmonySubtitleBackground}
            subtitleFontInheritsLyrics={subtitleFontInheritsLyrics}
            onSubtitleFontInheritsLyricsChange={onSubtitleFontInheritsLyricsChange}
            subtitleFontStyle={subtitleFontStyle}
            subtitleFontWeight={draftSubtitleFontWeight}
            onSubtitleFontWeightChange={handleSubtitleFontWeightDraft}
            onSubtitleFontWeightFollowChange={handleSubtitleFontWeightFollowChange}
            onSubtitleFontStyleChange={onSubtitleFontStyleChange}
            subtitleFontFamily={subtitleFontFamily}
            onSubtitleFontFamilyChange={onSubtitleFontFamilyChange}
            onOpenSubtitleFontPicker={() => setFontPickerTarget('subtitle')}
            onResetSubtitleSettings={handleResetSubtitleSettings}
            onSliderPointerDown={tuningDrafts.onSliderPointerDown}
            onSliderCommit={tuningDrafts.onSliderCommit}
        />
    );
    const pickingSubtitleFont = fontPickerTarget === 'subtitle';
    const fontPicker = fontPickerTarget !== 'none' && (
        <FontPicker
            family={pickingSubtitleFont ? subtitleFontFamily : customFontFamily}
            label={pickingSubtitleFont ? (subtitleFontFamily ?? '') : currentFontLabel}
            fallbackFamilies={pickingSubtitleFont ? subtitleFontFallbackFamilies : fontFallbackFamilies}
            onFallbackFamiliesChange={pickingSubtitleFont ? onSubtitleFontFallbackFamiliesChange : onFontFallbackFamiliesChange}
            fontStyle={pickingSubtitleFont ? previewSubtitleTheme.fontStyle : previewTheme.fontStyle}
            onChoose={handleChooseSystemFont}
            onClear={() => (pickingSubtitleFont ? onSubtitleFontFamilyChange?.(null) : onCustomFontChange(null))}
            onUpload={onUploadCustomFont}
            onClose={() => setFontPickerTarget('none')}
        />
    );

    return (
        <LyricPreviewProvider clock={previewClock} theme={previewTheme} isDaylight={isDaylight} look={pictureLook} background={backgroundConfig}>
            <StudioWindow
                title={t('options.lyricsStyleSettings')}
                onBack={onClose}
                backLabel={t('ui.back')}
                isDaylight={isDaylight}
                theme={baseTheme}
                ponderId="vis-playground"
                stage={stage}
                over={fontPicker}
                onOverClose={() => setFontPickerTarget('none')}
            >
                {column}
            </StudioWindow>
        </LyricPreviewProvider>
    );
};

export default VisPlayground;
