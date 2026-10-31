import React, { useMemo } from 'react';
import { Pencil } from 'lucide-react';
import type { SongResult, Theme, UnifiedSong } from '../../../../types';
import { getSongUnavailableLabel, isSongUnavailable } from '../../../../services/onlineMusic/songAvailability';
import { canResolveSongCatalogRef } from '../../../../services/onlineMusic/catalogRefs';
import { resolveTrackAlbumTargetId } from '../../../core/shared/trackLinks';
import { CARD_TITLE_ATTR, MORPH_FRAME_ATTR } from '../transitions/gridMorphContract';
import {
    formatCardDuration,
    PolaroidCardActions,
    PolaroidCardArtists,
    PolaroidCardQuickActions,
    PolaroidCardCover,
    PolaroidCardRemoveButton,
    PolaroidCardUnavailableBadge,
    type GridItem,
    type PolaroidCardMode,
} from './polaroidCardParts';
import type { GridPlaybackMark } from './useGridStayPlayback';

// src/library/suites/grid/shared/PolaroidCard.tsx
// The card the folia hex grids render. Two layouts share one component: the polaroid frame (square
// artwork over a printed label) and the full-bleed cover, where the artwork fills the card and the
// copy sits on a gradient scrim. Moved out of GridView.tsx when the second layout arrived.

export type { GridItem } from './polaroidCardParts';

/** The gradient a full-bleed card paints over its artwork, under its copy. */
export const fullBleedScrim = (isDaylight: boolean): string => {
    const shadeRgb = isDaylight ? '255 255 255' : '0 0 0';
    return `linear-gradient(180deg, rgb(${shadeRgb} / 0%) 26%, rgb(${shadeRgb} / 30%) 50%, rgb(${shadeRgb} / 74%) 74%, rgb(${shadeRgb} / 93%) 100%)`;
};

export interface PolaroidCardProps {
    item: GridItem;
    isDaylight: boolean;
    theme: Theme;
    onSelect: () => void;
    onCenter: () => void;
    onAddQueue?: () => void;
    /** 收进速记簿；悬浮按钮（指针在卡片上才出现）。 */
    onCollect?: () => void;
    /** 收藏到歌单（应用的歌单选择器，含「我喜欢」）；悬浮按钮。 */
    onSaveToPlaylist?: () => void;
    mode: PolaroidCardMode;
    t: any;
    cardWidth: number;
    cardHeight: number;
    isEditMode?: boolean;
    onRemoveTrack?: () => void;
    onSelectArtist?: (artistId: number | string, artist?: any, track?: SongResult) => void;
    onSelectAlbum?: (albumId: number | string, album?: any, track?: SongResult) => void;
    onBeforeNestedNavigate?: () => void;
    onEditLocalMetadata?: () => void;
    openWhenFocusedOnCardClick?: boolean;
    isFocused?: boolean;
    /** Artwork fills the whole card and the copy moves onto a scrim over it. */
    fullBleedCover?: boolean;
    /** fb3: under "stay here", the playing song's card shows pause / resume instead of play. */
    playbackMark?: GridPlaybackMark | null;
}

/**
 * High-performance memoized Polaroid card — pure visual component.
 * All position/scale/opacity/zIndex/display transforms are managed
 * by a single centralized rAF loop in the parent GridView via wrapper refs.
 * Queue button opacity uses inherited CSS custom property --queue-opacity / --queue-pe.
 */
