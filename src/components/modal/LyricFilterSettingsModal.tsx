import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LyricData } from '../../types';
import {
    compileLyricLineRule,
    compileLyricLineRules,
    createLyricLineRuleId,
    lyricLineRulesKey,
    withLyricLineRuleWord,
    suggestLyricLineRules,
    type CompiledLyricLineRule,
    type LyricLineRule,
    type LyricLineRuleDraft,
} from '../../utils/lyrics/lyricLineRules';
import { isInterludeLine } from '../../utils/lyrics/parserCore';
import { getLyricStaffPatternError } from '../../utils/lyrics/staffCredits';
import type { LyricStaffAbsorbMode, LyricStaffPolicy } from '../../utils/lyrics/staffCreditsPolicy';
import Sheet, { SheetButton } from '../shared/Sheet';
import ThemedDialog from '../shared/ThemedDialog';
import { Segmented } from './settings/kit';
import { buildLyricFilterPreviewModel, type LyricFilterPreviewRow } from './lyric-filter/buildLyricFilterPreviewModel';
import LyricFilterPreviewList, { LibraryHitList } from './lyric-filter/LyricFilterPreviewList';
import LyricRuleList, { lyricRuleLabel } from './lyric-filter/LyricRuleList';
import LyricRuleSuggest, { type LyricRuleSuggestion } from './lyric-filter/LyricRuleSuggest';
import LyricStaffSection from './lyric-filter/LyricStaffSection';
import { countSongHits, useLibrarySongs, useLyricLibraryScan } from './lyric-filter/useLyricLibraryScan';
import { useWrittenRuleCheck, writtenRuleState } from './lyric-filter/useWrittenRuleCheck';

// src/components/modal/LyricFilterSettingsModal.tsx
// The lyric filter window: the current song's lyrics (or the lines removed in the songs heard) at
// the left, the rules at the right. A click on a line suggests rules built from it; every change
// shows at once, here and in the songs heard; nothing is stored until Save.

export interface LyricFilterDraft {
    rules: LyricLineRule[];
    staffPolicy: LyricStaffPolicy;
    staffMinDwellSeconds: number;
    staffAbsorbMode: LyricStaffAbsorbMode;
    staffPattern: string;
}

interface LyricFilterSettingsModalProps {
    isOpen: boolean;
    isDaylight: boolean;
    currentSongTitle?: string | null;
    initialRules: LyricLineRule[];
    initialStaffPolicy: LyricStaffPolicy;
    initialStaffMinDwellSeconds: number;
    initialStaffAbsorbMode: LyricStaffAbsorbMode;
    initialStaffPattern: string;
    loadPreviewLyrics: () => Promise<LyricData | null>;
    onClose: () => void;
    onSave: (draft: LyricFilterDraft) => Promise<void> | void;
}

type PaneTab = 'song' | 'library';

/** Each rule that removes something, judged on its own whether it is on or not: what the cards count. */
const compileEach = (rules: readonly LyricLineRule[]): CompiledLyricLineRule[] => rules.flatMap((rule) => {
    const regex = compileLyricLineRule(rule);
    return regex ? [{ rule, regex }] : [];
});

/** What Save stores: a card left without words removes nothing, so it is not kept. */
const asSaved = (draft: LyricFilterDraft): LyricFilterDraft => ({
    ...draft,
    rules: draft.rules.filter(rule => rule.text.trim()),
    staffPattern: draft.staffPattern.trim(),
});

/** Equal for two settings that filter alike: the rules' ids and order, and the order of their words, do not count. */
const savedKey = (draft: LyricFilterDraft): string => {
    const saved = asSaved(draft);
    return JSON.stringify({ ...saved, rules: lyricLineRulesKey(saved.rules) });
};

