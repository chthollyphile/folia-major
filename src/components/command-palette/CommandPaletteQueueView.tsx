import React from 'react';
import { AtSign, CornerDownLeft, ListEnd, ListPlus, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import CommandPaletteQueueList, { type CommandPaletteQueueListProps } from './CommandPaletteQueueList';
import type { QueueSearchEvaluation, QueueSearchSuggestion } from './queueSearch';
import type { QueueBatchAction, QueueFacetKind } from './queueQuery';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { useQueueUi } from '../../hooks/useQueueUi';
import { QueueUiComponents } from '../shared/QueueUiAdditions';

// src/components/command-palette/CommandPaletteQueueView.tsx
// Adds queue syntax suggestions and an explicit batch-action preview above the virtualized results.

type CommandPaletteQueueViewProps = CommandPaletteQueueListProps & {
    evaluation: QueueSearchEvaluation;
    accentColor: string;
    keepOpenOnSongChange: boolean;
    onKeepOpenOnSongChange: (enable: boolean) => void;
    onAcceptSuggestion: (suggestion: QueueSearchSuggestion) => void;
    onClearAction: () => void;
    onClearFacet: () => void;
    onExecuteBatch: () => Promise<boolean>;
};

const actionIcon: Record<QueueBatchAction, typeof Trash2> = {
    remove: Trash2,
    next: ListPlus,
    end: ListEnd,
};

const actionLabelKey: Record<QueueBatchAction, string> = {
    remove: 'commandPalette.queueActionRemove',
    next: 'commandPalette.queueActionNext',
    end: 'commandPalette.queueActionEnd',
};

const facetLabelKey: Record<QueueFacetKind, string> = {
    artist: 'commandPalette.queueFacetArtist',
    album: 'commandPalette.queueFacetAlbum',
};

const CommandPaletteQueueView: React.FC<CommandPaletteQueueViewProps> = ({
    evaluation,
    accentColor,
    keepOpenOnSongChange,
    onKeepOpenOnSongChange,
    isDaylight,
    isExecuting,
    onAcceptSuggestion,
    onClearAction,
    onClearFacet,
    onExecuteBatch,
    ...listProps
}) => {
    const { t } = useTranslation();
    const playQueue = usePlaybackStore(state => state.playQueue);
    const { headerContent } = useQueueUi(playQueue, 'command');
    const { parsed, suggestions } = evaluation;
    const ActionIcon = parsed.action ? actionIcon[parsed.action] : null;
    const canExecuteBatch = Boolean(
        parsed.action
        && evaluation.hasMeaningfulFilter
        && evaluation.eligibleTargetIndices.length > 0
        && !isExecuting
    );
    const chipClass = isDaylight
        ? 'border-black/10 bg-black/[0.04] text-zinc-800'
        : 'border-white/10 bg-white/[0.06] text-zinc-100';

    return (
        <div className="flex h-full min-h-0 flex-col gap-2" data-testid="command-palette-queue-view">
            <div className={`flex shrink-0 ${headerContent.length ? 'items-center' : 'items-start'} justify-between gap-3 px-3 py-1 text-[11px]`}>
                <div className="min-w-0 flex-1 opacity-40" data-testid="command-palette-queue-syntax-hint">
                    {!parsed.action && parsed.actionDraft === null && parsed.facetDraft === null && !parsed.text
                        ? t('commandPalette.queueSyntaxHint')
                        : null}
                </div>
                <label
                    className="flex shrink-0 cursor-pointer items-center gap-1.5 opacity-65 hover:opacity-100"
                    title={t('commandPalette.queueKeepOpenHint')}
                >
                    <span>{t('commandPalette.queueKeepOpen')}</span>
                    <input
                        type="checkbox"
                        checked={keepOpenOnSongChange}
                        disabled={isExecuting}
                        onChange={event => onKeepOpenOnSongChange(event.target.checked)}
                        className="h-3.5 w-3.5 cursor-pointer disabled:cursor-wait"
                        style={{ accentColor }}
                    />
                </label>
                <QueueUiComponents components={headerContent} isDaylight={isDaylight} />
            </div>
            {(parsed.action || parsed.actionDraft !== null || parsed.facetDraft !== null) && (
                <div className="flex flex-wrap items-center gap-1.5 px-1">
                    {parsed.action && ActionIcon && (
                        <button
                            type="button"
                            onClick={onClearAction}
                            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${chipClass}`}
                            aria-label={t('commandPalette.queueClearAction')}
                        >
                            <ActionIcon size={12} />
                            {t(actionLabelKey[parsed.action])}
                            <X size={11} className="opacity-50" />
                        </button>
                    )}
                    {parsed.facetDraft !== null && (
                        <button
                            type="button"
                            onClick={onClearFacet}
                            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${chipClass}`}
                            aria-label={t('commandPalette.queueClearFacet')}
                        >
                            <AtSign size={12} />
                            {parsed.isBareFacet
                                ? t('commandPalette.queueCurrentFacets')
                                : `${parsed.facetKind ? t(facetLabelKey[parsed.facetKind]) : t('commandPalette.queueFacet')}: ${parsed.facetValue || parsed.facetDraft}`}
                            <X size={11} className="opacity-50" />
                        </button>
                    )}
                </div>
            )}

            {suggestions.length > 0 && (
                <div className="grid shrink-0 gap-1 px-1" data-testid="command-palette-queue-suggestions">
                    {suggestions.map(suggestion => {
                        const Icon = suggestion.type === 'action' && suggestion.action
                            ? actionIcon[suggestion.action]
                            : AtSign;
                        const title = suggestion.type === 'action' && suggestion.action
                            ? t(actionLabelKey[suggestion.action])
                            : `${suggestion.facetKind ? t(facetLabelKey[suggestion.facetKind]) : t('commandPalette.queueFacet')}: ${suggestion.label}`;
                        return (
                            <button
                                key={suggestion.id}
                                type="button"
                                onClick={() => onAcceptSuggestion(suggestion)}
                                className={`flex items-center gap-2 rounded-xl px-3 py-2 text-left text-xs transition-colors ${
                                    isDaylight ? 'hover:bg-black/[0.06]' : 'hover:bg-white/[0.08]'
                                }`}
                            >
                                <Icon size={14} className="shrink-0 opacity-55" />
                                <span className="min-w-0 flex-1 truncate">{title}</span>
                                {suggestion.count !== undefined && (
                                    <span className="shrink-0 tabular-nums opacity-45">{suggestion.count}</span>
                                )}
                                {suggestion.isCurrent && (
                                    <span className="shrink-0 rounded-full border border-current/10 px-1.5 py-0.5 text-[9px] opacity-55">
                                        {t('commandPalette.queueCurrent')}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}

            {parsed.action && (
                <div
                    className={`flex shrink-0 items-center gap-3 rounded-2xl border px-3 py-2.5 ${chipClass}`}
                    data-testid="command-palette-queue-batch-preview"
                >
                    {ActionIcon && <ActionIcon size={16} className="shrink-0 opacity-65" />}
                    <div className="min-w-0 flex-1 text-xs">
                        <div className="font-medium">
                            {evaluation.hasMeaningfulFilter
                                ? t('commandPalette.queueBatchPreview').replace('{{count}}', String(evaluation.eligibleTargetIndices.length))
                                : t('commandPalette.queueBatchNeedsFilter')}
                        </div>
                        {evaluation.skippedCurrentCount > 0 && (
                            <div className="mt-0.5 opacity-50">{t('commandPalette.queueBatchSkippedCurrent')}</div>
                        )}
                    </div>
                    <button
                        type="button"
                        disabled={!canExecuteBatch}
                        onClick={() => void onExecuteBatch()}
                        className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                            isDaylight ? 'bg-black/10 hover:bg-black/15' : 'bg-white/10 hover:bg-white/15'
                        }`}
                    >
                        <CornerDownLeft size={13} />
                        {t('commandPalette.queueBatchConfirm')}
                    </button>
                </div>
            )}

            <div className="min-h-0 flex-1">
                {listProps.matches.length > 0 ? (
                    <CommandPaletteQueueList
                        {...listProps}
                        isDaylight={isDaylight}
                        isExecuting={isExecuting}
                    />
                ) : (
                    <div className="flex h-full items-center justify-center px-6 text-center text-sm opacity-45">
                        {t('commandPalette.queueNoMatches')}
                    </div>
                )}
            </div>
        </div>
    );
};

export default CommandPaletteQueueView;
