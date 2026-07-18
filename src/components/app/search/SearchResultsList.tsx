import React, { useEffect, useMemo, useRef } from 'react';
import { List, useListRef } from 'react-window';
import type { UnifiedSong } from '../../../types';
import type { MediaId } from '../../../types/onlineMusic';
import SearchResultRow from './SearchResultRow';

// src/components/app/search/SearchResultsList.tsx

type SearchResultsListProps = {
    tracks: UnifiedSong[];
    scrollTop: number;
    isDaylight: boolean;
    onScrollTopChange: (scrollTop: number) => void;
    onPlayTrack: (track: UnifiedSong) => void;
    onAddTrackToQueue: (track: UnifiedSong) => void;
    onOpenArtist: (track: UnifiedSong, artistName: string, artistId?: MediaId, entityId?: string) => void;
    onOpenAlbum: (track: UnifiedSong, albumName: string, albumId?: MediaId, entityId?: string) => void;
};

type RowProps = Omit<SearchResultsListProps, 'scrollTop' | 'onScrollTopChange'>;

const Row = ({ index, style, tracks, ...props }: { index: number; style: React.CSSProperties } & RowProps) => (
    <SearchResultRow track={tracks[index]} style={style} {...props} />
);

const SearchResultsList: React.FC<SearchResultsListProps> = ({
    tracks,
    scrollTop,
    onScrollTopChange,
    ...rowProps
}) => {
    const listRef = useListRef(null);
    const latestScrollTopRef = useRef(scrollTop);
    const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const stableRowProps = useMemo(() => ({ tracks, ...rowProps }), [rowProps, tracks]);

    useEffect(() => {
        const element = listRef.current?.element;
        if (element && Math.abs(element.scrollTop - scrollTop) > 1) {
            element.scrollTop = scrollTop;
        }
        latestScrollTopRef.current = scrollTop;
    }, [listRef, scrollTop, tracks]);

    useEffect(() => () => {
        if (commitTimerRef.current) {
            clearTimeout(commitTimerRef.current);
        }
        onScrollTopChange(latestScrollTopRef.current);
    }, [onScrollTopChange]);

    return (
        <List
            listRef={listRef}
            rowCount={tracks.length}
            rowHeight={76}
            rowComponent={Row as any}
            rowProps={stableRowProps}
            overscanCount={6}
            className="custom-scrollbar"
            style={{ height: '100%', width: '100%' }}
            onScroll={(event) => {
                latestScrollTopRef.current = event.currentTarget.scrollTop;
                if (commitTimerRef.current) {
                    clearTimeout(commitTimerRef.current);
                }
                commitTimerRef.current = setTimeout(() => {
                    onScrollTopChange(latestScrollTopRef.current);
                }, 120);
            }}
        />
    );
};

export default SearchResultsList;
