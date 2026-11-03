import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { DualTheme, SongResult, Theme } from '../../types';
import type { ThemeCacheSongKey } from '../../services/themeCache';
import { FALLBACK_AI_DUAL_THEME, sanitizeDualTheme } from '../../services/themeSanitizer';
import { BASE_DUAL_THEME } from '../../services/baseThemes';
import { useThemeQuickEditorStore, type ThemeQuickEditorKind } from '../../stores/useThemeQuickEditorStore';
import { Button, CopyButton } from '../modal/settings/kit';
import { ThemeColorPickerCard, ThemeColorWells, ThemeModeSwitch } from '../modal/theme-park/ThemeColorParts';
import ThemeNameField from '../modal/theme-park/ThemeNameField';
import { SAMPLE_COLOR_MOTION_CLASS, ThemeSampleButton, ThemeSampleCard, themeSampleVars } from '../modal/theme-park/ThemeSample';
import { AiThemeJsonBox, buildAiThemePrompt, useAiThemeImport, type AiThemePromptSource } from '../modal/theme-park/aiThemeTransfer';
import { isThemeNameValid, type EditableColorKey, type EditableMode } from '../modal/theme-park/themeParkDraft';
import { useThemeRecommendedColors } from '../modal/theme-park/useThemeRecommendedColors';
import { Sheet, SheetButton } from '../shared/Sheet';
import { useColorPreviewThrottle } from '../shared/useColorPreviewThrottle';
import { VIS_PLAYGROUND_PREVIEW_LINES } from '../visualizer/PreviewPlaceholder';

// src/components/panelTab/ThemeQuickEditor.tsx
// The quick theme editor, opened from the control panel's theme row: a dialog with a sample strip,
// the light and dark sides, the four colours and one picker, and the name of the side being edited.
// It is the colour tab of Theme Park made small, built from the same parts. For an AI theme it can
// also take a theme as JSON: that step comes in inside the same dialog.

/** The line the sample strip shows: the lyric sample's line in Latin letters, with its translation. */
const SAMPLE_LINE = VIS_PLAYGROUND_PREVIEW_LINES[1];
/** How many of its words are drawn as sung already; the next one is the word being sung. */
const SAMPLE_SUNG_WORDS = 2;

/** The theme at work, small: a lyric line, a now-playing card and a button. */
const ThemeQuickSample: React.FC<{ theme: Theme }> = ({ theme }) => (
    <div
        aria-hidden
        className={`${SAMPLE_COLOR_MOTION_CLASS} relative flex h-[104px] items-center gap-4 overflow-hidden rounded-xl bg-[var(--ts-bg)] px-5 shadow-[0_0_0_1px_var(--st-line)]`}
        style={themeSampleVars(theme)}
    >
        {/* A glow of the secondary colour behind the line, as the lyric backgrounds have. */}
        <span className={`${SAMPLE_COLOR_MOTION_CLASS} pointer-events-none absolute inset-0 bg-[var(--ts-muted)] opacity-[0.28] [mask-image:radial-gradient(60%_75%_at_50%_46%,#000,transparent)]`} />
        <div className="relative min-w-0 flex-1">
            <p className={`${SAMPLE_COLOR_MOTION_CLASS} truncate text-xl font-semibold leading-7 text-[color:var(--ts-fg)]`}>
                {(SAMPLE_LINE.words ?? []).map((word, index) => (
                    <span
                        key={index}
                        className={index < SAMPLE_SUNG_WORDS ? 'opacity-[0.42]' : index === SAMPLE_SUNG_WORDS ? `${SAMPLE_COLOR_MOTION_CLASS} text-[color:var(--ts-accent)]` : undefined}
                    >
                        {word.text}{' '}
                    </span>
                ))}
            </p>
            <p className={`${SAMPLE_COLOR_MOTION_CLASS} mt-1 truncate text-xs leading-[18px] text-[color:var(--ts-muted)]`}>{SAMPLE_LINE.translation}</p>
        </div>
        <ThemeSampleCard />
        <ThemeSampleButton />
    </div>
);

type ThemeQuickEditorProps = {
    isOpen: boolean;
    kind: ThemeQuickEditorKind;
    initialTheme: DualTheme;
    coverUrl: string | null;
    isDaylight: boolean;
    promptSource: AiThemePromptSource;
    onClose: () => void;
    onSave: (theme: DualTheme) => void;
};

