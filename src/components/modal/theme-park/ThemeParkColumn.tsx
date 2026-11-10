import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, useSettingsKitTheme } from '../settings/kit';
import { settingsTokens } from '../settings/kit/kitTheme';
import { kitMotionTokens, useKitReducedMotion } from '../settings/kit/motion';
import type { AiThemePromptSource } from './aiThemeTransfer';
import ThemeParkAiPanel from './ThemeParkAiPanel';
import ThemeParkColorPanel from './ThemeParkColorPanel';
import ThemeParkContentPanel from './ThemeParkContentPanel';
import ThemeParkDetailsPanel from './ThemeParkDetailsPanel';
import { isDualThemeNameValid, type ThemeParkTab } from './themeParkDraft';
import type { ThemeParkEditor } from './useThemeParkDraft';

// src/components/modal/theme-park/ThemeParkColumn.tsx
// The editing column of Theme Park: four tabs (colours, details, content, AI) and the pane of the
// chosen one, which scrolls inside the column. It fills the place it is put in and carries its own
// padding. It is a root of the settings kit (the kit's variables and the class st-window), so the
// kit's parts work in it and a layer one of them opens is drawn inside it. A missing theme name is
// pointed at by a dot on the details tab.

const TABS: Array<{ id: ThemeParkTab; labelKey: string; }> = [
    { id: 'colors', labelKey: 'theme.tabColors' },
    { id: 'details', labelKey: 'theme.tabDetails' },
    { id: 'content', labelKey: 'theme.tabContent' },
    { id: 'ai', labelKey: 'theme.tabAi' },
];

type ThemeParkColumnProps = {
    /** The editing session: the drafts and everything that writes to them. */
    editor: ThemeParkEditor;
    recommendedColors: ReadonlyArray<string>;
    promptSource: AiThemePromptSource;
};

const ThemeParkColumn: React.FC<ThemeParkColumnProps> = ({ editor, recommendedColors, promptSource }) => {
    const { t } = useTranslation();
    const { isDaylight, theme } = useSettingsKitTheme();
    const reduced = useKitReducedMotion();
    const [activeTab, setActiveTab] = useState<ThemeParkTab>('colors');
    // The first pane is there with the column; a pane chosen later comes in.
    const tabChangedRef = useRef(false);
    const { draft, safeDraft, mode, baseTheme, updateModeField, updateSharedField, replaceDraft, buildFinalTheme } = editor;

    return (
        <div
            className="st-window relative flex h-full min-h-0 flex-col text-[color:var(--st-t1)]"
            style={{ ...settingsTokens(isDaylight, theme), ...kitMotionTokens(reduced) }}
        >
            <Tabs
                label={t('theme.themePark')}
                tabs={TABS.map(({ id, labelKey }) => ({ id, label: t(labelKey), dot: id === 'details' && !isDualThemeNameValid(draft) }))}
                activeId={activeTab}
                onSelect={(id) => {
                    tabChangedRef.current = true;
                    setActiveTab(id as ThemeParkTab);
                }}
                className="px-6 pt-2"
            />

            {/* A new pane starts at its top: the key makes the scrolling view anew. */}
            <div
                key={activeTab}
                role="tabpanel"
                aria-label={t(TABS.find(tab => tab.id === activeTab)!.labelKey)}
                className={`st-scroll min-h-0 flex-1 overflow-y-scroll pb-10 pl-6 pr-3${tabChangedRef.current ? ' st-page-in' : ''}`}
            >
                {activeTab === 'colors' && (
                    <ThemeParkColorPanel editor={editor} recommendedColors={recommendedColors} />
                )}

                {activeTab === 'details' && (
                    <ThemeParkDetailsPanel
                        draft={draft}
                        onFieldChange={(fieldMode, patch) => updateModeField(patch, fieldMode)}
                    />
                )}

                {activeTab === 'content' && (
                    <ThemeParkContentPanel
                        wordColors={draft.dark.wordColors ?? []}
                        lyricsIcons={draft.dark.lyricsIcons ?? []}
                        accentColor={safeDraft[mode].accentColor}
                        recommendedColors={recommendedColors}
                        onWordColorsChange={(wordColors) => updateSharedField({ wordColors })}
                        onLyricsIconsChange={(lyricsIcons) => updateSharedField({ lyricsIcons })}
                    />
                )}

                {activeTab === 'ai' && (
                    <ThemeParkAiPanel
                        promptSource={promptSource}
                        buildFinalTheme={buildFinalTheme}
                        fallbackTheme={baseTheme}
                        onImportTheme={replaceDraft}
                    />
                )}
            </div>
        </div>
    );
};

export default ThemeParkColumn;
