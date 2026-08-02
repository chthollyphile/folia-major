import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CaptionsOff, Monitor, PanelTop, RotateCcw, type LucideIcon } from 'lucide-react';
import {
    type CappellaAvatarImage,
    type CappellaEmojiImage,
    type CappellaTuning,
    type ClassicTuning,
    type CladdaghTuning,
    type FumeTuning,
    type MonetPortraitImage,
    type MonetTuning,
    type PartitaTuning,
    type PendoloTuning,
    type SonnetTuning,
    type Theme,
    type SubtitleContentMode,
    type TiltTuning,
    type DioramaTuning,
    type VisualizerMode,
} from '../../types';
import { useSettingsUiStore } from '../../stores/useSettingsUiStore';
import { colorWithAlpha } from './colorMix';
import FontFallbackStackControl from './FontFallbackStackControl';
import { VISUALIZER_REGISTRY, getVisualizerModeLabel, type VisualizerRegistryEntry } from './registry';
import { type VisPlaygroundEditSection } from './VisPlaygroundPreviewHotspots';
import { type PreviewPlaceholderId } from './PreviewPlaceholder';
import type { VisualizerBackgroundActions, VisualizerBackgroundConfig } from './backgrounds/definition';
import {
    DEFAULT_VISUALIZER_BACKGROUND_MODE,
    getVisualizerBackgroundModeLabel,
    getVisualizerBackgroundRegistryEntry,
    VISUALIZER_BACKGROUND_REGISTRY,
} from './backgrounds/registry';

// src/components/visualizer/VisPlaygroundSettingsPanel.tsx
// Right-side settings panel for the click-to-edit visualizer playground.
interface PresetOption<T> {
    label: string;
    value: T;
}

interface PresetGroupProps<T> {
    label: string;
    value: T;
    options: PresetOption<T>[];
    onChange: (next: T) => void;
    isDaylight: boolean;
    theme: Theme;
    isOptionActive?: (option: PresetOption<T>) => boolean;
}

interface ToggleRowProps {
    label: string;
    description?: string;
    checked: boolean;
    onChange?: (checked: boolean) => void;
    theme: Theme;
    icon?: LucideIcon;
}

