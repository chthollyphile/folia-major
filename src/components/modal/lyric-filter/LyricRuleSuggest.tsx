import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LyricLineRuleDraft } from '../../../utils/lyrics/lyricLineRules';
import { Popover } from '../settings/kit';
import { SheetButton } from '../../shared/Sheet';
import { lyricRuleEffectText, lyricRuleLabel } from './LyricRuleList';
import type { LibraryRuleStats } from './useLyricLibraryScan';

// src/components/modal/lyric-filter/LyricRuleSuggest.tsx
// The panel a click on a lyric line opens: up to three rules built from that line, narrowest first
// and chosen, each with what it would remove in this song and in the songs heard. 添加规则 turns
// the chosen one into a card whose words stay editable.

export interface LyricRuleSuggestion {
    /** The id the library scan counts it under. */
    id: string;
    draft: LyricLineRuleDraft;
    /** Lines it removes in this song. */
    song: number;
}

interface LyricRuleSuggestProps {
    anchorRef: React.RefObject<HTMLElement | null>;
    open: boolean;
    suggestions: readonly LyricRuleSuggestion[];
    stats: (id: string) => LibraryRuleStats | undefined;
    hasLibrary: boolean;
    onAdd: (draft: LyricLineRuleDraft) => void;
    onClose: () => void;
}

const LyricRuleSuggest: React.FC<LyricRuleSuggestProps> = ({ anchorRef, open, suggestions, stats, hasLibrary, onAdd, onClose }) => {
    const { t } = useTranslation();
    const [chosen, setChosen] = useState(0);

    useEffect(() => {
        if (open) setChosen(0);
    }, [open, suggestions]);

    return (
        <Popover anchorRef={anchorRef} open={open} onClose={onClose} side="under" align="start" role="dialog" className="w-[400px] max-w-full p-2">
            <div className="flex items-baseline justify-between gap-3 px-2 pb-2 pt-1">
                <h4 className="text-[13px] font-semibold">{t('lyricFilter.suggestTitle')}</h4>
                <span className="text-xs text-[color:var(--st-t3)]">{t('lyricFilter.suggestNote')}</span>
            </div>
            <div role="radiogroup" className="space-y-0.5">
                {suggestions.map((suggestion, index) => {
                    const ruleStats = stats(suggestion.id);
                    const isChosen = index === chosen;
                    return (
                        <button
                            key={suggestion.id}
                            type="button"
                            role="radio"
                            aria-checked={isChosen}
                            onClick={() => setChosen(index)}
                            className={`st-t-fast grid w-full grid-cols-[18px_minmax(0,1fr)] gap-x-2.5 rounded-lg px-2 py-2 text-left transition-colors ${isChosen ? 'bg-[var(--st-fill)]' : 'hover:bg-[var(--st-fill)]'}`}
                        >
                            <span className={`mt-[3px] h-[14px] w-[14px] rounded-full ${isChosen ? 'border-4 border-[var(--st-accent)]' : 'border-[1.5px] border-[var(--st-t3)]'}`} />
                            <span className="text-[13px] leading-5 text-[color:var(--st-t1)]">
                                {suggestion.draft.shape === 'whole' ? t('lyricFilter.ruleSameLine') : lyricRuleLabel(t, suggestion.draft)}
                            </span>
                            <span className="col-start-2 text-xs leading-[18px] text-[color:var(--st-t2)]">
                                {lyricRuleEffectText(t, suggestion.song, ruleStats, hasLibrary)}
                                {ruleStats && ruleStats.midLines > 0 && (
                                    <span className="text-[color:var(--st-warn)]">{t('lyricFilter.effectMidSuffix', { count: ruleStats.midLines })}</span>
                                )}
                            </span>
                        </button>
                    );
                })}
            </div>
            <div className="flex justify-end gap-2 px-1 pb-1 pt-2">
                <SheetButton onClick={onClose}>{t('ui.cancel')}</SheetButton>
                <SheetButton
                    variant="primary"
                    disabled={!suggestions[chosen]}
                    onClick={() => {
                        const suggestion = suggestions[chosen];
                        if (suggestion) onAdd(suggestion.draft);
                    }}
                >
                    {t('lyricFilter.suggestAdd')}
                </SheetButton>
            </div>
        </Popover>
    );
};

export default LyricRuleSuggest;