export const PolaroidCard = React.memo<PolaroidCardProps>(
    ({
        item,
        isDaylight,
        theme,
        onSelect,
        onCenter,
        onAddQueue,
        onCollect,
        onSaveToPlaylist,
        mode,
        t,
        cardWidth,
        cardHeight,
        isEditMode = false,
        onRemoveTrack,
        onSelectArtist,
        onSelectAlbum,
        onBeforeNestedNavigate,
        onEditLocalMetadata,
        openWhenFocusedOnCardClick = false,
        isFocused = false,
        fullBleedCover = false,
        playbackMark = null,
    }) => {
        const isUnavailable = mode === 'tracks' && item.rawTrack ? isSongUnavailable(item.rawTrack) : false;
        const unavailableTagText = (mode === 'tracks' && item.rawTrack)
            ? getSongUnavailableLabel(item.rawTrack, t('status.songUnavailableTag'))
            : '';
        const trackAlbum = item.rawTrack?.album;
        const albumTargetId = resolveTrackAlbumTargetId(item.rawTrack);
        const canOpenAlbum = Boolean(
            onSelectAlbum
            && item.rawTrack
            && trackAlbum
            && albumTargetId !== undefined
            && albumTargetId !== ''
            && (
                item.rawTrack.sourceRef?.kind !== 'online'
                || canResolveSongCatalogRef(item.rawTrack as UnifiedSong, 'album', trackAlbum)
            )
        );

        const textLength = useMemo(() => {
            let len = 0;
            if (typeof item.name === 'string') {
                len += item.name.length;
            }
            if (item.subtitle) {
                len += item.subtitle.length;
            }
            if (item.description) {
                len += item.description.length;
            }
            if (mode === 'tracks' && item.rawTrack) {
                const albumName = item.rawTrack.album?.name || '';
                len += albumName.length;
            }
            return len;
        }, [item.name, item.subtitle, item.description, item.rawTrack, mode]);

        // Only the polaroid frame grows with its label; the full-bleed layout clamps its copy over a
        // fixed box instead, which is also what keeps that wall of covers on one uniform grid.
        const scaleFactor = useMemo(() => {
            if (fullBleedCover) return 1.0;
            if (textLength > 100) return 1.18;
            if (textLength > 65) return 1.12;
            if (textLength > 35) return 1.06;
            return 1.0;
        }, [fullBleedCover, textLength]);

        const dynamicWidth = cardWidth * scaleFactor;
        const dynamicHeight = cardHeight * scaleFactor;

        const handleCardClick = (e: React.MouseEvent) => {
            if (isEditMode) {
                e.stopPropagation();
                return;
            }
            if (openWhenFocusedOnCardClick && isFocused) {
                onSelect();
                return;
            }
            onCenter();
        };

        const openAlbum = (e: React.MouseEvent) => {
            e.stopPropagation();
            if (canOpenAlbum && albumTargetId !== undefined && onSelectAlbum) {
                onBeforeNestedNavigate?.();
                onSelectAlbum(albumTargetId, item.rawTrack?.album, item.rawTrack);
            }
        };

        // 加入速记簿、收藏到歌单：悬浮才出现的两颗（编辑模式、不可播放的歌不给）。
        const quickActions = mode === 'tracks' && !isEditMode && !isUnavailable ? (
            <PolaroidCardQuickActions onCollect={onCollect} onSaveToPlaylist={onSaveToPlaylist} isFocused={isFocused} t={t} />
        ) : null;

        const editMetadataButton = isFocused && onEditLocalMetadata ? (
            <button
                type="button"
                // 三重条件才出现（聚焦 + 本地歌曲 + 悬停歌名），思索认它靠这个属性。
                data-ponder="local-metadata-match"
                onClick={(event) => {
                    event.stopPropagation();
                    onEditLocalMetadata();
                }}
                className="absolute -right-1 top-0 rounded-md bg-[var(--bg-color)]/85 p-1 opacity-0 shadow-sm backdrop-blur-sm transition-opacity hover:bg-current/10 group-hover/song-title:opacity-65 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-current/30"
                title={t('localMusic.manualMetadataMatch')}
                aria-label={t('localMusic.manualMetadataMatch')}
            >
                <Pencil size={13} />
            </button>
        ) : null;

        if (fullBleedCover) {
            // Readability follows the poster wall: one static gradient painted over the artwork, and
            // deliberately no backdrop-filter. A blurred plate per card would promote every card to
            // its own compositing layer, which is the single largest GPU cost the wall ever measured.
            const scrim = fullBleedScrim(isDaylight);

            return (
                <div
                    {...{ [MORPH_FRAME_ATTR]: '' }}
                    className="group/card relative rounded-xl overflow-hidden border shadow-lg hover:shadow-2xl transition-shadow duration-300 theme-polaroid-card"
                    style={{ width: dynamicWidth, height: dynamicHeight }}
                    onClick={handleCardClick}
                >
                    <div className="absolute inset-0 bg-zinc-200/60 dark:bg-zinc-800/60">
                        <PolaroidCardCover item={item} isUnavailable={isUnavailable} spinnerSize={56} />
                    </div>

                    <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: scrim }} />

                    {isUnavailable && (
                        <PolaroidCardUnavailableBadge label={unavailableTagText || t('status.songUnavailableTag').toUpperCase()} />
                    )}

                    <PolaroidCardRemoveButton
                        show={Boolean(isEditMode && onRemoveTrack && !isUnavailable)}
                        onRemove={onRemoveTrack}
                    />

                    {quickActions}

                    <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-1 p-3 text-left">
                        <div className="group/song-title relative max-w-full">
                            <div
                                {...{ [CARD_TITLE_ATTR]: '' }}
                                className="text-sm font-bold tracking-tight leading-snug line-clamp-3 whitespace-normal break-words"
                            >
                                {item.name}
                            </div>
                            {editMetadataButton}
                        </div>

                        {item.description && (
                            <div className="text-[10px] opacity-70 font-medium line-clamp-2 whitespace-normal break-words">
                                <PolaroidCardArtists
                                    item={item}
                                    mode={mode}
                                    onSelectArtist={onSelectArtist}
                                    onBeforeNestedNavigate={onBeforeNestedNavigate}
                                />
                            </div>
                        )}

                        <div className="flex items-end justify-between gap-2 pt-0.5 w-full">
                            <div className="flex flex-col min-w-0 flex-1">
                                {mode === 'tracks' && item.rawTrack && (
                                    <>
                                        <span
                                            onClick={openAlbum}
                                            className={`text-[9px] opacity-55 font-mono line-clamp-1 break-all max-w-full ${
                                                canOpenAlbum ? 'hover:underline hover:opacity-90 cursor-pointer' : ''
                                            }`}
                                        >
                                            {item.rawTrack.album?.name || ''}
                                        </span>
                                        <span className="text-[9px] opacity-55 font-mono">
                                            {formatCardDuration(item.rawTrack.durationMs)}{item.rawTrack.isVideo && !isUnavailable && ` · ${t('status.songVideoTag')}`}
                                        </span>
                                    </>
                                )}
                            </div>
                            <PolaroidCardActions
                                mode={mode}
                                isEditMode={isEditMode}
                                isUnavailable={isUnavailable}
                                onSelect={onSelect}
                                onAddQueue={onAddQueue}
                                playbackMark={playbackMark}
                                t={t}
                            />
                        </div>
                    </div>
                </div>
            );
        }

        return (
            <div
                {...{ [MORPH_FRAME_ATTR]: '' }}
                className="group/card rounded-xl p-3 flex flex-col items-center border transition-shadow duration-300 shadow-lg hover:shadow-2xl theme-polaroid-card"
                style={{
                    width: dynamicWidth,
                    minHeight: dynamicHeight,
                    height: 'auto',
                }}
                onClick={handleCardClick}
            >
                {/* Square Polaroid Photo Area */}
                <div className="w-full aspect-square rounded-lg overflow-hidden bg-zinc-200/60 dark:bg-zinc-800/60 relative shadow-inner flex items-center justify-center shrink-0">
                    <PolaroidCardCover item={item} isUnavailable={isUnavailable} />

                    {/* Unavailable Mask/Badge */}
                    {isUnavailable && (
                        <PolaroidCardUnavailableBadge label={unavailableTagText || t('status.songUnavailableTag').toUpperCase()} />
                    )}

                    {/* Delete button overlay for Edit Mode */}
                    <PolaroidCardRemoveButton
                        show={Boolean(isEditMode && onRemoveTrack && !isUnavailable)}
                        onRemove={onRemoveTrack}
                    />

                    {quickActions}
                </div>

                {/* Bottom Polaroid Frame Label Details */}
                <div className="w-full flex-1 flex flex-col justify-between pt-3 text-left min-w-0">
                    <div className="space-y-1 mb-2">
                        {/* Title */}
                        <div className="group/song-title relative max-w-full">
                            <div
                                {...{ [CARD_TITLE_ATTR]: '' }}
                                className="text-s font-bold tracking-tight opacity-90 max-w-full line-clamp-4 whitespace-normal break-words"
                            >
                                {item.name}
                            </div>
                            {editMetadataButton}
                        </div>
                        {/* Clickable Artists */}
                        {item.description && (
                            <div className="text-[10px] opacity-55 max-w-full font-medium line-clamp-3 whitespace-normal break-words">
                                <PolaroidCardArtists
                                    item={item}
                                    mode={mode}
                                    onSelectArtist={onSelectArtist}
                                    onBeforeNestedNavigate={onBeforeNestedNavigate}
                                />
                            </div>
                        )}
                    </div>

                    <div className="flex items-end justify-between mt-auto pt-1.5 w-full">
                        {/* Left: Clickable Album name & Duration */}
                        <div className="flex flex-col min-w-0 flex-1 pr-2">
                            {mode === 'tracks' && item.rawTrack && (
                                <>
                                    <span
                                        onClick={openAlbum}
                                        className={`text-[9px] opacity-35 font-mono line-clamp-2 whitespace-normal break-words max-w-full ${
                                            canOpenAlbum ? 'hover:underline hover:opacity-85 cursor-pointer' : ''
                                        }`}
                                    >
                                        {item.rawTrack.album?.name || ''}
                                    </span>
                                    <span className="text-[9px] opacity-35 font-mono">
                                        {formatCardDuration(item.rawTrack.durationMs)}{item.rawTrack.isVideo && !isUnavailable && ` · ${t('status.songVideoTag')}`}
                                    </span>
                                </>
                            )}
                        </div>

                        {/* Right: Buttons in bottom right corner */}
                        <PolaroidCardActions
                            mode={mode}
                            isEditMode={isEditMode}
                            isUnavailable={isUnavailable}
                            onSelect={onSelect}
                            onAddQueue={onAddQueue}
                            playbackMark={playbackMark}
                            t={t}
                        />
                    </div>
                </div>
            </div>
        );
    },
    (prev, next) => {
        return (
            prev.item.id === next.item.id &&
            prev.item.name === next.item.name &&
            prev.item.coverUrl === next.item.coverUrl &&
            prev.item.subtitle === next.item.subtitle &&
            prev.item.description === next.item.description &&
            prev.isDaylight === next.isDaylight &&
            prev.theme === next.theme &&
            prev.mode === next.mode &&
            prev.cardWidth === next.cardWidth &&
            prev.cardHeight === next.cardHeight &&
            prev.isEditMode === next.isEditMode &&
            prev.fullBleedCover === next.fullBleedCover &&
            prev.openWhenFocusedOnCardClick === next.openWhenFocusedOnCardClick &&
            Boolean(prev.onEditLocalMetadata) === Boolean(next.onEditLocalMetadata) &&
            Boolean(prev.onCollect) === Boolean(next.onCollect) &&
            Boolean(prev.onSaveToPlaylist) === Boolean(next.onSaveToPlaylist) &&
            prev.playbackMark === next.playbackMark &&
            prev.isFocused === next.isFocused
        );
    }
);

export default PolaroidCard;
