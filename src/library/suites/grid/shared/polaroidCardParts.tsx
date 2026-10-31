import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Disc, NotebookPen, Pause, Play, Plus, X } from 'lucide-react';
import type { SongResult, UnifiedSong } from '../../../../types';
import { getSizedCoverUrl } from '../../../../utils/coverUrl';
import { canResolveSongCatalogRef } from '../../../../services/onlineMusic/catalogRefs';
import { resolveTrackArtistTargetId } from '../../../core/shared/trackLinks';
import type { GridPlaybackMark } from './useGridStayPlayback';

// src/library/suites/grid/shared/polaroidCardParts.tsx
// The pieces both PolaroidCard layouts share: the cover image with its spinner placeholder, the
// clickable artist run, the play/queue buttons and the edit-mode delete affordance. Split out of
// GridView.tsx so the polaroid frame and the full-bleed cover stay readable side by side.

export interface GridItem {
    id: string | number;
    name: React.ReactNode;
    searchText?: string;
    coverUrl?: string;
    subtitle?: string;
    description?: string;
    rawTrack?: SongResult;
    rawTrackIndex?: number;
    rawCollection?: any;
}

export type PolaroidCardMode = 'collection' | 'tracks';

/** mm:ss for the card's duration stamp. */
export const formatCardDuration = (durationMs?: number): string => {
    const total = durationMs || 0;
    const minutes = Math.floor(total / 60000);
    const seconds = Math.floor((total % 60000) / 1000);
    return minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
};

/**
 * Cover artwork plus the placeholder it crossfades out of. The placeholder is the image's next
 * sibling on purpose: the load handlers reach it through `nextElementSibling`, so an image decoded
 * from cache can hide it without a React render.
 */
export const PolaroidCardCover: React.FC<{
    item: GridItem;
    isUnavailable: boolean;
    spinnerSize?: number;
}> = ({ item, isUnavailable, spinnerSize = 48 }) => {
    if (!item.coverUrl) {
        return (
            <div className="absolute inset-0 bg-zinc-300/40 dark:bg-zinc-700/40 flex items-center justify-center">
                <Disc size={spinnerSize} className="opacity-20" style={{ color: 'var(--text-primary)' }} />
            </div>
        );
    }

    return (
        <>
            <img
                src={getSizedCoverUrl(item.coverUrl, 512)}
                alt={typeof item.name === 'string' ? item.name : ''}
                loading="lazy"
                decoding="async"
                ref={(el) => {
                    if (el && el.complete) {
                        el.style.opacity = isUnavailable ? '0.3' : '1';
                        const placeholder = el.nextElementSibling as HTMLElement;
                        if (placeholder) {
                            placeholder.style.opacity = '0';
                            placeholder.style.display = 'none';
                        }
                    }
                }}
                onLoad={(e) => {
                    const img = e.currentTarget;
                    img.style.opacity = isUnavailable ? '0.3' : '1';
                    const placeholder = img.nextElementSibling as HTMLElement;
                    if (placeholder) {
                        placeholder.style.opacity = '0';
                        setTimeout(() => {
                            placeholder.style.display = 'none';
                        }, 350);
                    }
                }}
                className="w-full h-full object-cover transition-opacity duration-350 pointer-events-none select-none opacity-0"
            />
            <div className="absolute inset-0 bg-zinc-300/40 dark:bg-zinc-700/40 transition-opacity duration-350 flex items-center justify-center">
                <Disc size={spinnerSize} className="opacity-20 animate-spin" style={{ animationDuration: '3s', color: 'var(--text-primary)' }} />
            </div>
        </>
    );
};

export const PolaroidCardUnavailableBadge: React.FC<{ label: string }> = ({ label }) => (
    <div className="absolute inset-0 bg-black/40 flex items-center justify-center p-2 text-center z-10">
        <span className="text-[10px] bg-red-500/80 text-white font-bold px-2 py-1 rounded-full uppercase tracking-wider">
            {label}
        </span>
    </div>
);

/**
 * Edit-mode delete affordance. `AnimatePresence` stays mounted and the button is the conditional
 * child, so leaving edit mode still plays the exit animation instead of cutting the button away.
 */
export const PolaroidCardRemoveButton: React.FC<{ show: boolean; onRemove?: () => void }> = ({ show, onRemove }) => (
    <AnimatePresence>
        {show && (
            <motion.button
                key="delete-btn"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                onClick={(e) => {
                    e.stopPropagation();
                    onRemove?.();
                }}
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-lg border border-white/20 z-[60] active:scale-90 transition-transform cursor-pointer"
            >
                <X size={14} className="stroke-[3]" />
            </motion.button>
        )}
    </AnimatePresence>
);

