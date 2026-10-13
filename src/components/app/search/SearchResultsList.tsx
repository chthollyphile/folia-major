import React, { useEffect, useMemo, useRef } from 'react';
import { List, useListRef } from 'react-window';
import type { UnifiedSong } from '../../../types';
import type { MediaId } from '../../../types/onlineMusic';
import SearchResultRow from './SearchResultRow';

// src/components/app/search/SearchResultsList.tsx

type SearchResultsListProps = {
    tracks: UnifiedSong[];
    scrollTop: number;
    /** 这批结果属于哪次搜索：卸载时只有 scope 没变，才敢把滚动位置交还给父组件。 */
    scrollScope: string;
    isDaylight: boolean;
    onScrollTopChange: (scrollTop: number) => void;
    onPlayTrack: (track: UnifiedSong) => void;
    onAddTrackToQueue: (track: UnifiedSong) => void;
    onOpenArtist: (track: UnifiedSong, artistName: string, artistId?: MediaId, entityId?: string) => void;
    onOpenAlbum: (track: UnifiedSong, albumName: string, albumId?: MediaId, entityId?: string) => void;
};

type RowProps = Omit<SearchResultsListProps, 'scrollTop' | 'scrollScope' | 'onScrollTopChange'>;

const Row = ({ index, style, tracks, ...props }: { index: number; style: React.CSSProperties } & RowProps) => (
    <SearchResultRow track={tracks[index]} style={style} {...props} />
);

const SearchResultsList: React.FC<SearchResultsListProps> = ({
    tracks,
    scrollTop,
    scrollScope,
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

    // 记的是挂载时那一批结果的 scope，不跟随后续变化：换搜索词就意味着记录失效，
    // 此时父组件刚把 scrollTop 归零，交还旧偏移会把它盖回去，新结果停在旧位置上看着像空列表。
    const mountedScopeRef = useRef(scrollScope);
    useEffect(() => () => {
        if (commitTimerRef.current) {
            clearTimeout(commitTimerRef.current);
        }
        if (mountedScopeRef.current === scrollScope) {
            onScrollTopChange(latestScrollTopRef.current);
        }
    }, [onScrollTopChange, scrollScope]);

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
