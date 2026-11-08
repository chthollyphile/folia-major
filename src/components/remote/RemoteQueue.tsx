import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { motion } from 'framer-motion';
import { List, useListRef } from 'react-window';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RemoteQueueCommandType, RemoteQueueExpansion, RemoteQueueItem } from '../../types/remoteControl';
import { filterRemoteQueue } from './remoteQueueSearch';
import { RemoteQueueRow, type RemoteQueueRowProps } from './RemoteQueueRow';
import { REMOTE_NO_DRAG_STYLE, sendRemoteCommand } from './remoteWindowBridge';
import { REMOTE_QUEUE_FOLD_MS, REMOTE_QUEUE_ROW_HEIGHT, REMOTE_QUEUE_UNFOLD_MS } from './useRemoteQueue';
import './RemoteQueue.css';

// src/components/remote/RemoteQueue.tsx
// The play queue the remote window grows to show, below or above the card: a search field and a
// virtual list (react-window). A row plays its song; its three actions edit the queue; every
// command names the row by its key, so the main window still finds it if the queue moved since.
// Opening puts the audible song in the middle; a new song scrolls to it only if it is out of view.
// It unfolds out of the card's edge (a clip that opens away from the card, with a short slide)
// and folds back into it, at the card's own easing for settling into the sleeve.

/** The card's settle (remote.css --remote-settle) and a quicker fold. */
const UNFOLD_EASE = [0.32, 0.72, 0, 1] as const;
const FOLD_EASE = [0.4, 0, 0.7, 0.2] as const;
/** The clip reaches this far past the block when open, so its shadow is not cut. */
const CLIP_BLEED = 4;

/** The block's clip: open, or shut against the card's edge (`height` px of the block cut away from the far side). */
const queueClip = (direction: RemoteQueueExpansion['direction'], shut: number) => {
    const far = shut ? shut + CLIP_BLEED : -CLIP_BLEED;
    return direction === 'down'
        ? `inset(${-CLIP_BLEED}px ${-CLIP_BLEED}px ${far}px ${-CLIP_BLEED}px round 22px)`
        : `inset(${far}px ${-CLIP_BLEED}px ${-CLIP_BLEED}px ${-CLIP_BLEED}px round 22px)`;
};

type RemoteQueueProps = {
    /** Which side of the card it hangs off. */
    direction: RemoteQueueExpansion['direction'];
    /** The block's height in px. */
    height: number;
    items: readonly RemoteQueueItem[];
    currentKey: string | null;
    playingKey: string | null;
    readOnly: boolean;
    disabled: boolean;
    query: string;
    onQueryChange: (query: string) => void;
    reduceMotion: boolean;
};