interface VisPlaygroundSettingsPanelProps {
    activeSection: VisPlaygroundEditSection;
    onSectionChange: (section: VisPlaygroundEditSection) => void;
    t: (key: string) => string;
    isDaylight: boolean;
    theme: Theme;
    visualizerMode: VisualizerMode;
    visualizerEntry: VisualizerRegistryEntry;
    onVisualizerModeChange?: (mode: VisualizerMode) => void;
    onResetVisualizerTuning?: () => void;
    controlCardBg: string;
    rangeInputClass: string;
    visualizerOpacity: number;
    onVisualizerOpacityChange?: (opacity: number) => void;
    backgroundConfig?: VisualizerBackgroundConfig;
    backgroundActions?: VisualizerBackgroundActions;
    previewPlaceholderId: PreviewPlaceholderId;
    previewPlaceholderOptions: PresetOption<PreviewPlaceholderId>[];
    onPreviewPlaceholderChange: (id: PreviewPlaceholderId) => void;
    fontStyleValue: Theme['fontStyle'] | 'custom';
    builtinFontOptions: PresetOption<Theme['fontStyle']>[];
    fontStyleOptions: PresetOption<Theme['fontStyle'] | 'custom'>[];
    subtitleFontStyleOptions: PresetOption<Theme['fontStyle'] | 'custom'>[];
    onFontStyleChange: (fontStyle: Theme['fontStyle'] | 'custom') => void;
    fontScale: number;
    fontScaleOptions: PresetOption<number>[];
    onFontScaleChange: (fontScale: number) => void;
    subtitleFontScale: number;
    onSubtitleFontScaleChange: (fontScale: number) => void;
    fontWeight: number | null;
    fontWeightOptions: PresetOption<number>[];
    onFontWeightChange: (fontWeight: number | null) => void;
    onFontWeightFollowChange: (follow: boolean) => void;
    onResetCommonSettings?: () => void;
    classicTuning: ClassicTuning;
    onClassicTuningChange?: (patch: Partial<ClassicTuning>) => void;
    partitaTuning: PartitaTuning;
    onPartitaTuningChange?: (patch: Partial<PartitaTuning>) => void;
    fumeTuning: FumeTuning;
    onFumeTuningChange?: (patch: Partial<FumeTuning>) => void;
    claddaghTuning: CladdaghTuning;
    onCladdaghTuningChange?: (patch: Partial<CladdaghTuning>) => void;
    pendoloTuning?: PendoloTuning;
    onPendoloTuningChange?: (patch: Partial<PendoloTuning>) => void;
    sonnetTuning?: SonnetTuning;
    onSonnetTuningChange?: (patch: Partial<SonnetTuning>) => void;
    cappellaTuning: CappellaTuning;
    cappellaCustomEmojiImages: CappellaEmojiImage[];
    onCappellaTuningChange?: (patch: Partial<CappellaTuning>) => void;
    isLoadingCappellaCustomEmojiPack: boolean;
    onImportCappellaCustomEmojiPack?: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
    onClearCappellaCustomEmojiPack?: () => Promise<void> | void;
    cappellaCustomAvatarImages?: CappellaAvatarImage[];
    onImportCappellaCustomAvatar?: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
    onClearCappellaCustomAvatar?: () => Promise<void> | void;
    isLoadingCappellaCustomAvatarPack?: boolean;
    tiltTuning: TiltTuning;
    onTiltTuningChange?: (patch: Partial<TiltTuning>) => void;
    dioramaTuning?: DioramaTuning;
    onDioramaTuningChange?: (patch: Partial<DioramaTuning>) => void;
    monetTuning: MonetTuning;
    onMonetTuningChange?: (patch: Partial<MonetTuning>) => void;
    onResetMonetTuning?: () => void;
    monetPortraitImage?: MonetPortraitImage | null;
    onUploadMonetPortraitImage?: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
    onClearMonetPortraitImage?: () => Promise<void> | void;
    isLoadingMonetPortraitImage?: boolean;
    hideTranslationSubtitle: boolean;
    onToggleHideTranslationSubtitle?: (hidden: boolean) => void;
    onToggleShowSubtitleTranslation?: (shown: boolean) => void;
    subtitleContentMode: SubtitleContentMode;
    onSubtitleContentModeChange?: (mode: SubtitleContentMode) => void;
    subtitleOverlayOpacity: number;
    onSubtitleOverlayOpacityChange?: (opacity: number) => void;
    subtitleOverlayBackground: boolean;
    onToggleSubtitleOverlayBackground?: (enabled: boolean) => void;
    showHarmonySubtitle: boolean;
    onToggleShowHarmonySubtitle?: (enabled: boolean) => void;
    harmonySubtitleBackground: boolean;
    onToggleHarmonySubtitleBackground?: (enabled: boolean) => void;
    subtitleFontInheritsLyrics: boolean;
    onSubtitleFontInheritsLyricsChange?: (inheritsLyrics: boolean) => void;
    subtitleFontStyle: Theme['fontStyle'];
    subtitleFontWeight: number | null;
    onSubtitleFontStyleChange?: (fontStyle: Theme['fontStyle']) => void;
    onSubtitleFontWeightChange?: (fontWeight: number | null) => void;
    onSubtitleFontWeightFollowChange?: (follow: boolean) => void;
    subtitleFontFamily?: string | null;
    onSubtitleFontFamilyChange?: (fontFamily: string | null) => void;
    subtitleFontFallbackFamilies: string[];
    onSubtitleFontFallbackFamiliesChange?: (families: string[]) => void;
    onOpenSubtitleFontPicker?: () => void;
    onResetSubtitleSettings?: () => void;
    onSliderPointerDown?: () => void;
    onSliderCommit?: () => void;
}

const SECTION_OPTIONS: VisPlaygroundEditSection[] = ['common', 'background', 'visualizer', 'subtitle'];

const getSectionLabel = (section: VisPlaygroundEditSection, t: (key: string) => string) => {
    if (section === 'common') return t('options.previewCommonSettings');
    if (section === 'background') return t('options.previewBackgroundSettings');
    if (section === 'subtitle') return t('options.previewSubtitleSettings');
    return t('options.previewVisualizerSettings');
};

const getAccentOptionStyle = (selected: boolean, theme: Theme, isDaylight: boolean): React.CSSProperties => (
    selected
        ? {
            borderColor: theme.accentColor,
            boxShadow: `inset 0 0 0 1px ${theme.accentColor}`,
            backgroundColor: colorWithAlpha(theme.accentColor, isDaylight ? 0.1 : 0.16),
        }
        : {
            borderColor: colorWithAlpha(theme.secondaryColor, isDaylight ? 0.18 : 0.16),
            backgroundColor: colorWithAlpha(theme.backgroundColor, isDaylight ? 0.24 : 0.34),
        }
);

