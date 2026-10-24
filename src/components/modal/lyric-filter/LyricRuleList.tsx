import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Plus, X } from 'lucide-react';
import { LYRIC_FILTER_REGEX_EXAMPLE } from '../../../utils/lyrics/filtering';
import {
    compileLyricLineRule,
    createLyricLineRuleId,
    getLyricLineRuleError,
    isLegacyExamplePattern,
    lyricLineAsRuleSees,
    lyricLineRuleHits,
    lyricLineRuleWords,
    withLyricLineRuleWord,
    LEGACY_LYRIC_RULE_ID,
    LYRIC_LINE_PRESETS,
    narrowerLyricLineRule,
    type LyricLineRule,
    type LyricLineRuleDraft,
    type LyricLineRuleShape,
} from '../../../utils/lyrics/lyricLineRules';
import { Button, Chips, Menu, Select, TextField, Toggle } from '../settings/kit';
import LyricFilterPatternField from './LyricFilterPatternField';
import type { LibraryRuleStats } from './useLyricLibraryScan';
import { NO_VERDICTS, writtenRuleState, type WrittenRuleVerdict } from './useWrittenRuleCheck';

// src/components/modal/lyric-filter/LyricRuleList.tsx
// The rules of the lyric filter window, one card each: a switch, what the rule holds, and what it
// removes in this song and in the songs heard. A rule that removes lines in the middle of songs, or
// more than half of a song, shows them in an amber box with one-click fixes; nothing here blocks
// saving. Also the add menu and the card shown while there is no rule.

/** The rules described in words; also the tags of the lines they remove. */
export const lyricRuleLabel = (t: TFunction, rule: LyricLineRuleDraft & { id?: string }): string => {
    const text = lyricLineRuleWords(rule.text).join(t('lyricFilter.wordsJoin'));
    switch (rule.shape) {
        case 'starts':
            return t(rule.colon ? 'lyricFilter.ruleStartsColon' : 'lyricFilter.ruleStarts', { text });
        case 'contains':
            return t('lyricFilter.ruleContains', { text });
        case 'whole':
            return t('lyricFilter.ruleWhole', { text });
        case 'ends':
            return t('lyricFilter.ruleEnds', { text });
        case 'preset':
            return t(`lyricFilter.preset.${rule.text}`);
        default:
            return t(rule.id === LEGACY_LYRIC_RULE_ID ? 'lyricFilter.legacyName' : 'lyricFilter.writtenName');
    }
};

/** What a rule removes, as one line: in this song, and in the songs heard once they are checked. */
export const lyricRuleEffectText = (
    t: TFunction,
    song: number,
    stats: LibraryRuleStats | undefined,
    hasLibrary: boolean,
): string => {
    if (!hasLibrary) return t('lyricFilter.effectSongOnly', { song });
    if (!stats) return t('lyricFilter.effectScanning', { song });
    const values = { song, songs: stats.songs, lines: stats.lines };
    const effect = t(stats.lines > 0 && stats.midLines === 0 ? 'lyricFilter.effectEdges' : 'lyricFilter.effect', values);
    return stats.unfinished ? `${effect}${t('lyricFilter.footerIncomplete')}` : effect;
};

const SIMPLE_SHAPES: readonly LyricLineRuleShape[] = ['starts', 'contains', 'whole', 'ends'];
const SHAPE_KEYS: Record<string, string> = {
    starts: 'lyricFilter.shapeStarts',
    contains: 'lyricFilter.shapeContains',
    whole: 'lyricFilter.shapeWhole',
    ends: 'lyricFilter.shapeEnds',
};
const CARD_CLASS = 'rounded-xl bg-[var(--st-card)] px-4 py-3.5 shadow-[0_0_0_1px_var(--st-line)]';
const WARN_TEXT = 'text-[color:var(--st-warn)]';

/** The text with the part the rule matched marked. */
const MarkedText: React.FC<{ text: string; rule: LyricLineRule; regex: RegExp | null }> = ({ text, rule, regex }) => {
    const match = regex?.exec(lyricLineAsRuleSees(rule, text));
    if (!match || !match[0] || match[0].length === text.length) return <>{text}</>;
    const end = match.index + match[0].length;
    return <>{text.slice(0, match.index)}<mark className="rounded-sm bg-[color-mix(in_srgb,var(--st-warn)_30%,transparent)] text-inherit">{match[0]}</mark>{text.slice(end)}</>;
};