/** Artist names, each clickable when the track carries a resolvable artist reference. */
export const PolaroidCardArtists: React.FC<{
    item: GridItem;
    mode: PolaroidCardMode;
    onSelectArtist?: (artistId: number | string, artist?: any, track?: SongResult) => void;
    onBeforeNestedNavigate?: () => void;
}> = ({ item, mode, onSelectArtist, onBeforeNestedNavigate }) => {
    if (!(mode === 'tracks' && onSelectArtist && item.rawTrack?.artists)) {
        return <>{item.description}</>;
    }

    return (
        <span className="flex gap-1 flex-wrap">
            {item.rawTrack.artists.map((artist, idx, artists) => {
                const artistTargetId = resolveTrackArtistTargetId(item.rawTrack, artist);
                const canOpenArtist = Boolean(
                    artistTargetId !== undefined
                    && artistTargetId !== ''
                    && (
                        item.rawTrack?.sourceRef?.kind !== 'online'
                        || canResolveSongCatalogRef(item.rawTrack as UnifiedSong, 'artist', artist)
                    )
                );
                return (
                    <span
                        key={`${artist.id ?? 'artist'}-${idx}-${artist.name}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (canOpenArtist && artistTargetId !== undefined) {
                                onBeforeNestedNavigate?.();
                                onSelectArtist(artistTargetId, artist, item.rawTrack);
                            }
                        }}
                        className={canOpenArtist
                            ? 'hover:underline hover:opacity-100 cursor-pointer text-current font-semibold'
                            : 'text-current font-semibold'}
                    >
                        {artist.name}{idx < artists.length - 1 ? ',' : ''}
                    </span>
                );
            })}
        </span>
    );
};

/**
 * Play and add-to-queue buttons. Both fade with the distance-driven custom properties the grid's
 * rAF loop writes onto the card wrapper, so neither costs a React render while dragging.
 */
export const PolaroidCardActions: React.FC<{
    mode: PolaroidCardMode;
    isEditMode: boolean;
    isUnavailable: boolean;
    onSelect: () => void;
    onAddQueue?: () => void;
    /** 收进速记簿（只在聚焦的卡上给）；跟入队键一样随距离淡出。 */
    onCollect?: () => void;
    /**
     * fb3：「留在原处」时正在播放的这首：播放键画成暂停（在播）/ 继续（暂停中），onSelect 由调用方路由到播放开关
     * （useGridStayPlayback）。null / 不给时是普通的「播放」。
     */
    playbackMark?: GridPlaybackMark | null;
    t: any;
}> = ({ mode, isEditMode, isUnavailable, onSelect, onAddQueue, onCollect, playbackMark = null, t }) => (
    <div className="flex items-center gap-1.5 shrink-0">
        {mode === 'tracks' && !isEditMode && (
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onSelect();
                }}
                style={{
                    opacity: 'var(--play-opacity, 0)',
                    pointerEvents: 'var(--play-pe, none)' as any,
                    transform: 'scale(var(--play-scale, 0.8))',
                    transition: 'opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.2s ease, color 0.2s ease',
                }}
                className="w-9 h-9 rounded-full bg-zinc-800/10 dark:bg-zinc-100/10 hover:bg-zinc-900 hover:text-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-900 text-current flex items-center justify-center shadow-sm pointer-events-auto z-10"
                title={playbackMark ? t(playbackMark === 'playing' ? 'ui.pause' : 'ui.play') : t('playlist.play')}
                aria-label={playbackMark ? t(playbackMark === 'playing' ? 'ui.pause' : 'ui.play') : t('playlist.play')}
                data-grid-card-play={playbackMark ?? 'play'}
            >
                {playbackMark === 'playing'
                    ? <Pause size={15} fill="currentColor" />
                    : <Play size={15} fill="currentColor" className="ml-0.5" />}
            </button>
        )}
        {mode === 'tracks' && onCollect && !isUnavailable && !isEditMode && (
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onCollect();
                }}
                style={{ opacity: 'var(--queue-opacity, 1)' as any, pointerEvents: 'var(--queue-pe, auto)' as any }}
                className="w-9 h-9 rounded-full bg-zinc-800/10 dark:bg-zinc-100/10 hover:bg-zinc-900 hover:text-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-900 text-current flex items-center justify-center transition-colors shadow-sm pointer-events-auto"
                title={t('scratchpad.collect')}
                aria-label={t('scratchpad.collect')}
                data-grid-card-collect=""
            >
                <NotebookPen size={14} />
            </button>
        )}
        {mode === 'tracks' && onAddQueue && !isUnavailable && !isEditMode && (
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onAddQueue();
                }}
                style={{ opacity: 'var(--queue-opacity, 1)' as any, pointerEvents: 'var(--queue-pe, auto)' as any }}
                className="w-9 h-9 rounded-full bg-zinc-800/10 dark:bg-zinc-100/10 hover:bg-zinc-900 hover:text-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-900 text-current flex items-center justify-center transition-colors shadow-sm pointer-events-auto"
                title={t('navidrome.addToQueue')}
            >
                <Plus size={15} />
            </button>
        )}
    </div>
);
