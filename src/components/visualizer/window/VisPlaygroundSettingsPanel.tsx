import React, { useEffect, useMemo, useState } from 'react';
import { type Theme, type SubtitleContentMode, type VisualizerBackgroundMode, type VisualizerMode } from '../../../types';
import { Button, Group, PictureGrid, Reveal, Row, Segmented, Select, Tabs, Value, type PictureState } from '../../modal/settings/kit';
import type { SettingsGroupDef } from '../../modal/settings/kit';
import { StudioColumnBody } from '../../shared/StudioWindow';
import { percent, SliderRow, ToggleRow } from '../panelRows';
import { type VisualizerRegistryEntry } from '../registry';
import { type VisPlaygroundEditSection } from './VisPlaygroundPreviewHotspots';
import { FontTiles, type FontChoice } from './FontTiles';
import type { StyleDraft } from './useTuningDrafts';
import type { VisualizerTuningSettings } from '../tuningDefinition';
import { FoliumTuningCards, tuningsRegistry } from '@/mods/folium/registries/tunings';
import { backgroundsRegistry } from '@/mods/folium/registries/backgrounds';
import { useFoliumRegistryEntries } from '@/mods/runtime/registry';
import { useMissingFoliumSelections } from '@/mods/runtime/missingEntries';
import { type PreviewPlaceholderId } from '../PreviewPlaceholder';
import type { VisualizerBackgroundActions, VisualizerBackgroundConfig } from '../backgrounds/definition';
import {
    DEFAULT_VISUALIZER_BACKGROUND_MODE,
    getVisualizerBackgroundModeLabel,
    getVisualizerBackgroundRegistryEntry,
    VISUALIZER_BACKGROUND_REGISTRY,
} from '../backgrounds/registry';
import BackgroundPicture from '../preview/BackgroundPicture';
import { usePlayerChromeSettingsStore } from '../../../stores/usePlayerChromeSettingsStore';
import SmartBeatSettingsCard from '../SmartBeatSettingsCard';
import BeatEffectsGroup from '../BeatEffectsGroup';

// src/components/visualizer/window/VisPlaygroundSettingsPanel.tsx
// The right column of the lyric style window: four tabs with one "default" action for the open
// tab, and the open tab's options as settings-kit groups. The chosen style's and the chosen
// background's own options come from their registry entries and are stacked as they come.
interface PresetOption<T> {
    label: string;
    value: T;
}

interface VisPlaygroundSettingsPanelProps {
    activeSection: VisPlaygroundEditSection;
    onSectionChange: (section: VisPlaygroundEditSection) => void;
    t: (key: string) => string;
    isDaylight: boolean;
    theme: Theme;
    visualizerMode: VisualizerMode;
    visualizerEntry: VisualizerRegistryEntry;
    /** The chosen style's tuning as the window shows it, with its change and its reset. */
    styleDraft: StyleDraft;
    /** The settings store's fields of the styles and the backgrounds, handed on to the style's own panel. */
    settings: VisualizerTuningSettings;
    controlCardBg: string;
    rangeInputClass: string;
    visualizerOpacity: number;
    onVisualizerOpacityChange?: (opacity: number) => void;
    backgroundConfig?: VisualizerBackgroundConfig;
    backgroundActions?: VisualizerBackgroundActions;
    previewPlaceholderId: PreviewPlaceholderId;
    previewPlaceholderOptions: PresetOption<PreviewPlaceholderId>[];
    onPreviewPlaceholderChange: (id: PreviewPlaceholderId) => void;
    fontStyleValue: FontChoice;
    fontStyleOptions: PresetOption<FontChoice>[];
    subtitleFontStyleOptions: PresetOption<FontChoice>[];
    onFontStyleChange: (fontStyle: FontChoice) => void;
    /** The custom lyric font, when one is chosen: its picture is drawn in it. */
    customFontFamily: string | null;
    /** The custom font's name as the user sees it. */
    currentFontLabel: string;
    fontScale: number;
    /** The sizes people come back to: marks on the size slider. */
    fontScaleOptions: PresetOption<number>[];
    onFontScaleChange: (fontScale: number) => void;
    subtitleFontScale: number;
    onSubtitleFontScaleChange: (fontScale: number) => void;
    fontWeight: number | null;
    /** The weights people come back to: marks on the weight sliders. */
    fontWeightOptions: PresetOption<number>[];
    onFontWeightChange: (fontWeight: number | null) => void;
    onFontWeightFollowChange: (follow: boolean) => void;
    onResetCommonSettings?: () => void;
    hideTranslationSubtitle: boolean;
    onToggleHideTranslationSubtitle?: (hidden: boolean) => void;
    onToggleShowSubtitleTranslation?: (shown: boolean) => void;
    subtitleContentMode: SubtitleContentMode;
    onSubtitleContentModeChange?: (mode: SubtitleContentMode) => void;
    subtitleOverlayOpacity: number;
    onSubtitleOverlayOpacityChange?: (opacity: number) => void;
    subtitleOverlayBackground: boolean;
    onToggleSubtitleOverlayBackground?: (enabled: boolean) => void;
    subtitleUpcomingLyricsBlur: boolean;
    onToggleSubtitleUpcomingLyricsBlur?: (enabled: boolean) => void;
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
    onOpenSubtitleFontPicker?: () => void;
    onResetSubtitleSettings?: () => void;
    onSliderPointerDown?: () => void;
    onSliderCommit?: () => void;
}