const PresetGroup = <T,>({
    label,
    value,
    options,
    onChange,
    isDaylight,
    theme,
    isOptionActive,
}: PresetGroupProps<T>) => (
    <div className="space-y-2.5">
        <div className="text-xs font-medium uppercase tracking-[0.24em] opacity-60" style={{ color: theme.secondaryColor }}>
            {label}
        </div>
        <div className="flex flex-wrap gap-2">
            {options.map(option => {
                const isActive = isOptionActive ? isOptionActive(option) : option.value === value;

                return (
                    <button
                        key={String(option.value)}
                        type="button"
                        onClick={() => onChange(option.value)}
                        className="px-3 py-2 rounded-full text-sm transition-all border"
                        style={{
                            ...getAccentOptionStyle(isActive, theme, isDaylight),
                            color: theme.primaryColor,
                        }}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    </div>
);

const ToggleRow: React.FC<ToggleRowProps> = ({
    label,
    description,
    checked,
    onChange,
    theme,
    icon: Icon = Monitor,
}) => (
    <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
            <div className="text-sm font-medium flex items-center gap-2" style={{ color: theme.primaryColor }}>
                <Icon size={14} />
                {label}
            </div>
            {description && (
                <div className="text-xs opacity-70 max-w-[320px]" style={{ color: theme.secondaryColor }}>
                    {description}
                </div>
            )}
        </div>
        <button
            type="button"
            aria-label={label}
            aria-pressed={checked}
            onClick={() => onChange?.(!checked)}
            className="w-12 h-6 rounded-full p-1 transition-colors shrink-0 disabled:opacity-45"
            disabled={!onChange}
            style={{
                backgroundColor: checked ? theme.secondaryColor : colorWithAlpha(theme.secondaryColor, 0.18),
            }}
        >
            <div
                className={`w-4 h-4 rounded-full shadow-sm transition-transform ${checked ? 'translate-x-6' : 'translate-x-0'}`}
                style={{ backgroundColor: theme.backgroundColor }}
            />
        </button>
    </div>
);

const ResetSectionButton: React.FC<{
    label: string;
    onClick?: () => void;
    theme: Theme;
}> = ({ label, onClick, theme }) => (
    <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-45"
        style={{
            color: theme.secondaryColor,
            borderColor: colorWithAlpha(theme.secondaryColor, 0.16),
            backgroundColor: colorWithAlpha(theme.backgroundColor, 0.22),
        }}
    >
        <RotateCcw size={12} />
        {label}
    </button>
);

const SectionTabs: React.FC<Pick<VisPlaygroundSettingsPanelProps, 'activeSection' | 'onSectionChange' | 't' | 'theme' | 'isDaylight'>> = ({
    activeSection,
    onSectionChange,
    t,
    theme,
    isDaylight,
}) => (
    <div className="inline-flex w-fit items-center gap-1 rounded-full p-1" style={{ backgroundColor: colorWithAlpha(theme.backgroundColor, isDaylight ? 0.34 : 0.52) }}>
        {SECTION_OPTIONS.map(section => {
            const active = activeSection === section;
            return (
                <button
                    key={section}
                    type="button"
                    onClick={() => onSectionChange(section)}
                    className="rounded-full border px-3 py-1.5 text-sm transition-all"
                    style={{
                        ...getAccentOptionStyle(active, theme, isDaylight),
                        color: active ? theme.primaryColor : theme.secondaryColor,
                    }}
                >
                    {getSectionLabel(section, t)}
                </button>
            );
        })}
    </div>
);

const VisPlaygroundSettingsPanel: React.FC<VisPlaygroundSettingsPanelProps> = (props) => {
    const {
        activeSection,
        onSectionChange,
        t,
        isDaylight,
        theme,
        visualizerMode,
        visualizerEntry,
        onVisualizerModeChange,
        onResetVisualizerTuning,
        controlCardBg,
        rangeInputClass,
        visualizerOpacity,
        onVisualizerOpacityChange,
        backgroundConfig,
        backgroundActions,
        previewPlaceholderId,
        previewPlaceholderOptions,
        onPreviewPlaceholderChange,
        fontStyleValue,
        builtinFontOptions,
        fontStyleOptions,
        subtitleFontStyleOptions,
        onFontStyleChange,
        fontScale,
        fontScaleOptions,
        onFontScaleChange,
        subtitleFontScale,
        onSubtitleFontScaleChange,
        fontWeight,
        fontWeightOptions,
        onFontWeightChange,
        onFontWeightFollowChange,
        onResetCommonSettings,
        classicTuning,
        onClassicTuningChange,
        partitaTuning,
        onPartitaTuningChange,
        fumeTuning,
        onFumeTuningChange,
        claddaghTuning,
        onCladdaghTuningChange,
        cappellaTuning,
        cappellaCustomEmojiImages,
        onCappellaTuningChange,
        isLoadingCappellaCustomEmojiPack,
        onImportCappellaCustomEmojiPack,
        onClearCappellaCustomEmojiPack,
        cappellaCustomAvatarImages = [],
        onImportCappellaCustomAvatar,
        onClearCappellaCustomAvatar,
        isLoadingCappellaCustomAvatarPack = false,
        tiltTuning,
        onTiltTuningChange,
        dioramaTuning,
        onDioramaTuningChange,
        monetTuning,
        onMonetTuningChange,
        pendoloTuning,
        onPendoloTuningChange,
        sonnetTuning,
        onSonnetTuningChange,
        monetPortraitImage,
        onUploadMonetPortraitImage,
        onClearMonetPortraitImage,
        isLoadingMonetPortraitImage,
        hideTranslationSubtitle,
        onToggleHideTranslationSubtitle,
        onToggleShowSubtitleTranslation,
        subtitleContentMode,
        onSubtitleContentModeChange,
        subtitleOverlayOpacity,
        onSubtitleOverlayOpacityChange,
        subtitleOverlayBackground,
        onToggleSubtitleOverlayBackground,
        showHarmonySubtitle,
        onToggleShowHarmonySubtitle,
        harmonySubtitleBackground,
        onToggleHarmonySubtitleBackground,
        subtitleFontInheritsLyrics,
        onSubtitleFontInheritsLyricsChange,
        subtitleFontStyle,
        subtitleFontWeight,
        onSubtitleFontWeightChange,
        onSubtitleFontWeightFollowChange,
        onSubtitleFontStyleChange,
        subtitleFontFamily,
        onSubtitleFontFamilyChange,
        subtitleFontFallbackFamilies,
        onSubtitleFontFallbackFamiliesChange,
        onOpenSubtitleFontPicker,
        onResetSubtitleSettings,
        onSliderPointerDown,
        onSliderCommit,
    } = props;
    const [fontWeightSliderValue, setFontWeightSliderValue] = useState(fontWeight ?? 400);
    const [subtitleFontWeightSliderValue, setSubtitleFontWeightSliderValue] = useState(subtitleFontWeight ?? 400);

    useEffect(() => {
        if (fontWeight !== null) setFontWeightSliderValue(fontWeight);
    }, [fontWeight]);
    useEffect(() => {
        if (subtitleFontWeight !== null) setSubtitleFontWeightSliderValue(subtitleFontWeight);
    }, [subtitleFontWeight]);

    const modeOptions = useMemo(() => (
        VISUALIZER_REGISTRY.map(entry => ({
            label: getVisualizerModeLabel(entry.mode, t),
            value: entry.mode,
        }))
    ), [t]);
    const [subtitleFontFamilyDraft, setSubtitleFontFamilyDraft] = useState(subtitleFontFamily ?? '');

    useEffect(() => {
        setSubtitleFontFamilyDraft(subtitleFontFamily ?? '');
    }, [subtitleFontFamily]);

    const enablePlayerPageNativeBlur = useSettingsUiStore(state => state.enablePlayerPageNativeBlur);
    const resolvedBackgroundMode = backgroundConfig?.mode ?? DEFAULT_VISUALIZER_BACKGROUND_MODE;
    const backgroundEntry = getVisualizerBackgroundRegistryEntry(resolvedBackgroundMode);
    const backgroundModeOptions = useMemo(() => (
        VISUALIZER_BACKGROUND_REGISTRY.map(entry => ({
            value: entry.mode,
            label: getVisualizerBackgroundModeLabel(entry.mode, t),
        }))
    ), [t]);

    return (
        <div className="min-h-0 flex flex-col gap-4">
            <SectionTabs
                activeSection={activeSection}
                onSectionChange={onSectionChange}
                t={t}
                theme={theme}
                isDaylight={isDaylight}
            />

            <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar space-y-4">
                {activeSection === 'common' && (
                    <div className="rounded-[24px] border p-4 space-y-4" style={{ backgroundColor: controlCardBg, borderColor: colorWithAlpha(theme.secondaryColor, 0.16) }}>
                        <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1">
                                <div className="text-sm font-medium" style={{ color: theme.primaryColor }}>
                                    {t('options.previewCommonSettings')}
                                </div>
                                <div className="text-xs opacity-70" style={{ color: theme.secondaryColor }}>
                                    {t('options.previewCommonSettingsDesc')}
                                </div>
                            </div>
                            <ResetSectionButton
                                label={t('ui.default')}
                                onClick={() => {
                                    onPreviewPlaceholderChange('default');
                                    onResetCommonSettings?.();
                                }}
                                theme={theme}
                            />
                        </div>

                        <PresetGroup
                            label={t('options.previewText')}
                            value={previewPlaceholderId}
                            options={previewPlaceholderOptions}
                            onChange={onPreviewPlaceholderChange}
                            isDaylight={isDaylight}
                            theme={theme}
                        />

                        <PresetGroup
                            label={t('options.fontFamily')}
                            value={fontStyleValue}
                            options={fontStyleOptions}
                            onChange={onFontStyleChange}
                            isDaylight={isDaylight}
                            theme={theme}
                            isOptionActive={(option) => option.value === fontStyleValue}
                        />

                        <fieldset
                            disabled={visualizerMode === 'sonnet'}
                            className={`space-y-4 transition-opacity ${visualizerMode === 'sonnet' ? 'opacity-40' : ''}`}
                        >
                            <PresetGroup
                                label={t('options.fontSize')}
                                value={fontScale}
                                options={fontScaleOptions}
                                onChange={onFontScaleChange}
                                isDaylight={isDaylight}
                                theme={theme}
                            />

                            <div className="space-y-2">
                                <div className="flex items-center justify-between text-sm" style={{ color: theme.primaryColor }}>
                                    <span>{t('options.fontSize')}</span>
                                    <span className="font-mono opacity-70" style={{ color: theme.secondaryColor }}>
                                        {Math.round(fontScale * 100)}%
                                    </span>
                                </div>
                                <input
                                    type="range"
                                    min="0.85"
                                    max="1.4"
                                    step="0.05"
                                    value={fontScale}
                                    onChange={(event) => onFontScaleChange(parseFloat(event.target.value))}
                                    onPointerDown={onSliderPointerDown}
                                    onPointerUp={onSliderCommit}
                                    className={rangeInputClass}
                                />
                            </div>
                        </fieldset>

                        {visualizerMode === 'sonnet' && (
                            <div
                                className="rounded-2xl border px-3.5 py-3 text-xs leading-relaxed"
                                style={{
                                    color: theme.secondaryColor,
                                    borderColor: colorWithAlpha(theme.accentColor, isDaylight ? 0.22 : 0.28),
                                    backgroundColor: colorWithAlpha(theme.accentColor, isDaylight ? 0.06 : 0.1),
                                }}
                            >
                                {t('options.sonnetFontSizeAutoNotice')}
                            </div>
                        )}

                        <ToggleRow
                            label={t('options.fontWeightAuto')}
                            description={t('options.fontWeightAutoDesc')}
                            checked={fontWeight === null}
                            onChange={onFontWeightFollowChange}
                            theme={theme}
                        />

                        {fontWeight !== null && (
                            <div className="space-y-4">
                                <PresetGroup
                                    label={t('options.fontWeight')}
                                    value={fontWeightSliderValue}
                                    options={fontWeightOptions}
                                    onChange={(next) => {
                                        setFontWeightSliderValue(next);
                                        onFontWeightChange(next);
                                    }}
                                    isDaylight={isDaylight}
                                    theme={theme}
                                />
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between text-sm" style={{ color: theme.primaryColor }}>
                                        <span>{t('options.fontWeight')}</span>
                                        <span className="font-mono opacity-70" style={{ color: theme.secondaryColor }}>
                                            {fontWeightSliderValue}
                                        </span>
                                    </div>
                                    <input
                                        aria-label={t('options.fontWeight')}
                                        type="range"
                                        min="100"
                                        max="900"
                                        step="10"
                                        value={fontWeightSliderValue}
                                        onChange={(event) => {
                                            const next = parseInt(event.target.value, 10);
                                            setFontWeightSliderValue(next);
                                            onFontWeightChange(next);
                                        }}
                                        onPointerDown={onSliderPointerDown}
                                        onPointerUp={onSliderCommit}
                                        onPointerCancel={onSliderCommit}
                                        className={rangeInputClass}
                                    />
                                </div>
                            </div>
                        )}

                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm" style={{ color: theme.primaryColor }}>
                                <span>{t('options.visualizerOpacity')}</span>
                                <span className="font-mono opacity-70" style={{ color: theme.secondaryColor }}>
                                    {Math.round(visualizerOpacity * 100)}%
                                </span>
                            </div>
                            <input
                                type="range"
                                min="0.2"
                                max="1"
                                step="0.05"
                                value={visualizerOpacity}
                                onChange={(event) => onVisualizerOpacityChange?.(parseFloat(event.target.value))}
                                onPointerDown={onSliderPointerDown}
                                onPointerUp={onSliderCommit}
                                className={rangeInputClass}
                            />
                        </div>
                    </div>
                )}

                {activeSection === 'background' && (
                    <>
                        {enablePlayerPageNativeBlur && (
                            <div className="flex items-center gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-500 dark:text-amber-400">
                                <AlertTriangle size={16} className="shrink-0 text-amber-500" />
                                <span>{t('options.nativeBlurBackgroundNotice')}</span>
                            </div>
                        )}
                        <div className="rounded-[24px] border p-4 space-y-4" style={{ backgroundColor: controlCardBg, borderColor: colorWithAlpha(theme.secondaryColor, 0.16) }}>
                            <div className="flex items-start justify-between gap-3">
                                <div className="space-y-1">
                                    <div className="text-sm font-medium" style={{ color: theme.primaryColor }}>
                                        {t('options.previewBackgroundSettings')}
                                    </div>
                                    <div className="text-xs opacity-70" style={{ color: theme.secondaryColor }}>
                                        {t('options.previewBackgroundSettingsDesc')}
                                    </div>
                                </div>
                                <ResetSectionButton
                                    label={t('ui.default')}
                                    onClick={backgroundEntry.resetSettings
                                        ? () => backgroundEntry.resetSettings?.(backgroundActions)
                                        : undefined}
                                    theme={theme}
                                />
                            </div>

                            <PresetGroup
                                label={t('options.visualizerBackgroundMode')}
                                value={resolvedBackgroundMode}
                                options={backgroundModeOptions}
                                onChange={(mode) => backgroundActions?.onModeChange?.(mode)}
                                isDaylight={isDaylight}
                                theme={theme}
                            />
                        </div>

                        {backgroundEntry.renderSettingsPanel?.({
                            config: backgroundConfig,
                            actions: backgroundActions,
                            t,
                            isDaylight,
                            theme,
                            controlCardBg,
                            rangeInputClass,
                            onSliderPointerDown,
                            onSliderCommit,
                        })}
                    </>
                )}

                {activeSection === 'visualizer' && (
                    <>
                        <div className="rounded-[24px] border p-4 space-y-4" style={{ backgroundColor: controlCardBg, borderColor: colorWithAlpha(theme.secondaryColor, 0.16) }}>
                            <div className="flex items-start justify-between gap-3">
                                <div className="space-y-1">
                                    <div className="text-sm font-medium" style={{ color: theme.primaryColor }}>
                                        {t('options.lyricsRenderer')}
                                    </div>
                                    <div className="text-xs opacity-70" style={{ color: theme.secondaryColor }}>
                                        {t('options.lyricsRendererDesc')}
                                    </div>
                                </div>
                                <ResetSectionButton
                                    label={t('ui.default')}
                                    onClick={visualizerEntry.resetSettings ? onResetVisualizerTuning : undefined}
                                    theme={theme}
                                />
                            </div>

                            <PresetGroup
                                label={t('options.visualizerMode')}
                                value={visualizerMode}
                                options={modeOptions}
                                onChange={(mode) => onVisualizerModeChange?.(mode)}
                                isDaylight={isDaylight}
                                theme={theme}
                            />
                        </div>

                        {visualizerEntry.renderSettingsPanel?.({
                            t,
                            isDaylight,
                            theme,
                            controlCardBg,
                            rangeInputClass,
                            classicTuning,
                            onClassicTuningChange,
                            partitaTuning,
                            onPartitaTuningChange,
                            fumeTuning,
                            onFumeTuningChange,
                            claddaghTuning,
                            onCladdaghTuningChange,
                            cappellaTuning,
                            cappellaCustomEmojiImages,
                            onCappellaTuningChange,
                            cappellaCustomEmojiCount: cappellaCustomEmojiImages.length,
                            hasCappellaCustomEmojiPack: cappellaCustomEmojiImages.length > 0,
                            isCappellaCustomEmojiPackLoading: isLoadingCappellaCustomEmojiPack,
                            onImportCappellaCustomEmojiPack,
                            onClearCappellaCustomEmojiPack,
                            cappellaCustomAvatarImages,
                            onImportCappellaCustomAvatar,
                            onClearCappellaCustomAvatar,
                            hasCappellaCustomAvatar: cappellaCustomAvatarImages.length > 0,
                            isCappellaCustomAvatarLoading: isLoadingCappellaCustomAvatarPack,
                            tiltTuning,
                            onTiltTuningChange,
                            dioramaTuning,
                            onDioramaTuningChange,
                            monetTuning,
                            onMonetTuningChange,
                            pendoloTuning,
                            onPendoloTuningChange,
                            sonnetTuning,
                            onSonnetTuningChange,
                            monetPortraitImage,
                            onUploadMonetPortraitImage,
                            onClearMonetPortraitImage,
                            isLoadingMonetPortraitImage,
                            onSliderPointerDown,
                            onSliderCommit,
                        })}
                    </>
                )}

                {activeSection === 'subtitle' && (
                    <div className="rounded-[24px] border p-4 space-y-4" style={{ backgroundColor: controlCardBg, borderColor: colorWithAlpha(theme.secondaryColor, 0.16) }}>
                        <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1">
                                <div className="text-sm font-medium" style={{ color: theme.primaryColor }}>
                                    {t('options.previewSubtitleSettings')}
                                </div>
                                <div className="text-xs opacity-70" style={{ color: theme.secondaryColor }}>
                                    {t('options.previewSubtitleSettingsDesc')}
                                </div>
                            </div>
                            <ResetSectionButton
                                label={t('ui.default')}
                                onClick={onResetSubtitleSettings}
                                theme={theme}
                            />
                        </div>

                        <ToggleRow
                            label={t('options.hidePlayerTranslationSubtitle')}
                            description={t('options.hidePlayerTranslationSubtitleDesc')}
                            checked={hideTranslationSubtitle}
                            onChange={onToggleHideTranslationSubtitle}
                            theme={theme}
                            icon={CaptionsOff}
                        />

                        <PresetGroup
                            label={t('options.subtitleContentMode')}
                            value={subtitleContentMode}
                            options={[
                                { label: t('options.subtitleContentTranslation'), value: 'translation' },
                                { label: t('options.subtitleContentRomanization'), value: 'romanization' },
                                { label: t('options.subtitleContentNone'), value: 'none' },
                            ]}
                            onChange={onSubtitleContentModeChange ?? (mode => onToggleShowSubtitleTranslation?.(mode !== 'none'))}
                            isDaylight={isDaylight}
                            theme={theme}
                        />

                        <ToggleRow
                            label={t('options.subtitleOverlayBackground')}
                            description={t('options.subtitleOverlayBackgroundDesc')}
                            checked={subtitleOverlayBackground}
                            onChange={onToggleSubtitleOverlayBackground}
                            theme={theme}
                            icon={PanelTop}
                        />

                        <ToggleRow
                            label={t('options.subtitleFontInheritsLyrics')}
                            description={t('options.subtitleFontInheritsLyricsDesc')}
                            checked={subtitleFontInheritsLyrics}
                            onChange={onSubtitleFontInheritsLyricsChange}
                            theme={theme}
                            icon={Monitor}
                        />

                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm" style={{ color: theme.primaryColor }}>
                                <span>{t('options.subtitleFontScale')}</span>
                                <span className="font-mono opacity-70" style={{ color: theme.secondaryColor }}>
                                    {Math.round(subtitleFontScale * 100)}%
                                </span>
                            </div>
                            <input
                                aria-label={t('options.subtitleFontScale')}
                                type="range"
                                min="0.85"
                                max="1.4"
                                step="0.05"
                                value={subtitleFontScale}
                                onChange={(event) => onSubtitleFontScaleChange(parseFloat(event.target.value))}
                                onPointerDown={onSliderPointerDown}
                                onPointerUp={onSliderCommit}
                                className={rangeInputClass}
                            />
                        </div>

                        {!subtitleFontInheritsLyrics && (
                            <div className="space-y-4">
                                <PresetGroup
                                    label={t('options.subtitleFontFamily')}
                                    value={subtitleFontFamily ? 'custom' : subtitleFontStyle}
                                    options={subtitleFontStyleOptions}
                                    onChange={(next) => {
                                        if (next === 'custom') {
                                            onOpenSubtitleFontPicker?.();
                                        } else {
                                            onSubtitleFontFamilyChange?.(null);
                                            onSubtitleFontStyleChange?.(next as Theme['fontStyle']);
                                        }
                                    }}
                                    isDaylight={isDaylight}
                                    theme={theme}
                                />
                                <ToggleRow
                                    label={t('options.fontWeightAuto')}
                                    description={t('options.fontWeightAutoDesc')}
                                    checked={subtitleFontWeight === null}
                                    onChange={onSubtitleFontWeightFollowChange}
                                    theme={theme}
                                />
                                {subtitleFontWeight !== null && (
                                    <div className="space-y-4">
                                        <PresetGroup
                                            label={t('options.subtitleFontWeight')}
                                            value={subtitleFontWeightSliderValue}
                                            options={fontWeightOptions}
                                            onChange={(next) => {
                                                setSubtitleFontWeightSliderValue(next);
                                                onSubtitleFontWeightChange?.(next);
                                            }}
                                            isDaylight={isDaylight}
                                            theme={theme}
                                        />
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between text-sm" style={{ color: theme.primaryColor }}>
                                                <span>{t('options.subtitleFontWeight')}</span>
                                                <span className="font-mono opacity-70" style={{ color: theme.secondaryColor }}>
                                                    {subtitleFontWeightSliderValue}
                                                </span>
                                            </div>
                                            <input
                                                aria-label={t('options.subtitleFontWeight')}
                                                type="range"
                                                min="100"
                                                max="900"
                                                step="10"
                                                value={subtitleFontWeightSliderValue}
                                                onChange={(event) => {
                                                    const next = parseInt(event.target.value, 10);
                                                    setSubtitleFontWeightSliderValue(next);
                                                    onSubtitleFontWeightChange?.(next);
                                                }}
                                                onPointerDown={onSliderPointerDown}
                                                onPointerUp={onSliderCommit}
                                                onPointerCancel={onSliderCommit}
                                                className={rangeInputClass}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm" style={{ color: theme.primaryColor }}>
                                <span>{t('options.subtitleOverlayOpacity')}</span>
                                <span className="font-mono opacity-70" style={{ color: theme.secondaryColor }}>
                                    {Math.round(subtitleOverlayOpacity * 100)}%
                                </span>
                            </div>
                            <input
                                type="range"
                                min="0.2"
                                max="1"
                                step="0.05"
                                value={subtitleOverlayOpacity}
                                onChange={(event) => onSubtitleOverlayOpacityChange?.(parseFloat(event.target.value))}
                                onPointerDown={onSliderPointerDown}
                                onPointerUp={onSliderCommit}
                                className={rangeInputClass}
                            />
                        </div>
                    </div>
                )}

                {activeSection === 'subtitle' && (
                    <div className="rounded-[24px] border p-4 space-y-4" style={{ backgroundColor: controlCardBg, borderColor: colorWithAlpha(theme.secondaryColor, 0.16) }}>
                        <div className="space-y-1">
                            <div className="text-sm font-medium" style={{ color: theme.primaryColor }}>
                                {t('options.harmonySubtitleSettings')}
                            </div>
                            <div className="text-xs opacity-70" style={{ color: theme.secondaryColor }}>
                                {t('options.harmonySubtitleSettingsDesc')}
                            </div>
                        </div>

                        <ToggleRow
                            label={t('options.showHarmonySubtitle')}
                            description={t('options.showHarmonySubtitleDesc')}
                            checked={showHarmonySubtitle}
                            onChange={onToggleShowHarmonySubtitle}
                            theme={theme}
                            icon={Monitor}
                        />

                        <ToggleRow
                            label={t('options.harmonySubtitleBackground')}
                            description={t('options.harmonySubtitleBackgroundDesc')}
                            checked={harmonySubtitleBackground}
                            onChange={onToggleHarmonySubtitleBackground}
                            theme={theme}
                            icon={PanelTop}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};

export default VisPlaygroundSettingsPanel;
