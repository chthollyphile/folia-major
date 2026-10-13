import React from 'react';
import { ListEnd, ListPlus, Trash2 } from 'lucide-react';
import type { RowComponentProps } from 'react-window';
import { getSongUnavailableLabel, isSongUnavailable } from '../../services/onlineMusic/songAvailability';
import { getSongArtistLabel } from '../../services/onlineMusic/songMetadata';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';
import type { CommandPaletteMatch } from './types';
import type { QueueUiEntryContent } from '../../mods/folium/queueUi';
import { QueueUiComponents, QueueUiOverline } from '../shared/QueueUiAdditions';

// src/components/command-palette/CommandPaletteQueueRow.tsx
// Renders one searchable queue entry and its three hover editing actions.

export type CommandPaletteQueueRowProps = {
    activeIndex: number;
    currentSongKey: string | null;
    isDaylight: boolean;
    isExecuting: boolean;
    readEntry: (index: number) => QueueUiEntryContent;
    labels: {
        moveToEnd: string;
        playNext: string;
        remove: string;
        unavailable: string;
        artist: string;
        album: string;
    };
    matches: CommandPaletteMatch[];
    onActiveIndexChange: (index: number) => void;
    onExecuteMatch: (index: number) => Promise<boolean>;
    onMoveSongToEnd: (index: number) => void;
    onMoveSongToNext: (index: number) => void;
    onRemoveSong: (index: number) => void;
};

const CommandPaletteQueueRow = ({
    index,
    style,
    ariaAttributes,
    activeIndex,
    currentSongKey,
    isDaylight,
    isExecuting,
    readEntry,
    labels,
    matches,
    onActiveIndexChange,
    onExecuteMatch,
    onMoveSongToEnd,
    onMoveSongToNext,
    onRemoveSong,
}: RowComponentProps<CommandPaletteQueueRowProps>): React.ReactElement | null => {
    const match = matches[index];
    const song = match?.command.queueSong;
    const queueIndex = match?.command.queueIndex;
    if (!match || !song || queueIndex === undefined) {
        return null;
    }
    const additions = readEntry(queueIndex);
    const hasAddedActions = additions.trailing.length > 0;
    const rowStyle = hasAddedActions
        ? { ...style, '--queue-ui-action-padding': `${120 + additions.trailing.reduce((width, component) => width + (component.width ?? 0) + 2, 0)}px` } as React.CSSProperties
        : style;

    const isSelected = index === activeIndex;
    const isPlaying = currentSongKey === getPlaybackSongKey(song);
    const unavailable = isSongUnavailable(song);
    const selectedClass = isDaylight ? 'bg-black/10' : 'bg-white/10';
    const hoverClass = isDaylight ? 'hover:bg-black/[0.05]' : 'hover:bg-white/[0.06]';

    return (
        <div style={rowStyle} {...ariaAttributes} className="px-1 py-0.5">
            <div
                className={`group/queue-row relative h-full rounded-2xl ${
                    isSelected ? selectedClass : hoverClass
                } ${unavailable ? 'opacity-55' : ''}`}
            >
                <button
                    type="button"
                    disabled={isExecuting}
                    data-active={isPlaying}
                    onClick={() => {
                        onActiveIndexChange(index);
                        void onExecuteMatch(index);
                    }}
                    className={`flex h-full w-full items-center gap-1.5 rounded-2xl px-2 ${hasAddedActions ? 'pr-[var(--queue-ui-action-padding)]' : 'pr-[7.5rem]'} text-left${additions.overlines.length ? ' pt-3' : ''}`}
                >
                    <span
                        className={`h-7 w-1 shrink-0 rounded-full ${
                            isPlaying ? (isDaylight ? 'bg-zinc-700' : 'bg-white') : 'bg-transparent'
                        }`}
                    />
                    <span className="w-6 shrink-0 text-right font-mono text-[10px] tabular-nums opacity-40">
                        #{queueIndex + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">{song.name}</span>
                            {unavailable && (
                                <span className="shrink-0 rounded-full border border-current/10 px-1.5 py-0.5 text-[9px] opacity-70">
                                    {getSongUnavailableLabel(song, labels.unavailable)}
                                </span>
                            )}
                        </span>
                        <span className="block truncate text-xs opacity-45">{getSongArtistLabel(song)}</span>
                        {match.queueReasons && match.queueReasons.length > 0 && (
                            <span className={`absolute bottom-1.5 ${hasAddedActions ? 'right-[var(--queue-ui-action-padding)]' : 'right-[7.5rem]'} flex gap-1`}>
                                {match.queueReasons.map(reason => (
                                    <span
                                        key={reason}
                                        className="rounded-full border border-current/10 px-1.5 py-0.5 text-[9px] opacity-55"
                                    >
                                        {reason === 'artist' ? labels.artist : labels.album}
                                    </span>
                                ))}
                            </span>
                        )}
                    </span>
                </button>
                {additions.overlines.length > 0 && <div className="absolute left-12 top-1/2 -translate-y-6"
                    style={{ right: hasAddedActions ? 'var(--queue-ui-action-padding)' : '7.5rem' }}>
                    <QueueUiOverline content={additions} isDaylight={isDaylight} />
                </div>}
                <span
                    className={`absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5
                        pointer-events-none opacity-0
                        group-hover/queue-row:pointer-events-auto group-hover/queue-row:opacity-100
                        focus-within:pointer-events-auto focus-within:opacity-100`}
                >
                    {[
                        { label: labels.playNext, icon: ListPlus, action: onMoveSongToNext },
                        { label: labels.moveToEnd, icon: ListEnd, action: onMoveSongToEnd },
                        { label: labels.remove, icon: Trash2, action: onRemoveSong },
                    ].map(({ label, icon: Icon, action }) => (
                        <button
                            key={label}
                            type="button"
                            title={label}
                            aria-label={label}
                            onClick={(event) => {
                                event.stopPropagation();
                                if (event.detail > 0) {
                                    event.currentTarget.blur();
                                }
                                action(queueIndex);
                            }}
                            className={`rounded-lg p-2 transition-colors ${
                                isDaylight ? 'hover:bg-black/10' : 'hover:bg-white/10'
                            }`}
                        >
                            <Icon size={14} />
                        </button>
                    ))}
                    <QueueUiComponents components={additions.trailing} isDaylight={isDaylight} />
                </span>
            </div>
        </div>
    );
};

export default CommandPaletteQueueRow;
