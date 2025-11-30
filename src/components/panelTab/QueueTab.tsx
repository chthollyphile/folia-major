import React from 'react';
import { motion } from 'framer-motion';
import { List, useListRef, type ListImperativeAPI } from 'react-window';
import { SongResult } from '../../types';

interface QueueTabProps {
    playQueue: SongResult[];
    currentSong: SongResult | null;
    onPlaySong: (song: SongResult, queue: SongResult[]) => void;
    queueScrollRef: React.RefObject<HTMLDivElement>;
    shouldScrollToCurrent?: boolean;
}

const QueueTab: React.FC<QueueTabProps> = ({
    playQueue,
    currentSong,
    onPlaySong,
    queueScrollRef,
    shouldScrollToCurrent = false,
}) => {
    const ITEM_HEIGHT = 50;
    const CONTAINER_HEIGHT = 200;
    const listRef = useListRef(null);
    const isInitialMountRef = React.useRef(true);
    const lastScrolledIndexRef = React.useRef<number>(-1);
    const wasOpenRef = React.useRef(false);

    // Reset initial mount state when panel is opened
    React.useEffect(() => {
        if (shouldScrollToCurrent && !wasOpenRef.current) {
            isInitialMountRef.current = true;
            wasOpenRef.current = true;
        } else if (!shouldScrollToCurrent) {
            wasOpenRef.current = false;
        }
    }, [shouldScrollToCurrent]);

    // Auto-scroll to current song
    React.useEffect(() => {
        if (shouldScrollToCurrent && currentSong && listRef.current) {
            const currentIndex = playQueue.findIndex(s => s.id === currentSong.id);
            if (currentIndex >= 0) {
                const isInitialMount = isInitialMountRef.current;
                const songChanged = lastScrolledIndexRef.current !== currentIndex && lastScrolledIndexRef.current !== -1;
                
                const behavior = (isInitialMount || !songChanged) ? 'instant' : 'smooth';
                const delay = isInitialMount ? 0 : 50;
                
                setTimeout(() => {
                    if (listRef.current) {
                        listRef.current.scrollToRow({
                            index: currentIndex,
                            align: 'center',
                            behavior: behavior as 'instant' | 'smooth'
                        });
                        lastScrolledIndexRef.current = currentIndex;
                        isInitialMountRef.current = false;
                    }
                }, delay);
            }
        }
    }, [shouldScrollToCurrent, currentSong?.id, playQueue, listRef]);

    // Row component for rendering each item
    const RowComponent = React.useCallback(({ index, style, ariaAttributes }: { 
        index: number; 
        style: React.CSSProperties;
        ariaAttributes: { "aria-posinset": number; "aria-setsize": number; role: "listitem" };
    }) => {
        const song = playQueue[index];
        const isActive = currentSong?.id === song.id;
        
        return (
            <div
                style={style}
                onClick={() => onPlaySong(song, playQueue)}
                data-active={isActive}
                {...ariaAttributes}
                className={`flex items-center gap-3 px-2 py-1 rounded-lg cursor-pointer transition-colors
                    ${isActive ? 'bg-white/20' : 'hover:bg-white/5'}`}
            >
                <div className={`w-1 h-6 rounded-full ${isActive ? 'bg-white' : 'bg-transparent'}`} />
                <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate">{song.name}</div>
                    <div className="text-[10px] opacity-40 truncate">{song.ar?.map(a => a.name).join(', ')}</div>
                </div>
            </div>
        );
    }, [playQueue, currentSong, onPlaySong]);

    if (playQueue.length === 0) {
        return (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col h-full max-h-[200px]">
                <div className="flex items-center justify-center h-full text-xs opacity-40">
                    播放列表为空
                </div>
            </motion.div>
        );
    }

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col h-full max-h-[200px]">
            <div
                ref={queueScrollRef}
                className="flex-1 -mx-2 px-2"
            >
                <List
                    listRef={listRef}
                    rowCount={playQueue.length}
                    rowHeight={ITEM_HEIGHT}
                    rowComponent={RowComponent}
                    rowProps={{}}
                    overscanCount={5}
                    className="custom-scrollbar"
                    style={{ height: CONTAINER_HEIGHT, width: '100%' }}
                />
            </div>
        </motion.div>
    );
};

export default QueueTab;