const SECTION_OPTIONS: VisPlaygroundEditSection[] = ['visualizer', 'background', 'common', 'subtitle'];

const SECTION_LABEL_KEYS: Record<VisPlaygroundEditSection, string> = {
    visualizer: 'options.previewVisualizerSettings',
    background: 'options.previewBackgroundSettings',
    common: 'options.previewCommonSettings',
    subtitle: 'options.previewSubtitleSettings',
};

// The window's own groups. A group without a heading still needs a name for assistive tech.
const STYLE_NOTICE_GROUP: SettingsGroupDef = { id: 'vis-style-notice', titleKey: 'options.previewVisualizerGroup' };
const BACKGROUND_NOTICE_GROUP: SettingsGroupDef = { id: 'vis-background-notice', titleKey: 'options.previewBackgroundGroup' };
const BACKGROUND_KIND_GROUP: SettingsGroupDef = { id: 'vis-background-kind', titleKey: 'options.visualizerBackgroundMode' };
const COMMON_GROUP: SettingsGroupDef = { id: 'vis-common', titleKey: 'options.previewCommonSettings' };
const SUBTITLE_GROUP: SettingsGroupDef = { id: 'vis-subtitle', titleKey: 'options.previewSubtitleSettings' };
const HARMONY_GROUP: SettingsGroupDef = { id: 'vis-harmony', titleKey: 'options.harmonySubtitleSettings' };
const SUBTITLE_FONT_GROUP: SettingsGroupDef = { id: 'vis-subtitle-font', titleKey: 'options.subtitleFontFamily' };

const toMarks = (options: PresetOption<number>[]) => options.map(option => ({ value: option.value, label: option.label }));

const drawBackground = (mode: VisualizerBackgroundMode, state: PictureState) => <BackgroundPicture mode={mode} {...state} />;

