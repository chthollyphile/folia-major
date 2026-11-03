import React, { useEffect, useMemo, useRef, useState } from 'react';
import { List, useListRef } from 'react-window';
import type { UnifiedSong } from '../../../types';
import type { MediaId, OmniCollection } from '../../../types/onlineMusic';
import SearchResultRow from './SearchResultRow';
import SearchCollectionRow from './SearchCollectionRow';

// src/components/app/search/SearchResultsList.tsx

/** 结果到了之后这么久，行的入场动画放完：再滚出来的行不再滑入（search.css 的 data-search-entered）。 */
const ROW_REVEAL_MS = 1000;

type SongHandlers = {
    onPlayTrack: (track: UnifiedSong) => void;
    onAddTrackToQueue: (track: UnifiedSong) => void;
    onCollectTrack?: (track: UnifiedSong) => void;
    canSaveTrackToPlaylist?: (track: UnifiedSong) => boolean;
    onSaveTrackToPlaylist?: (track: UnifiedSong) => void;
    onOpenArtist: (track: UnifiedSong, artistName: string, artistId?: MediaId, entityId?: string) => void;
    onOpenAlbum: (track: UnifiedSong, albumName: string, albumId?: MediaId, entityId?: string) => void;
};

type SearchResultsListProps = SongHandlers & {
    /** 单曲结果；搜专辑、歌单时给 collections。 */
    tracks?: UnifiedSong[];
    collections?: OmniCollection[];
    /** 换了这组结果（来源、种类或词变了）就再放一次入场动画。 */
    revealKey: string;
    scrollTop: number;
    onScrollTopChange: (scrollTop: number) => void;
    onOpenCollection: (collection: OmniCollection) => void;
};

type SongRowProps = SongHandlers & { tracks: UnifiedSong[] };
type CollectionRowProps = { collections: OmniCollection[]; onOpenCollection: (collection: OmniCollection) => void };

const SongRow = ({ index, style, tracks, ...handlers }: { index: number; style: React.CSSProperties } & SongRowProps) => (
    <SearchResultRow track={tracks[index]} index={index} style={style} {...handlers} />
);

const CollectionRow = ({ index, style, collections, onOpenCollection }: { index: number; style: React.CSSProperties } & CollectionRowProps) => (
    <SearchCollectionRow collection={collections[index]} index={index} style={style} onOpenCollection={onOpenCollection} />
);

const SearchResultsList: React.FC<SearchResultsListProps> = ({
    tracks,
    collections,
    revealKey,
    scrollTop,
    onScrollTopChange,
    onPlayTrack,
    onAddTrackToQueue,
    onCollectTrack,
    canSaveTrackToPlaylist,
    onSaveTrackToPlaylist,
    onOpenArtist,
    onOpenAlbum,
    onOpenCollection,
}) => {
    const listRef = useListRef(null);
    const latestScrollTopRef = useRef(scrollTop);
    const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // 入场放完的是哪一组结果：换组的那一次渲染里就不相等，行从第一帧起带着动画。
    const [enteredKey, setEnteredKey] = useState<string | null>(null);
    const isCollectionList = Boolean(collections);
    const rowCount = collections ? collections.length : tracks?.length ?? 0;
    const songRowProps = useMemo<SongRowProps>(() => ({
        tracks: tracks ?? [],
        onPlayTrack,
        onAddTrackToQueue,
        onCollectTrack,
        canSaveTrackToPlaylist,
        onSaveTrackToPlaylist,
        onOpenArtist,
        onOpenAlbum,
    }), [canSaveTrackToPlaylist, onAddTrackToQueue, onCollectTrack, onOpenAlbum, onOpenArtist, onPlayTrack, onSaveTrackToPlaylist, tracks]);
    const collectionRowProps = useMemo<CollectionRowProps>(() => ({
        collections: collections ?? [],
        onOpenCollection,
    }), [collections, onOpenCollection]);

    useEffect(() => {
        const element = listRef.current?.element;
        if (element && Math.abs(element.scrollTop - scrollTop) > 1) {
            element.scrollTop = scrollTop;
        }
        latestScrollTopRef.current = scrollTop;
    }, [listRef, scrollTop, tracks, collections]);

    useEffect(() => {
        const timer = setTimeout(() => setEnteredKey(revealKey), ROW_REVEAL_MS);
        return () => clearTimeout(timer);
    }, [revealKey]);

    useEffect(() => () => {
        if (commitTimerRef.current) {
            clearTimeout(commitTimerRef.current);
        }
        onScrollTopChange(latestScrollTopRef.current);
    }, [onScrollTopChange]);

    const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
        latestScrollTopRef.current = event.currentTarget.scrollTop;
        if (commitTimerRef.current) {
            clearTimeout(commitTimerRef.current);
        }
        commitTimerRef.current = setTimeout(() => {
            onScrollTopChange(latestScrollTopRef.current);
        }, 120);
    };

    return (
        <div className="search-list h-full w-full" data-search-entered={enteredKey === revealKey ? '' : undefined}>
            {isCollectionList ? (
                <List
                    listRef={listRef}
                    rowCount={rowCount}
                    rowHeight={84}
                    rowComponent={CollectionRow as any}
                    rowProps={collectionRowProps}
                    overscanCount={6}
                    className="custom-scrollbar"
                    style={{ height: '100%', width: '100%' }}
                    onScroll={handleScroll}
                />
            ) : (
                <List
                    listRef={listRef}
                    rowCount={rowCount}
                    rowHeight={76}
                    rowComponent={SongRow as any}
                    rowProps={songRowProps}
                    overscanCount={6}
                    className="custom-scrollbar"
                    style={{ height: '100%', width: '100%' }}
                    onScroll={handleScroll}
                />
            )}
        </div>
    );
};

export default SearchResultsList;