const RemoteQueue: React.FC<RemoteQueueProps> = ({
    direction,
    height,
    items,
    currentKey,
    playingKey,
    readOnly,
    disabled,
    query,
    onQueryChange,
    reduceMotion,
}) => {
    const { t } = useTranslation();
    const listRef = useListRef(null);
    const frameRef = useRef<HTMLDivElement | null>(null);
    const searchRef = useRef<HTMLInputElement | null>(null);
    const [listHeight, setListHeight] = useState<number | null>(null);
    const matches = useMemo(() => filterRemoteQueue(items, query), [items, query]);
    const currentRow = useMemo(() => {
        const queueIndex = currentKey ? items.findIndex(item => item.key === currentKey) : -1;
        return queueIndex < 0 ? -1 : matches.indexOf(queueIndex);
    }, [currentKey, items, matches]);

    const latest = useRef({ items, matches });
    latest.current = { items, matches };

    const run = useCallback((type: RemoteQueueCommandType, queueIndex: number) => {
        const item = latest.current.items[queueIndex];
        if (item) sendRemoteCommand({ type, key: item.key, index: queueIndex });
    }, []);

    /** Scrolls row `rowIndex` into view and focuses its song (it may mount only after the scroll). */
    const focusRow = useCallback((rowIndex: number) => {
        const list = listRef.current;
        if (!list) return;
        list.scrollToRow({ index: rowIndex, align: 'auto', behavior: 'instant' });
        let attempts = 3;
        const tryFocus = () => {
            const button = list.element?.querySelector<HTMLButtonElement>(`[data-queue-row="${rowIndex}"] .remote-queue-song`);
            if (button) button.focus({ preventScroll: true });
            else if (--attempts > 0) requestAnimationFrame(tryFocus);
        };
        requestAnimationFrame(tryFocus);
    }, [listRef]);

    const keyDown = useCallback((rowIndex: number, event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const target = rowIndex + (event.key === 'ArrowUp' ? -1 : 1);
        if (target < 0) searchRef.current?.focus();
        else if (target < latest.current.matches.length) focusRow(target);
    }, [focusRow]);

    const labels = useMemo(() => ({
        playNext: t('queue.playNext'),
        moveToEnd: t('queue.moveToEnd'),
        remove: t('queue.remove'),
    }), [t]);

    const rowProps = useMemo<RemoteQueueRowProps>(
        () => ({ items, matches, currentKey, playingKey, readOnly, disabled, labels, run, keyDown }),
        [currentKey, disabled, items, keyDown, labels, matches, playingKey, readOnly, run],
    );

    // The list's height is the block's, measured here and handed to react-window as a number, so the
    // first scroll to the current song lands on a known height.
    useLayoutEffect(() => {
        const frame = frameRef.current;
        if (!frame) return undefined;
        setListHeight(Math.round(frame.clientHeight));
        const observer = new ResizeObserver(entries => {
            const height = Math.round(entries[entries.length - 1].contentRect.height);
            setListHeight(previous => (previous === height ? previous : height));
        });
        observer.observe(frame);
        return () => observer.disconnect();
    }, []);

    // Once measured: the audible song in the middle, once. Shorter than a row is not measured yet:
    // the list can mount before the page has its grown height (the reply to the resize may come
    // first), and centring in a list of height 0 would leave the song at the top.
    const centeredRef = useRef(false);
    useEffect(() => {
        if (listHeight === null || listHeight < REMOTE_QUEUE_ROW_HEIGHT || centeredRef.current) return undefined;
        const frame = requestAnimationFrame(() => {
            centeredRef.current = true;
            if (currentRow >= 0) listRef.current?.scrollToRow({ index: currentRow, align: 'center', behavior: 'instant' });
        });
        return () => cancelAnimationFrame(frame);
    }, [currentRow, listHeight, listRef]);

    // A new song: scroll to it only if it is out of view.
    const scrolledKeyRef = useRef(currentKey);
    useEffect(() => {
        if (scrolledKeyRef.current === currentKey) return;
        scrolledKeyRef.current = currentKey;
        if (currentRow >= 0) listRef.current?.scrollToRow({ index: currentRow, align: 'smart', behavior: 'smooth' });
    }, [currentKey, currentRow, listRef]);

    // A new search starts from the top.
    useEffect(() => {
        if (centeredRef.current) listRef.current?.scrollToRow({ index: 0, align: 'start', behavior: 'instant' });
    }, [query, listRef]);

    const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'ArrowDown' && matches.length > 0) {
            event.preventDefault();
            focusRow(0);
        } else if (event.key === 'Enter' && query && matches.length > 0 && !disabled) {
            event.preventDefault();
            run('queue-play', matches[0]);
        }
    };

    return (
        <motion.section
            className="remote-queue"
            aria-label={t('remote.queue')}
            style={{ ...REMOTE_NO_DRAG_STYLE, height }}
            initial={reduceMotion
                ? { opacity: 0 }
                : { opacity: 0.4, clipPath: queueClip(direction, height), y: direction === 'down' ? -8 : 8 }}
            animate={{
                opacity: 1,
                clipPath: queueClip(direction, 0),
                y: 0,
                transition: { duration: reduceMotion ? 0 : REMOTE_QUEUE_UNFOLD_MS / 1000, ease: UNFOLD_EASE },
            }}
            exit={reduceMotion
                ? { opacity: 0, transition: { duration: 0 } }
                : {
                    opacity: 0,
                    clipPath: queueClip(direction, height),
                    y: direction === 'down' ? -6 : 6,
                    transition: { duration: REMOTE_QUEUE_FOLD_MS / 1000, ease: FOLD_EASE },
                }}
        >
            <label className="remote-queue-search">
                <Search size={13} aria-hidden="true" />
                <input
                    ref={searchRef}
                    type="text"
                    value={query}
                    data-remote-queue-search=""
                    placeholder={t('remote.queueSearch', { count: items.length })}
                    aria-label={t('remote.queueSearch', { count: items.length })}
                    spellCheck={false}
                    onChange={event => onQueryChange(event.target.value)}
                    onKeyDown={handleSearchKeyDown}
                />
                {query && (
                    <button
                        type="button"
                        className="remote-queue-search__clear"
                        aria-label={t('remote.queueSearchClear')}
                        onClick={() => {
                            onQueryChange('');
                            searchRef.current?.focus();
                        }}
                    >
                        <X size={12} />
                    </button>
                )}
            </label>
            <motion.div
                ref={frameRef}
                className="remote-queue-list"
                // The rows come in just behind the edge, so the block opens before it fills.
                initial={reduceMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: reduceMotion ? 0 : 0.22, delay: reduceMotion ? 0 : 0.08, ease: 'easeOut' } }}
            >
                {items.length === 0 ? (
                    <p className="remote-queue-note">{t('queue.empty')}</p>
                ) : matches.length === 0 ? (
                    <p className="remote-queue-note">{t('remote.queueNoMatch')}</p>
                ) : (
                    <List
                        listRef={listRef}
                        aria-label={t('remote.queue')}
                        rowCount={matches.length}
                        rowHeight={REMOTE_QUEUE_ROW_HEIGHT}
                        rowComponent={RemoteQueueRow}
                        rowProps={rowProps}
                        overscanCount={4}
                        className="remote-queue-scroll"
                        style={{ height: listHeight ?? 0 }}
                    />
                )}
            </motion.div>
        </motion.section>
    );
};

export default RemoteQueue;
