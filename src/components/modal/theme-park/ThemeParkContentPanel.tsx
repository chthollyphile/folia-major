import React, { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLucideIcons } from '../../../hooks/useLucideIcons';
import { hasLucideIcon, resolveLucideIcon } from '../../../services/lucideIconResolver';
import { Button, ColorField, FIELD_CLASS, Group, Row, type SettingsGroupDef } from '../settings/kit';
import { LYRICS_ICON_LIMIT, WORD_COLOR_LIMIT, type WordColorEntry } from './themeParkDraft';

// src/components/modal/theme-park/ThemeParkContentPanel.tsx
// Content tab: the emotion word colors and the lucide lyric icons an AI theme carries. Both
// describe the song rather than the light/dark surface, so edits here apply to both sides.
// A word's colour opens the app's colour picker beside its swatch.

type ThemeParkContentPanelProps = {
    wordColors: WordColorEntry[];
    lyricsIcons: string[];
    accentColor: string;
    recommendedColors: ReadonlyArray<string>;
    onWordColorsChange: (next: WordColorEntry[]) => void;
    onLyricsIconsChange: (next: string[]) => void;
};

const WORDS_GROUP: SettingsGroupDef = { id: 'theme-park-word-colors', titleKey: 'theme.wordColors' };
const ICONS_GROUP: SettingsGroupDef = { id: 'theme-park-lyrics-icons', titleKey: 'theme.lyricsIcons' };

const ThemeParkContentPanel: React.FC<ThemeParkContentPanelProps> = ({
    wordColors,
    lyricsIcons,
    accentColor,
    recommendedColors,
    onWordColorsChange,
    onLyricsIconsChange,
}) => {
    const { t } = useTranslation();
    const [iconDraft, setIconDraft] = useState('');
    const [iconError, setIconError] = useState<string | null>(null);
    // The icon chips read loaded icons; this re-renders them as their chunks arrive.
    useLucideIcons(lyricsIcons);
    // The row that was just added: it comes in, and its word field takes the keyboard.
    const [addedIndex, setAddedIndex] = useState<number | null>(null);

    const updateWordColor = (index: number, patch: Partial<WordColorEntry>) => {
        onWordColorsChange(wordColors.map((entry, entryIndex) => (
            entryIndex === index ? { ...entry, ...patch } : entry
        )));
    };

    const handleAddIcon = async () => {
        const name = iconDraft.trim();
        if (!name) {
            return;
        }
        if (!(await hasLucideIcon(name))) {
            setIconError(t('theme.lyricsIconUnknown'));
            return;
        }
        if (lyricsIcons.includes(name)) {
            setIconDraft('');
            return;
        }

        onLyricsIconsChange([...lyricsIcons, name]);
        setIconDraft('');
        setIconError(null);
    };

    const iconsFull = lyricsIcons.length >= LYRICS_ICON_LIMIT;

    return (
        <>
            <Group
                def={WORDS_GROUP}
                action={(
                    <Button
                        variant="quiet"
                        onClick={() => {
                            setAddedIndex(wordColors.length);
                            onWordColorsChange([...wordColors, { word: '', color: accentColor }]);
                        }}
                        disabled={wordColors.length >= WORD_COLOR_LIMIT}
                    >
                        {t('theme.addWordColor')}
                    </Button>
                )}
                foot={t('theme.wordColorsDesc')}
            >
                {wordColors.length === 0 ? (
                    <Row label={<span className="text-[color:var(--st-t2)]">{t('theme.wordColorsEmpty')}</span>} />
                ) : wordColors.map((entry, index) => (
                    // st-row: the kit's hairline between the rows of a card.
                    <div
                        key={`word-color-${index}`}
                        className={`st-row relative flex min-h-14 items-center gap-2.5 py-2.5 pl-4 pr-2${index === addedIndex ? ' st-page-in' : ''}`}
                    >
                        <ColorField
                            value={entry.color}
                            onChange={color => updateWordColor(index, { color })}
                            label={t('theme.wordColorSwatch')}
                            swatches={recommendedColors}
                            swatchesLabel={t('options.aiThemeQuickEditRecommendedColors')}
                        />
                        <input
                            type="text"
                            value={entry.word}
                            onChange={(event) => updateWordColor(index, { word: event.target.value })}
                            placeholder={t('theme.wordColorWordPlaceholder')}
                            aria-label={t('theme.wordColorWordPlaceholder')}
                            autoFocus={index === addedIndex}
                            className="st-t-fast h-8 min-w-0 flex-1 rounded-lg bg-transparent px-1.5 text-[13px] text-[color:var(--st-t1)] outline-none transition-colors placeholder:text-[color:var(--st-t3)] focus:bg-[var(--st-fill)]"
                            spellCheck={false}
                        />
                        <span className="shrink-0 font-mono text-xs text-[color:var(--st-t2)]">
                            {entry.color.toUpperCase()}
                        </span>
                        <Button
                            icon={Trash2}
                            tip={t('theme.removeEntry')}
                            onClick={() => {
                                setAddedIndex(null);
                                onWordColorsChange(wordColors.filter((_, entryIndex) => entryIndex !== index));
                            }}
                        />
                    </div>
                ))}
            </Group>

            <Group
                def={ICONS_GROUP}
                foot={(
                    <>
                        {iconError && <span role="alert" className="mb-1 block text-[color:var(--st-err)]">{iconError}</span>}
                        {t('theme.lyricsIconsDesc')}
                    </>
                )}
            >
                {lyricsIcons.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 px-4 pt-3">
                        {lyricsIcons.map(iconName => {
                            const Icon = resolveLucideIcon(iconName);

                            return (
                                <span
                                    key={iconName}
                                    className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-[var(--st-fill)] pl-2.5 pr-1 font-mono text-xs text-[color:var(--st-t1)]"
                                >
                                    {Icon ? <Icon size={13} /> : null}
                                    <span>{iconName}</span>
                                    <button
                                        type="button"
                                        onClick={() => onLyricsIconsChange(lyricsIcons.filter(name => name !== iconName))}
                                        className="st-t-fast grid h-5 w-5 place-items-center rounded-md text-[color:var(--st-t3)] transition-colors hover:bg-[var(--st-fill2)] hover:text-[color:var(--st-t1)]"
                                        aria-label={`${t('theme.removeEntry')} ${iconName}`}
                                    >
                                        <X size={11} />
                                    </button>
                                </span>
                            );
                        })}
                    </div>
                )}

                <div className="flex min-h-14 items-center gap-2 px-4 py-2.5">
                    <input
                        type="text"
                        value={iconDraft}
                        onChange={(event) => {
                            setIconDraft(event.target.value);
                            setIconError(null);
                        }}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                void handleAddIcon();
                            }
                        }}
                        placeholder={t('theme.lyricsIconPlaceholder')}
                        aria-label={t('theme.lyricsIcons')}
                        disabled={iconsFull}
                        className={`${FIELD_CLASS} min-w-0 flex-1 px-2.5 disabled:cursor-not-allowed disabled:opacity-40`}
                        spellCheck={false}
                    />
                    <Button onClick={() => void handleAddIcon()} disabled={iconsFull}>{t('theme.addLyricsIcon')}</Button>
                </div>
            </Group>
        </>
    );
};

export default ThemeParkContentPanel;
