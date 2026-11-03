import React from 'react';
import { List, useListRef } from 'react-window';
import { useTranslation } from 'react-i18next';
import type { SongResult } from '../../types';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';
import type { CommandPaletteMatch } from './types';
import CommandPaletteQueueRow, { type CommandPaletteQueueRowProps } from './CommandPaletteQueueRow';

// src/components/command-palette/CommandPaletteQueueList.tsx
// Virtualized queue results with the same row editing actions as the player queue tab.

const ROW_HEIGHT = 60;
const DEFAULT_VISIBLE_ROWS = 8;

export type CommandPaletteQueueListProps = {
    activeIndex: number;
    currentSong: SongResult | null;
    isDaylight: boolean;
    isExecuting: boolean;
    matches: CommandPaletteMatch[];
    query: string;
    onActiveIndexChange: (index: number) => void;
    onExecuteMatch: (index: number) => Promise<boolean>;
    onMoveSongToEnd: (index: number) => void;
    onMoveSongToNext: (index: number) => void;
    onRemoveSong: (index: number) => void;
};

const CommandPaletteQueueList: React.FC<CommandPaletteQueueListProps> = ({
    activeIndex,
    currentSong,
    isDaylight,
    isExecuting,
    matches,
    query,
    onActiveIndexChange,
    onExecuteMatch,
    onMoveSongToEnd,
    onMoveSongToNext,
    onRemoveSong,
}) => {
    const { t } = useTranslation();
    const listRef = useListRef(null);
    const hasPositionedRef = React.useRef(false);
    const currentSongKey = currentSong ? getPlaybackSongKey(currentSong) : null;
    // Looks among the palette's rows, which a typed query thins out, so this is not queueIndexOf.
    // The row that is the very object playing comes first, as in utils/queueBatchOperations.ts.
    const currentMatchIndex = React.useMemo(() => {
        if (!currentSong) {
            return -1;
        }
        const exactIndex = matches.findIndex(match => match.command.queueSong === currentSong);
        if (exactIndex >= 0) {
            return exactIndex;
        }
        return currentSongKey
            ? matches.findIndex(match => (
                match.command.queueSong
                && getPlaybackSongKey(match.command.queueSong) === currentSongKey
            ))
            : -1;
    }, [currentSong, currentSongKey, matches]);

    React.useLayoutEffect(() => {
        if (query || currentMatchIndex < 0) {
            return;
        }
        onActiveIndexChange(currentMatchIndex);

        // Wait for react-window to measure its percentage-height viewport before positioning.
        const frame = window.requestAnimationFrame(() => {
            const element = listRef.current?.element;
            if (!element) {
                return;
            }
            const viewportHeight = element.clientHeight || ROW_HEIGHT * DEFAULT_VISIBLE_ROWS;
            const visibleRowCount = Math.max(1, Math.floor(viewportHeight / ROW_HEIGHT));
            const rowsAboveCurrent = Math.floor((visibleRowCount - 1) / 2);
            const topRowIndex = Math.max(0, currentMatchIndex - rowsAboveCurrent);
            // Align the destination before scrolling so a correction cannot interrupt the animation.
            const maxScrollTop = Math.max(0, element.scrollHeight - viewportHeight);
            const targetScrollTop = Math.floor(Math.min(topRowIndex * ROW_HEIGHT, maxScrollTop) / ROW_HEIGHT) * ROW_HEIGHT;
            element.scrollTo({
                top: targetScrollTop,
                behavior: hasPositionedRef.current ? 'smooth' : 'instant',
            });
            hasPositionedRef.current = true;
        });
        return () => window.cancelAnimationFrame(frame);
    }, [currentMatchIndex, listRef, onActiveIndexChange, query]);

    React.useEffect(() => {
        if (activeIndex < 0 || activeIndex >= matches.length) {
            return;
        }
        // The playing row is already being centered; smart scrolling would cancel that animation.
        if (!query && activeIndex === currentMatchIndex) {
            return;
        }
        listRef.current?.scrollToRow({ index: activeIndex, align: 'smart', behavior: 'auto' });
    }, [activeIndex, currentMatchIndex, listRef, matches.length, query]);

    const rowProps = React.useMemo<CommandPaletteQueueRowProps>(() => ({
        activeIndex,
        currentSongKey,
        isDaylight,
        isExecuting,
        labels: {
            moveToEnd: t('queue.moveToEnd'),
            playNext: t('queue.playNext'),
            remove: t('queue.remove'),
            unavailable: t('status.songUnavailableTag'),
            video: t('status.songVideoTag'),
            artist: t('commandPalette.queueFacetArtist'),
            album: t('commandPalette.queueFacetAlbum'),
        },
        matches,
        onActiveIndexChange,
        onExecuteMatch,
        onMoveSongToEnd,
        onMoveSongToNext,
        onRemoveSong,
    }), [
        activeIndex,
        currentSongKey,
        isDaylight,
        isExecuting,
        matches,
        onActiveIndexChange,
        onExecuteMatch,
        onMoveSongToEnd,
        onMoveSongToNext,
        onRemoveSong,
        t,
    ]);

    return (
        <List
            listRef={listRef}
            rowCount={matches.length}
            rowHeight={ROW_HEIGHT}
            rowComponent={CommandPaletteQueueRow}
            rowProps={rowProps}
            overscanCount={2}
            className="custom-scrollbar select-none"
            style={{ height: '100%', width: '100%' }}
        />
    );
};

export default CommandPaletteQueueList;