const LyricFilterSettingsModal: React.FC<LyricFilterSettingsModalProps> = ({
    isOpen,
    isDaylight,
    currentSongTitle,
    initialRules,
    initialStaffPolicy,
    initialStaffMinDwellSeconds,
    initialStaffAbsorbMode,
    initialStaffPattern,
    loadPreviewLyrics,
    onClose,
    onSave,
}) => {
    const { t } = useTranslation();
    const [draftRules, setDraftRules] = useState<LyricLineRule[]>(initialRules);
    const [draftStaffPolicy, setDraftStaffPolicy] = useState<LyricStaffPolicy>(initialStaffPolicy);
    const [draftStaffMinDwell, setDraftStaffMinDwell] = useState(initialStaffMinDwellSeconds);
    const [draftStaffAbsorbMode, setDraftStaffAbsorbMode] = useState<LyricStaffAbsorbMode>(initialStaffAbsorbMode);
    const [draftStaffPattern, setDraftStaffPattern] = useState(initialStaffPattern);
    const [previewLyrics, setPreviewLyrics] = useState<LyricData | null>(null);
    const [isLoadingPreview, setIsLoadingPreview] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [tab, setTab] = useState<PaneTab>('song');
    const [picked, setPicked] = useState<{ index: number; text: string } | null>(null);
    // A close with changes not saved asks first whether to save them.
    const [isAskingToSave, setIsAskingToSave] = useState(false);
    const pickedRef = useRef<HTMLButtonElement | null>(null);

    // The drafts start from what is saved when the window opens, and only then: a save changes what
    // is saved while the window is still open, and the shown lyrics change under it.
    useEffect(() => {
        if (!isOpen) {
            return;
        }

        setDraftRules(initialRules);
        setDraftStaffPolicy(initialStaffPolicy);
        setDraftStaffMinDwell(initialStaffMinDwellSeconds);
        setDraftStaffAbsorbMode(initialStaffAbsorbMode);
        setDraftStaffPattern(initialStaffPattern);
        setTab('song');
        setPicked(null);
        setIsLoadingPreview(true);
    }, [isOpen]);

    // The current song's lyrics; loaded again, without the spinner, when the shown lyrics change.
    useEffect(() => {
        if (!isOpen) {
            return undefined;
        }

        let active = true;

        loadPreviewLyrics()
            .then((lyrics) => {
                if (active) {
                    setPreviewLyrics(lyrics);
                }
            })
            .finally(() => {
                if (active) {
                    setIsLoadingPreview(false);
                }
            });

        return () => {
            active = false;
        };
    }, [isOpen, loadPreviewLyrics]);

    const songLines = useMemo(
        () => (previewLyrics ? previewLyrics.lines.filter(line => !isInterludeLine(line)).map(line => line.fullText) : []),
        [previewLyrics],
    );
    const verdicts = useWrittenRuleCheck(isOpen, songLines, draftRules);
    // What the window tests on its own thread: every rule but a written one not checked yet or too slow.
    const runnable = useMemo(() => draftRules.filter(rule => writtenRuleState(rule, verdicts) === 'ok'), [draftRules, verdicts]);
    // A written rule that is on is saved only once it ran in time here: a slow one would hold playback.
    const hasUncheckedRule = draftRules.some(rule => rule.on && writtenRuleState(rule, verdicts) !== 'ok');
    const onRules = useMemo(() => compileLyricLineRules(runnable), [runnable]);
    const suggestionItems = useMemo(() => (picked ? suggestLyricLineRules(picked.text) : []).flatMap((draft, index) => {
        // Keyed by the line too: another line's suggestions are other rules, counted afresh.
        const id = `suggest-${picked!.index}-${index}`;
        const regex = compileLyricLineRule(draft);
        return regex ? [{ rule: { ...draft, id, on: true }, regex }] : [];
    }), [picked]);
    const suggestions = useMemo<LyricRuleSuggestion[]>(() => suggestionItems.map(item => ({
        id: item.rule.id,
        draft: item.rule,
        song: countSongHits(songLines, item),
    })), [songLines, suggestionItems]);
    const scanItems = useMemo(() => [...compileEach(runnable), ...suggestionItems], [runnable, suggestionItems]);
    const librarySongs = useLibrarySongs(isOpen);
    const { scan, perRule } = useLyricLibraryScan(librarySongs, scanItems, onRules);
    const hasLibrary = librarySongs === null || librarySongs.length > 0;

    // 只在自定义规则输入框可见时校验：切到「始终显示」后输入框和报错都会收起来，
    // 再拿它禁用保存按钮，用户就只剩「切回去清空」这一条路。
    const staffPatternError = draftStaffPolicy === 'keep' ? null : getLyricStaffPatternError(draftStaffPattern);
    const preview = useMemo(
        () => buildLyricFilterPreviewModel(previewLyrics, onRules, {
            policy: draftStaffPolicy,
            minDwellSeconds: draftStaffMinDwell,
            absorbMode: draftStaffAbsorbMode,
            pattern: draftStaffPattern,
        }),
        [draftStaffAbsorbMode, draftStaffMinDwell, draftStaffPattern, draftStaffPolicy, onRules, previewLyrics]
    );
    const ruleLabel = (rule: LyricLineRule) => lyricRuleLabel(t, rule);
    const ruleName = (id: string) => {
        const rule = draftRules.find(item => item.id === id);
        return rule ? ruleLabel(rule) : '';
    };

    const handlePickLine = (row: LyricFilterPreviewRow, element: HTMLButtonElement) => {
        pickedRef.current = element;
        setPicked(previous => (previous?.index === row.index ? null : { index: row.index, text: row.line.fullText }));
    };

    const handleAddSuggestion = (draft: LyricLineRuleDraft) => {
        const { shape, text, colon } = draft;
        setDraftRules((previous) => {
            // Words held the same way go into the rule that holds such words already: one card for them.
            const same = previous.find(rule => rule.on && !rule.edgesOnly && rule.shape === shape && Boolean(rule.colon) === Boolean(colon));
            return same
                ? previous.map(rule => (rule === same ? { ...rule, text: withLyricLineRuleWord(rule.text, text) } : rule))
                : [...previous, { id: createLyricLineRuleId(), on: true, shape, text, ...(colon ? { colon } : {}) }];
        });
        setPicked(null);
    };

    const draft: LyricFilterDraft = {
        rules: draftRules,
        staffPolicy: draftStaffPolicy,
        staffMinDwellSeconds: draftStaffMinDwell,
        staffAbsorbMode: draftStaffAbsorbMode,
        staffPattern: draftStaffPattern,
    };
    const isChanged = savedKey(draft) !== savedKey({
        rules: initialRules,
        staffPolicy: initialStaffPolicy,
        staffMinDwellSeconds: initialStaffMinDwellSeconds,
        staffAbsorbMode: initialStaffAbsorbMode,
        staffPattern: initialStaffPattern,
    });
    const requestClose = () => (isChanged ? setIsAskingToSave(true) : onClose());
    // The question goes with the window, so that it is not up again when the window opens next.
    const close = () => {
        setIsAskingToSave(false);
        onClose();
    };

    const handleSave = async () => {
        if (staffPatternError || hasUncheckedRule) {
            return;
        }

        setIsSaving(true);
        try {
            await onSave(asSaved(draft));
            close();
        } finally {
            setIsSaving(false);
        }
    };

    const footerNote = (() => {
        const song = preview.removedCount;
        if (librarySongs !== null && librarySongs.length === 0) return t('lyricFilter.footerSongOnly', { song });
        if (!scan) return t('lyricFilter.footerScanning', { song });
        return (
            <>
                {t('lyricFilter.footer', { song, songs: scan.checked, lines: scan.removedLines })}
                {scan.midLines > 0 && <span className="text-[color:var(--st-warn)]">{t('lyricFilter.footerMid', { count: scan.midLines })}</span>}
                {!scan.complete && t('lyricFilter.footerIncomplete')}
            </>
        );
    })();

    const saveDisabled = Boolean(staffPatternError) || hasUncheckedRule || isSaving;

    return (
        <Sheet
            isOpen={isOpen}
            onClose={requestClose}
            isDaylight={isDaylight}
            closeDisabled={isSaving}
            size="xl"
            body="panes"
            title={t('lyricFilter.title')}
            footerNote={footerNote}
            footer={(
                <>
                    <SheetButton disabled={isSaving} onClick={requestClose}>{t('ui.cancel')}</SheetButton>
                    <SheetButton
                        variant="primary"
                        disabled={saveDisabled}
                        onClick={handleSave}
                    >
                        {isSaving ? t('lyricFilter.saving') : t('lyricFilter.save')}
                    </SheetButton>
                </>
            )}
        >
            {/* Side by side; one above the other in a window too narrow for both. */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col border-b border-[var(--st-line)] bg-[var(--st-pv)] md:border-b-0 md:border-r">
                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 pt-4 text-[13px]">
                        <Segmented
                            value={tab}
                            onChange={setTab}
                            options={[
                                { value: 'song', label: t('lyricFilter.tabSong') },
                                {
                                    value: 'library',
                                    label: librarySongs ? t('lyricFilter.tabLibraryCount', { count: librarySongs.length }) : t('lyricFilter.tabLibrary'),
                                },
                            ]}
                        />
                        <span className="shrink-0 tabular-nums text-[color:var(--st-t1)]">
                            {tab === 'song'
                                ? preview.totalCount > 0 && t('lyricFilter.filteredCount', { removed: preview.removedCount, total: preview.totalCount })
                                : scan && `${t('lyricFilter.libraryChecked', { checked: scan.checked, total: scan.total })}${scan.complete ? '' : t('lyricFilter.footerIncomplete')}`}
                        </span>
                    </div>
                    {tab === 'song' && (
                        <div className="flex shrink-0 items-baseline justify-between gap-4 px-6 pb-1.5 pt-2.5 text-[13px] text-[color:var(--st-t2)]">
                            <span className="min-w-0 truncate">{currentSongTitle || t('lyricFilter.previewFallback')}</span>
                            <span className="shrink-0 text-xs text-[color:var(--st-t3)]">{t('lyricFilter.pickHint')}</span>
                        </div>
                    )}
                    <div className="st-scroll min-h-0 flex-1 overflow-y-auto px-3">
                        {tab === 'song' ? (
                            <LyricFilterPreviewList
                                isLoading={isLoadingPreview}
                                rows={preview.rows}
                                staff={preview.staff}
                                staffPolicy={draftStaffPolicy}
                                ruleLabel={ruleLabel}
                                pickedIndex={picked?.index ?? null}
                                onPickLine={handlePickLine}
                            />
                        ) : (
                            <LibraryHitList scan={scan} songCount={librarySongs ? librarySongs.length : null} ruleName={ruleName} />
                        )}
                    </div>
                    <LyricRuleSuggest
                        anchorRef={pickedRef}
                        open={picked !== null}
                        suggestions={suggestions}
                        stats={id => perRule.get(id)}
                        hasLibrary={hasLibrary}
                        onAdd={handleAddSuggestion}
                        onClose={() => setPicked(null)}
                    />
                </div>

                <div className="st-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 md:w-[500px] md:flex-none">
                    <LyricRuleList
                        rules={draftRules}
                        songLines={songLines}
                        perRule={perRule}
                        verdicts={verdicts}
                        hasLibrary={hasLibrary}
                        onChange={setDraftRules}
                    />
                    <LyricStaffSection
                        policy={draftStaffPolicy}
                        minDwellSeconds={draftStaffMinDwell}
                        absorbMode={draftStaffAbsorbMode}
                        pattern={draftStaffPattern}
                        onPolicyChange={setDraftStaffPolicy}
                        onMinDwellChange={setDraftStaffMinDwell}
                        onAbsorbModeChange={setDraftStaffAbsorbMode}
                        onPatternChange={setDraftStaffPattern}
                    />
                </div>
            </div>

            {/* Drawn over the window. Closing this question goes back to it; only 不保存 drops the changes. */}
            <ThemedDialog
                isOpen={isAskingToSave}
                onClose={() => setIsAskingToSave(false)}
                isDaylight={isDaylight}
                closeDisabled={isSaving}
                title={t('lyricFilter.unsavedTitle')}
                footerNote={<SheetButton disabled={isSaving} onClick={close}>{t('lyricFilter.discard')}</SheetButton>}
                footer={(
                    <>
                        <SheetButton disabled={isSaving} onClick={() => setIsAskingToSave(false)}>{t('ui.cancel')}</SheetButton>
                        <SheetButton data-autofocus variant="primary" disabled={saveDisabled} onClick={handleSave}>
                            {isSaving ? t('lyricFilter.saving') : t('lyricFilter.save')}
                        </SheetButton>
                    </>
                )}
            />
        </Sheet>
    );
};

export default LyricFilterSettingsModal;