const ThemeQuickEditor: React.FC<ThemeQuickEditorProps> = ({
    isOpen,
    kind,
    initialTheme,
    coverUrl,
    isDaylight,
    promptSource,
    onClose,
    onSave,
}) => {
    const { t } = useTranslation();
    const normalizedInitialTheme = useMemo(() => sanitizeDualTheme(initialTheme), [initialTheme]);
    const [draftTheme, setDraftTheme] = useState<DualTheme>(() => normalizedInitialTheme);
    const [mode, setMode] = useState<EditableMode>(() => (isDaylight ? 'light' : 'dark'));
    const [activeKey, setActiveKey] = useState<EditableColorKey>('accentColor');
    const [themeNames, setThemeNames] = useState(() => ({
        light: normalizedInitialTheme.light.name || '',
        dark: normalizedInitialTheme.dark.name || '',
    }));
    const [view, setView] = useState<'main' | 'import'>('main');
    // Whether the view has changed since the dialog opened: the first view is there with the dialog,
    // a later one comes in.
    const viewChangedRef = useRef(false);

    useEffect(() => {
        setDraftTheme(normalizedInitialTheme);
        setThemeNames({
            light: normalizedInitialTheme.light.name || '',
            dark: normalizedInitialTheme.dark.name || '',
        });
        setMode(isDaylight ? 'light' : 'dark');
        setActiveKey('accentColor');
    }, [isDaylight, normalizedInitialTheme]);

    // 组件内调色板产生的必定是合法 Hex，直接跳过 sanitizeDualTheme 以节约性能
    const activeTheme = draftTheme[mode];
    const recommendedColors = useThemeRecommendedColors(normalizedInitialTheme, coverUrl);

    const writeColor = (color: string) => {
        setDraftTheme(previous => ({
            ...previous,
            [mode]: {
                ...previous[mode],
                [activeKey]: color,
            },
        }));
    };
    // A drag writes at the pace of the app's colour previews; a choice writes at once, after what
    // the drag still held back.
    const { previewColor, flushColor } = useColorPreviewThrottle(writeColor);
    const chooseColor = (color: string) => {
        flushColor();
        writeColor(color);
    };

    // Returns a safe, named dual theme for saving or copying.
    const buildFinalTheme = () => sanitizeDualTheme({
        ...draftTheme,
        light: { ...draftTheme.light, name: themeNames.light.trim() },
        dark: { ...draftTheme.dark, name: themeNames.dark.trim() },
    }, normalizedInitialTheme);

    const isNameValid = isThemeNameValid(themeNames.light) && isThemeNameValid(themeNames.dark);

    const handleSave = () => {
        if (!isNameValid) return;
        onSave(buildFinalTheme());
    };

    // An imported theme is saved as it is read, as before.
    const importer = useAiThemeImport(normalizedInitialTheme, onSave);

    const showView = (next: 'main' | 'import') => {
        viewChangedRef.current = true;
        setView(next);
    };

    const handleReset = () => {
        if (kind === 'custom') {
            setDraftTheme(previous => ({
                ...previous,
                light: {
                    ...previous.light,
                    backgroundColor: BASE_DUAL_THEME.light.backgroundColor,
                    primaryColor: BASE_DUAL_THEME.light.primaryColor,
                    accentColor: BASE_DUAL_THEME.light.accentColor,
                    secondaryColor: BASE_DUAL_THEME.light.secondaryColor,
                },
                dark: {
                    ...previous.dark,
                    backgroundColor: BASE_DUAL_THEME.dark.backgroundColor,
                    primaryColor: BASE_DUAL_THEME.dark.primaryColor,
                    accentColor: BASE_DUAL_THEME.dark.accentColor,
                    secondaryColor: BASE_DUAL_THEME.dark.secondaryColor,
                },
            }));
            return;
        }
        setDraftTheme(normalizedInitialTheme);
        setThemeNames({
            light: normalizedInitialTheme.light.name || '',
            dark: normalizedInitialTheme.dark.name || '',
        });
    };

    // Both views lie in one place, so the dialog keeps its size; the one that is not shown is out of
    // sight and out of reach.
    const viewClass = (shown: boolean) => `col-start-1 row-start-1 min-w-0 ${shown ? (viewChangedRef.current ? 'st-page-in' : '') : 'invisible'}`;

    return (
        <Sheet
            isOpen={isOpen}
            onClose={onClose}
            size="m"
            title={view === 'import'
                ? t('options.manualImportAiTheme')
                : t(kind === 'custom' ? 'options.customThemeQuickEditTitle' : 'options.aiThemeQuickEditTitle')}
            headerActions={view === 'main' ? (
                <Button variant="quiet" onClick={handleReset}>{t('ui.resetToDefaultTheme')}</Button>
            ) : undefined}
            footer={view === 'main' ? (
                <>
                    <div className="mr-auto flex flex-wrap gap-2">
                        {kind === 'ai' && (
                            <SheetButton onClick={() => showView('import')}>{t('options.manualImportAiTheme')}</SheetButton>
                        )}
                        <CopyButton text={() => JSON.stringify(buildFinalTheme(), null, 2)} disabled={!isNameValid}>
                            {t('options.copyThemeJson')}
                        </CopyButton>
                    </div>
                    <SheetButton variant="primary" disabled={!isNameValid} onClick={handleSave}>
                        {t(kind === 'custom' ? 'options.customThemeQuickEditSave' : 'options.aiThemeQuickEditSave')}
                    </SheetButton>
                </>
            ) : (
                <>
                    <SheetButton
                        onClick={() => {
                            importer.clear();
                            showView('main');
                        }}
                    >
                        {t('ui.cancel')}
                    </SheetButton>
                    <SheetButton variant="primary" disabled={!importer.canApply} onClick={importer.apply}>
                        {t('ui.apply')}
                    </SheetButton>
                </>
            )}
        >
            <div className="grid">
                <div inert={view !== 'main'} className={viewClass(view === 'main')}>
                    <ThemeQuickSample theme={activeTheme} />
                    <div className="mt-4 grid gap-5 sm:grid-cols-[220px_minmax(0,1fr)]">
                        <div className="flex min-w-0 flex-col gap-3">
                            <ThemeModeSwitch mode={mode} onChange={setMode} />
                            <ThemeColorWells theme={activeTheme} activeKey={activeKey} onChange={setActiveKey} stacked />
                            <label className="block">
                                <span className="mb-1.5 ml-0.5 block text-xs leading-[18px] text-[color:var(--st-t2)]">{t('options.themeName')}</span>
                                <ThemeNameField
                                    value={themeNames[mode]}
                                    onChange={name => setThemeNames(previous => ({ ...previous, [mode]: name }))}
                                />
                            </label>
                        </div>
                        <ThemeColorPickerCard
                            theme={activeTheme}
                            activeKey={activeKey}
                            recommendedColors={recommendedColors}
                            onDrag={previewColor}
                            onChange={chooseColor}
                            areaHeight={150}
                        />
                    </div>
                </div>

                {kind === 'ai' && (
                    <div inert={view !== 'import'} className={`${viewClass(view === 'import')} flex flex-col`}>
                        <div className="flex items-center justify-between gap-3">
                            <h3 className="text-sm leading-5">{t('aiHelp.copyPromptTitle')}</h3>
                            <CopyButton text={() => buildAiThemePrompt(promptSource)}>{t('aiHelp.copyPrompt')}</CopyButton>
                        </div>
                        <h3 className="mb-3 mt-5 text-sm leading-5">{t('aiHelp.importJsonTitle')}</h3>
                        <AiThemeJsonBox importer={importer} className="min-h-[132px] flex-1" />
                    </div>
                )}
            </div>
        </Sheet>
    );
};