interface RuleCardProps {
    rule: LyricLineRule;
    songLines: readonly string[];
    perRule: ReadonlyMap<string, LibraryRuleStats>;
    verdicts: ReadonlyMap<string, WrittenRuleVerdict>;
    hasLibrary: boolean;
    onChange: (rule: LyricLineRule) => void;
    onDelete: () => void;
}

const RuleCard: React.FC<RuleCardProps> = ({ rule, songLines, perRule, verdicts, hasLibrary, onChange, onDelete }) => {
    const { t } = useTranslation();
    const [sourceOpen, setSourceOpen] = useState(!rule.text);
    // Words being typed into a rule by words: counted in this song already, added on Enter or on leaving the field.
    const [typing, setTyping] = useState('');
    const words = lyricLineRuleWords(rule.text);
    const counted = typing.trim() ? { ...rule, text: withLyricLineRuleWord(rule.text, typing) } : rule;
    // A written rule is tested here only once it ran on this song's lines in time (useWrittenRuleCheck).
    const state = writtenRuleState(rule, verdicts);
    const regex = state === 'ok' ? compileLyricLineRule(counted) : null;
    const compiled = regex ? { rule: counted, regex } : null;
    const songHits = compiled ? songLines.filter((text, index) => lyricLineRuleHits(compiled, text, index, songLines.length)) : [];
    const songCount = songHits.length;
    const stats = perRule.get(rule.id);
    const error = getLyricLineRuleError(rule);
    const narrower = narrowerLyricLineRule(rule);
    const showMid = Boolean(stats && stats.midLines > 0 && !rule.edgesOnly);
    const shownMid = stats?.midExamples ?? [];
    const update = (fields: Partial<LyricLineRule>) => onChange({ ...rule, ...fields });
    const addTyped = () => {
        if (typing.trim()) update({ text: withLyricLineRuleWord(rule.text, typing) });
        setTyping('');
    };

    const head = rule.shape === 'written' || rule.shape === 'preset'
        ? (
            <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                <span className="truncate">{lyricRuleLabel(t, rule)}</span>
                <span className="shrink-0 rounded-[5px] bg-[var(--st-fill)] px-1.5 text-[11px] font-normal leading-5 text-[color:var(--st-t2)]">
                    {t(rule.shape === 'preset' ? 'lyricFilter.presetBadge' : rule.id === LEGACY_LYRIC_RULE_ID ? 'lyricFilter.legacyBadge' : 'lyricFilter.writtenBadge')}
                </span>
            </div>
        )
        : (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Select
                    value={rule.shape}
                    options={SIMPLE_SHAPES.map(shape => ({ value: shape, label: t(SHAPE_KEYS[shape]) }))}
                    onChange={shape => update({ shape })}
                />
                {words.map(word => (
                    <span key={word} className="inline-flex h-8 max-w-full items-center rounded-lg bg-[var(--st-fill)] pl-2.5 text-[13px] text-[color:var(--st-t1)]">
                        <span className="truncate">{word}</span>
                        <Button
                            variant="quiet"
                            icon={X}
                            tip={t('lyricFilter.removeWord')}
                            onClick={() => update({ text: words.filter(other => other !== word).join('\n') })}
                        />
                    </span>
                ))}
                {/* Escape adds the typed word, as leaving the field does: the window does not close without it. */}
                <span
                    className="contents"
                    onKeyDown={(event) => {
                        if (event.key === 'Escape' && !event.nativeEvent.isComposing && typing.trim()) {
                            event.preventDefault();
                            addTyped();
                        }
                    }}
                >
                    <TextField
                        value={typing}
                        onChange={setTyping}
                        onCommit={addTyped}
                        placeholder={t(words.length > 0 ? 'lyricFilter.wordsAddPlaceholder' : 'lyricFilter.wordsPlaceholder')}
                    />
                </span>
                {rule.shape === 'starts' && (
                    <Chips items={[{ id: `${rule.id}-colon`, label: t('lyricFilter.colonChip'), checked: Boolean(rule.colon), onChange: colon => update({ colon }) }]} />
                )}
            </div>
        );

    // A written rule is described by what it removes, never by its text, unless the listener asks.
    let description: React.ReactNode = null;
    if (rule.shape === 'preset') {
        description = t(`lyricFilter.presetDesc.${rule.text}`);
    } else if (rule.shape === 'written') {
        if (error) {
            description = <span className="text-[color:var(--st-err)]">{t('lyricFilter.writtenInvalid')}</span>;
        } else if (state === 'slow') {
            description = <span className="text-[color:var(--st-err)]">{t('lyricFilter.writtenSlow')}</span>;
        } else if (isLegacyExamplePattern(rule.text)) {
            description = t('lyricFilter.legacyExampleDesc');
        } else if (rule.text.trim()) {
            const examples = [...new Set([...songHits, ...(stats?.examples ?? []).map(hit => hit.text)])].slice(0, 4);
            description = (
                <>
                    {t('lyricFilter.legacyDesc')}
                    {examples.length > 0 && (
                        <span className="mt-1.5 flex flex-wrap gap-1.5">
                            {examples.map(text => (
                                <s key={text} className="rounded-[5px] bg-[var(--st-fill)] px-1.5 text-xs leading-5 text-[color:var(--st-t3)]">{text}</s>
                            ))}
                        </span>
                    )}
                </>
            );
        }
    }

    return (
        <div className={CARD_CLASS}>
            <div className="flex items-start justify-between gap-3">
                {head}
                <div className="flex shrink-0 items-center gap-1">
                    <Toggle checked={rule.on} onChange={on => update({ on })} />
                    <Button variant="quiet" icon={X} tip={t('lyricFilter.deleteRule')} onClick={onDelete} />
                </div>
            </div>
            {description && <div className="mt-1.5 text-xs leading-[18px] text-[color:var(--st-t2)]">{description}</div>}
            {rule.shape === 'written' && sourceOpen && (
                <div className="mt-2">
                    <LyricFilterPatternField
                        value={rule.text}
                        onChange={text => update({ text })}
                        placeholder={t('lyricFilter.inputPlaceholder')}
                        example={LYRIC_FILTER_REGEX_EXAMPLE}
                        error={error}
                        onClear={() => update({ text: '' })}
                    />
                </div>
            )}
            <div className="mt-1.5 flex items-center justify-between gap-2 text-xs leading-[18px] text-[color:var(--st-t2)]">
                <span className="min-w-0">
                    {state !== 'slow' && lyricRuleEffectText(t, songCount, stats, hasLibrary)}
                    {rule.edgesOnly && (
                        <button type="button" className="ml-2 rounded-[5px] bg-[var(--st-fill)] px-1.5 hover:bg-[var(--st-fill2)]" onClick={() => update({ edgesOnly: false })}>
                            {t('lyricFilter.edgesOnlyBadge')} ×
                        </button>
                    )}
                </span>
                {rule.shape === 'written' && rule.text && (
                    <Button variant="quiet" onClick={() => setSourceOpen(open => !open)}>
                        {t(sourceOpen ? 'lyricFilter.hideSource' : 'lyricFilter.showSource')}
                    </Button>
                )}
            </div>
            {stats && (showMid || stats.overHalfSongs > 0) && (
                <div className="mt-2.5 rounded-lg bg-[color-mix(in_srgb,var(--st-warn)_12%,transparent)] px-3 py-2.5 text-xs leading-[18px]">
                    {showMid && (
                        <>
                            <div className={WARN_TEXT}>{t('lyricFilter.warnMid', { count: stats.midLines })}</div>
                            <div className="mt-1.5 space-y-1">
                                {shownMid.map((hit, index) => (
                                    <div key={`${hit.text}-${index}`} className="flex justify-between gap-3 text-[color:var(--st-t1)]">
                                        <span className="min-w-0 truncate"><MarkedText text={hit.text} rule={rule} regex={regex} /></span>
                                        <span className="shrink-0 text-[color:var(--st-t3)]">
                                            {hit.title ?? t('lyricFilter.untitled')}
                                            {index === shownMid.length - 1 && stats.midLines > shownMid.length
                                                ? ` · ${t('lyricFilter.warnMore', { count: stats.midLines - shownMid.length })}`
                                                : ''}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                    {stats.overHalfSongs > 0 && (
                        <div className={`${showMid ? 'mt-1.5 ' : ''}${WARN_TEXT}`}>{t('lyricFilter.warnOverHalf', { count: stats.overHalfSongs })}</div>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {showMid && <Button onClick={() => update({ edgesOnly: true })}>{t('lyricFilter.fixEdgesOnly')}</Button>}
                        {narrower && (
                            <Button onClick={() => update({ shape: narrower.shape, text: narrower.text, colon: narrower.colon })}>
                                {t('lyricFilter.fixNarrower', { rule: lyricRuleLabel(t, narrower) })}
                            </Button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

interface LyricRuleListProps {
    rules: LyricLineRule[];
    /** The current song's lines without interludes. */
    songLines: readonly string[];
    /** What each rule removes in the songs heard, once checked for it as it is now. */
    perRule: ReadonlyMap<string, LibraryRuleStats>;
    /** How the written rules' checks on the current song came out; without them a written rule is not tested. */
    verdicts?: ReadonlyMap<string, WrittenRuleVerdict>;
    /** Songs heard are known and there is at least one. */
    hasLibrary: boolean;
    onChange: (rules: LyricLineRule[]) => void;
}

const LyricRuleList: React.FC<LyricRuleListProps> = ({ rules, songLines, perRule, verdicts = NO_VERDICTS, hasLibrary, onChange }) => {
    const { t } = useTranslation();
    const addRef = useRef<HTMLSpanElement>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const add = (draft: LyricLineRuleDraft) => onChange([...rules, { id: createLyricLineRuleId(), on: true, ...draft }]);
    const hasPreset = (id: string) => rules.some(rule => rule.shape === 'preset' && rule.text === id);
    const addWords = () => add({ shape: 'contains', text: '' });

    return (
        <div className="mt-5">
            <div className="mb-2 flex min-h-6 items-center justify-between gap-3 px-1">
                <h3 className="text-[13px] font-semibold leading-5 text-[color:var(--st-t2)]">{t('lyricFilter.rulesTitle')}</h3>
                <span ref={addRef} aria-haspopup="menu" aria-expanded={menuOpen}>
                    <Button variant="quiet" icon={Plus} onClick={() => setMenuOpen(open => !open)}>{t('lyricFilter.addRule')}</Button>
                </span>
                <Menu
                    anchorRef={addRef}
                    open={menuOpen}
                    onClose={() => setMenuOpen(false)}
                    label={t('lyricFilter.addRule')}
                    align="end"
                    items={[
                        { id: 'words', label: t('lyricFilter.addByWords'), onSelect: addWords },
                        ...LYRIC_LINE_PRESETS.map(preset => ({
                            id: preset.id,
                            label: t(`lyricFilter.preset.${preset.id}`),
                            disabled: hasPreset(preset.id),
                            onSelect: () => add({ shape: 'preset', text: preset.id }),
                        })),
                        { id: 'written', label: t('lyricFilter.addWritten'), onSelect: () => add({ shape: 'written', text: '' }) },
                    ]}
                />
            </div>
            {rules.length === 0 ? (
                <div className={CARD_CLASS}>
                    <div className="text-[13px] leading-5 text-[color:var(--st-t2)]">{t('lyricFilter.emptyTitle')}</div>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {LYRIC_LINE_PRESETS.map(preset => (
                            <Button key={preset.id} onClick={() => add({ shape: 'preset', text: preset.id })}>{t(`lyricFilter.preset.${preset.id}`)}</Button>
                        ))}
                        <Button icon={Plus} onClick={addWords}>{t('lyricFilter.emptyAddWords')}</Button>
                    </div>
                </div>
            ) : (
                <div className="space-y-2">
                    {rules.map(rule => (
                        <RuleCard
                            key={rule.id}
                            rule={rule}
                            songLines={songLines}
                            perRule={perRule}
                            verdicts={verdicts}
                            hasLibrary={hasLibrary}
                            onChange={next => onChange(rules.map(item => (item.id === rule.id ? next : item)))}
                            onDelete={() => onChange(rules.filter(item => item.id !== rule.id))}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export default LyricRuleList;