const VisPlaygroundSettingsPanel: React.FC<VisPlaygroundSettingsPanelProps> = (props) => {
    const {
        activeSection,
        onSectionChange,
        t,
        isDaylight,
        theme,
        visualizerMode,
        visualizerEntry,
        styleDraft,
        settings,
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
        fontStyleOptions,
        subtitleFontStyleOptions,
        onFontStyleChange,
        customFontFamily,
        currentFontLabel,
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
        hideTranslationSubtitle,
        onToggleHideTranslationSubtitle,
        onToggleShowSubtitleTranslation,
        subtitleContentMode,
        onSubtitleContentModeChange,
        subtitleOverlayOpacity,
        onSubtitleOverlayOpacityChange,
        subtitleOverlayBackground,
        onToggleSubtitleOverlayBackground,
        subtitleUpcomingLyricsBlur,
        onToggleSubtitleUpcomingLyricsBlur,
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
        onOpenSubtitleFontPicker,
        onResetSubtitleSettings,
        onSliderPointerDown,
        onSliderCommit,
    } = props;
    // A style that sizes its own lyrics: the font size row is disabled and its notice says why.
    const lyricsFontSizeAutoNoticeKey = visualizerEntry.ownFontSizeNoticeKey ?? null;
    const [fontWeightSliderValue, setFontWeightSliderValue] = useState(fontWeight ?? 400);
    const [subtitleFontWeightSliderValue, setSubtitleFontWeightSliderValue] = useState(subtitleFontWeight ?? 400);

    useEffect(() => {
        if (fontWeight !== null) setFontWeightSliderValue(fontWeight);
    }, [fontWeight]);
    useEffect(() => {
        if (subtitleFontWeight !== null) setSubtitleFontWeightSliderValue(subtitleFontWeight);
    }, [subtitleFontWeight]);

    // Mod backgrounds and tunings come and go at runtime (Folium registries), so what is listed
    // here recomputes on registry changes, not only on language changes.
    const foliumBackgroundEntries = useFoliumRegistryEntries(backgroundsRegistry);
    const hasModTunings = useFoliumRegistryEntries(tuningsRegistry).some(entry => entry.def.target === visualizerMode);
    const missingFoliumSelections = useMissingFoliumSelections();

    const enablePlayerPageNativeBlur = usePlayerChromeSettingsStore(state => state.enablePlayerPageNativeBlur);
    const resolvedBackgroundMode = backgroundConfig?.mode ?? DEFAULT_VISUALIZER_BACKGROUND_MODE;
    const backgroundEntry = getVisualizerBackgroundRegistryEntry(resolvedBackgroundMode);
    const backgroundModeOptions = useMemo(() => (
        VISUALIZER_BACKGROUND_REGISTRY.map(entry => ({
            value: entry.mode,
            label: getVisualizerBackgroundModeLabel(entry.mode, t),
        }))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    ), [t, foliumBackgroundEntries]);
    const missingNotice = (kind: 'visualizer' | 'background') => {
        const missing = missingFoliumSelections.find(entry => entry.kind === kind);
        return missing ? t('options.foliumMissingSelection').replace('{{modId}}', missing.modId) : null;
    };
    const missingStyleNotice = missingNotice('visualizer');
    const missingBackgroundNotice = missingNotice('background');
    const fontScaleMarks = useMemo(() => toMarks(fontScaleOptions), [fontScaleOptions]);
    const fontWeightMarks = useMemo(() => toMarks(fontWeightOptions), [fontWeightOptions]);

    // What the one "default" action does for the open tab; nothing where the tab has nothing to reset.
    const resetOpenTab: (() => void) | undefined = activeSection === 'visualizer'
        ? (visualizerEntry.renderSettingsPanel ? styleDraft.reset : undefined)
        : activeSection === 'background'
            ? (backgroundEntry.resetSettings ? () => backgroundEntry.resetSettings?.(backgroundActions) : undefined)
            : activeSection === 'common'
                ? () => {
                    onPreviewPlaceholderChange('default');
                    onResetCommonSettings?.();
                }
                : onResetSubtitleSettings;

    const stylePanel = visualizerEntry.renderSettingsPanel?.({
        t,
        isDaylight,
        theme,
        controlCardBg,
        rangeInputClass,
        tuning: styleDraft.tuning,
        onTuningChange: styleDraft.change,
        settings,
        onSliderPointerDown,
        onSliderCommit,
    });

    return (
        <>
            <Tabs
                tabs={SECTION_OPTIONS.map(section => ({ id: section, label: t(SECTION_LABEL_KEYS[section]) }))}
                activeId={activeSection}
                onSelect={id => onSectionChange(id as VisPlaygroundEditSection)}
                label={t('options.lyricsStyleSettings')}
                className="px-4 pt-2 sm:px-6"
                action={(
                    <span className="pr-3 sm:pr-4">
                        <Button variant="quiet" disabled={!resetOpenTab} onClick={() => resetOpenTab?.()}>{t('ui.default')}</Button>
                    </span>
                )}
            />
            <StudioColumnBody>
                <div key={activeSection} className="st-page-in">
                    {activeSection === 'visualizer' && (
                        <>
                            {missingStyleNotice && (
                                <Group def={STYLE_NOTICE_GROUP} bare>
                                    <Row notice={missingStyleNotice} />
                                </Group>
                            )}
                            {/* 智能动感模式: a setting of the whole picture, above whichever style's own options. */}
                            <SmartBeatSettingsCard t={t} />
                            {/* The style's own options: kit groups, stacked as they come. */}
                            <div key={visualizerMode} className="st-page-in">
                                {/* Its 智能动感模式 effects, each named, switched and scaled on its own. */}
                                <BeatEffectsGroup
                                    t={t}
                                    effects={visualizerEntry.beatEffects}
                                    onSliderPointerDown={onSliderPointerDown}
                                    onSliderCommit={onSliderCommit}
                                />
                                {stylePanel}
                                {/* Folium tunings other mods registered for this mode (registries.tunings): cards of the mods' own make. */}
                                <div className="mt-7 space-y-4 empty:hidden">
                                    <FoliumTuningCards
                                        mode={visualizerMode}
                                        theme={theme}
                                        isDaylight={isDaylight}
                                        controlCardBg={controlCardBg}
                                        rangeInputClass={rangeInputClass}
                                        description={t('options.foliumTuningDesc')}
                                    />
                                </div>
                                {!stylePanel && !hasModTunings && (
                                    <p className="py-14 text-center text-[13px] text-[color:var(--st-t3)]">{t('options.lyricStyleNoOptions')}</p>
                                )}
                            </div>
                        </>
                    )}

                    {activeSection === 'background' && (
                        <>
                            {(enablePlayerPageNativeBlur || missingBackgroundNotice) && (
                                <Group def={BACKGROUND_NOTICE_GROUP} bare>
                                    {enablePlayerPageNativeBlur && <Row notice={t('options.nativeBlurBackgroundNotice')} />}
                                    {missingBackgroundNotice && <Row notice={missingBackgroundNotice} />}
                                </Group>
                            )}
                            <Group def={BACKGROUND_KIND_GROUP}>
                                <div className="py-3">
                                    <PictureGrid
                                        value={resolvedBackgroundMode}
                                        options={backgroundModeOptions}
                                        picture={drawBackground}
                                        columns={3}
                                        onChange={mode => backgroundActions?.onModeChange?.(mode)}
                                        label={t('options.visualizerBackgroundMode')}
                                    />
                                </div>
                            </Group>
                            {/* The chosen background's own options. */}
                            <div key={resolvedBackgroundMode} className="st-page-in mt-7">
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
                            </div>
                        </>
                    )}

                    {activeSection === 'common' && (
                        <Group def={COMMON_GROUP} bare>
                            {lyricsFontSizeAutoNoticeKey !== null && <Row notice={t(lyricsFontSizeAutoNoticeKey)} />}
                            <Row label={t('options.previewText')}>
                                <Segmented value={previewPlaceholderId} options={previewPlaceholderOptions} onChange={onPreviewPlaceholderChange} />
                            </Row>
                            <Row
                                label={t('options.fontFamily')}
                                below={(
                                    <FontTiles
                                        value={fontStyleValue}
                                        options={fontStyleOptions}
                                        customFamily={customFontFamily}
                                        label={t('options.fontFamily')}
                                        onChange={onFontStyleChange}
                                    />
                                )}
                            />
                            <Reveal when={fontStyleValue === 'custom'}>
                                <Row sub label={t('options.currentFont')}>
                                    <Value tip={currentFontLabel}>{currentFontLabel}</Value>
                                    <Button onClick={() => onFontStyleChange('custom')}>{t('options.chooseSystemFont')}</Button>
                                </Row>
                            </Reveal>
                            <SliderRow
                                label={t('options.fontSize')}
                                disabled={lyricsFontSizeAutoNoticeKey !== null}
                                value={fontScale}
                                min={0.85}
                                max={1.4}
                                step={0.05}
                                marks={fontScaleMarks}
                                format={percent}
                                onChange={onFontScaleChange}
                                onDragStart={onSliderPointerDown}
                                onDragEnd={onSliderCommit}
                            />
                            <ToggleRow
                                label={t('options.fontWeightAuto')}
                                note={t('options.fontWeightAutoDesc')}
                                checked={fontWeight === null}
                                onChange={onFontWeightFollowChange}
                            />
                            <Reveal when={fontWeight !== null}>
                                <SliderRow
                                    sub
                                    label={t('options.fontWeight')}
                                    value={fontWeightSliderValue}
                                    min={100}
                                    max={900}
                                    step={10}
                                    marks={fontWeightMarks}
                                    format={String}
                                    onChange={(next) => {
                                        setFontWeightSliderValue(next);
                                        onFontWeightChange(next);
                                    }}
                                    onDragStart={onSliderPointerDown}
                                    onDragEnd={onSliderCommit}
                                />
                            </Reveal>
                            <SliderRow
                                label={t('options.visualizerOpacity')}
                                value={visualizerOpacity}
                                min={0.2}
                                max={1}
                                step={0.05}
                                format={percent}
                                onChange={next => onVisualizerOpacityChange?.(next)}
                                onDragStart={onSliderPointerDown}
                                onDragEnd={onSliderCommit}
                            />
                        </Group>
                    )}

                    {activeSection === 'subtitle' && (
                        <>
                            <Group def={SUBTITLE_GROUP} bare>
                                <ToggleRow
                                    label={t('options.hidePlayerTranslationSubtitle')}
                                    note={t('options.hidePlayerTranslationSubtitleDesc')}
                                    checked={hideTranslationSubtitle}
                                    disabled={!onToggleHideTranslationSubtitle}
                                    onChange={next => onToggleHideTranslationSubtitle?.(next)}
                                />
                                <Row label={t('options.subtitleContentMode')}>
                                    <Select<SubtitleContentMode>
                                        value={subtitleContentMode}
                                        options={[
                                            { label: t('options.subtitleContentTranslation'), value: 'translation' },
                                            { label: t('options.subtitleContentRomanization'), value: 'romanization' },
                                            { label: t('options.subtitleContentBoth'), value: 'both' },
                                            { label: t('options.subtitleContentNone'), value: 'none' },
                                        ]}
                                        onChange={onSubtitleContentModeChange ?? (mode => onToggleShowSubtitleTranslation?.(mode !== 'none'))}
                                    />
                                </Row>
                                <SliderRow
                                    label={t('options.subtitleOverlayOpacity')}
                                    value={subtitleOverlayOpacity}
                                    min={0.2}
                                    max={1}
                                    step={0.05}
                                    format={percent}
                                    onChange={next => onSubtitleOverlayOpacityChange?.(next)}
                                    onDragStart={onSliderPointerDown}
                                    onDragEnd={onSliderCommit}
                                />
                                <ToggleRow
                                    label={t('options.subtitleOverlayBackground')}
                                    note={t('options.subtitleOverlayBackgroundDesc')}
                                    checked={subtitleOverlayBackground}
                                    disabled={!onToggleSubtitleOverlayBackground}
                                    onChange={next => onToggleSubtitleOverlayBackground?.(next)}
                                />
                                <ToggleRow
                                    label={t('options.subtitleUpcomingLyricsBlur')}
                                    checked={subtitleUpcomingLyricsBlur}
                                    disabled={!onToggleSubtitleUpcomingLyricsBlur}
                                    onChange={next => onToggleSubtitleUpcomingLyricsBlur?.(next)}
                                />
                            </Group>

                            <Group def={HARMONY_GROUP}>
                                <ToggleRow
                                    label={t('options.showHarmonySubtitle')}
                                    note={t('options.showHarmonySubtitleDesc')}
                                    checked={showHarmonySubtitle}
                                    disabled={!onToggleShowHarmonySubtitle}
                                    onChange={next => onToggleShowHarmonySubtitle?.(next)}
                                />
                                <Reveal when={showHarmonySubtitle}>
                                    <ToggleRow
                                        sub
                                        label={t('options.harmonySubtitleBackground')}
                                        note={t('options.harmonySubtitleBackgroundDesc')}
                                        checked={harmonySubtitleBackground}
                                        disabled={!onToggleHarmonySubtitleBackground}
                                        onChange={next => onToggleHarmonySubtitleBackground?.(next)}
                                    />
                                </Reveal>
                            </Group>

                            <Group def={SUBTITLE_FONT_GROUP}>
                                <ToggleRow
                                    label={t('options.subtitleFontInheritsLyrics')}
                                    note={t('options.subtitleFontInheritsLyricsDesc')}
                                    checked={subtitleFontInheritsLyrics}
                                    disabled={!onSubtitleFontInheritsLyricsChange}
                                    onChange={next => onSubtitleFontInheritsLyricsChange?.(next)}
                                />
                                <Reveal when={!subtitleFontInheritsLyrics}>
                                    <Row
                                        sub
                                        label={t('options.subtitleFontFamily')}
                                        below={(
                                            <FontTiles
                                                value={subtitleFontFamily ? 'custom' : subtitleFontStyle}
                                                options={subtitleFontStyleOptions}
                                                customFamily={subtitleFontFamily}
                                                label={t('options.subtitleFontFamily')}
                                                onChange={(next) => {
                                                    if (next === 'custom') {
                                                        onOpenSubtitleFontPicker?.();
                                                    } else {
                                                        onSubtitleFontFamilyChange?.(null);
                                                        onSubtitleFontStyleChange?.(next);
                                                    }
                                                }}
                                            />
                                        )}
                                    />
                                    <Reveal when={Boolean(subtitleFontFamily)}>
                                        <Row sub label={t('options.currentFont')}>
                                            <Value tip={subtitleFontFamily ?? undefined}>{subtitleFontFamily}</Value>
                                            <Button onClick={() => onOpenSubtitleFontPicker?.()}>{t('options.chooseSystemFont')}</Button>
                                        </Row>
                                    </Reveal>
                                    <ToggleRow
                                        sub
                                        label={t('options.fontWeightAuto')}
                                        note={t('options.fontWeightAutoDesc')}
                                        checked={subtitleFontWeight === null}
                                        disabled={!onSubtitleFontWeightFollowChange}
                                        onChange={next => onSubtitleFontWeightFollowChange?.(next)}
                                    />
                                    <Reveal when={subtitleFontWeight !== null}>
                                        <SliderRow
                                            sub
                                            label={t('options.subtitleFontWeight')}
                                            value={subtitleFontWeightSliderValue}
                                            min={100}
                                            max={900}
                                            step={10}
                                            marks={fontWeightMarks}
                                            format={String}
                                            onChange={(next) => {
                                                setSubtitleFontWeightSliderValue(next);
                                                onSubtitleFontWeightChange?.(next);
                                            }}
                                            onDragStart={onSliderPointerDown}
                                            onDragEnd={onSliderCommit}
                                        />
                                    </Reveal>
                                </Reveal>
                                <SliderRow
                                    label={t('options.subtitleFontScale')}
                                    value={subtitleFontScale}
                                    min={0.85}
                                    max={1.4}
                                    step={0.05}
                                    format={percent}
                                    onChange={onSubtitleFontScaleChange}
                                    onDragStart={onSliderPointerDown}
                                    onDragEnd={onSliderCommit}
                                />
                            </Group>
                        </>
                    )}
                </div>
            </StudioColumnBody>
        </>
    );
};

export default VisPlaygroundSettingsPanel;