type ThemeQuickEditorHostProps = {
    onSaveAiTheme: (theme: DualTheme, song: SongResult | null, songKey: ThemeCacheSongKey | null) => void;
    onSaveCustomTheme: (theme: DualTheme) => void;
};

const ThemeQuickEditorHost: React.FC<ThemeQuickEditorHostProps> = ({ onSaveAiTheme, onSaveCustomTheme }) => {
    const { isOpen, editorKind, aiTheme, customTheme, coverUrl, isDaylight, song, songKey, closeEditor, promptSourceText, isPureMusic, songTitle } = useThemeQuickEditorStore(useShallow(state => ({
        isOpen: state.isOpen,
        editorKind: state.editorKind,
        aiTheme: state.aiTheme,
        customTheme: state.customTheme,
        coverUrl: state.coverUrl,
        isDaylight: state.isDaylight,
        song: state.song,
        songKey: state.songKey,
        promptSourceText: state.promptSourceText,
        isPureMusic: state.isPureMusic,
        songTitle: state.songTitle,
        closeEditor: state.closeEditor,
    })));
    const initialTheme = editorKind === 'custom' ? customTheme : (aiTheme ?? FALLBACK_AI_DUAL_THEME);
    const open = isOpen && editorKind && initialTheme ? { kind: editorKind, initialTheme } : null;

    // The dialog keeps what it shows while it leaves, and every opening starts a new editor: the
    // last opened editor is held here, under a key that counts the openings. It stays mounted while
    // closed, with the cover it had: a closed editor does not read the next songs' covers.
    const heldRef = useRef<{ kind: ThemeQuickEditorKind; initialTheme: DualTheme; coverUrl: typeof coverUrl } | null>(null);
    const openingsRef = useRef(0);
    const wasOpenRef = useRef(false);
    if (open) {
        if (!wasOpenRef.current) openingsRef.current += 1;
        heldRef.current = { ...open, coverUrl };
    }
    wasOpenRef.current = Boolean(open);
    const held = heldRef.current;
    if (!held) {
        return null;
    }

    return (
        <ThemeQuickEditor
            key={openingsRef.current}
            isOpen={Boolean(open)}
            kind={held.kind}
            initialTheme={held.initialTheme}
            coverUrl={held.coverUrl}
            isDaylight={isDaylight}
            promptSource={{ promptSourceText, isPureMusic, songTitle }}
            onClose={closeEditor}
            onSave={(theme) => {
                if (held.kind === 'custom') {
                    onSaveCustomTheme(theme);
                } else {
                    onSaveAiTheme(theme, song, songKey);
                }
                closeEditor();
            }}
        />
    );
};

export default ThemeQuickEditorHost;
