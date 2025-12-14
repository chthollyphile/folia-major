import React from 'react';
import { motion } from 'framer-motion';
import { List, useListRef, type ListImperativeAPI } from 'react-window';
import { Shuffle } from 'lucide-react';
import { SongResult } from '../../types';

interface QueueTabProps {
    playQueue: SongResult[];
    currentSong: SongResult | null;
    onPlaySong: (song: SongResult, queue: SongResult[]) => void;
    queueScrollRef: React.RefObject<HTMLDivElement>;
    shouldScrollToCurrent?: boolean;
    onShuffle?: () => void;
}

const QueueTab: React.FC<QueueTabProps> = ({
    playQueue,
    currentSong,
    onPlaySong,
    queueScrollRef,
    shouldScrollToCurrent = false,
    onShuffle
}) => {
    const ITEM_HEIGHT = 50;
    // Adjust container height calculation if needed, or rely on flex
    // previously CONTAINER_HEIGHT = 200 was passed to List. 
    // We should make List take available space.
    // However, react-window List needs explicit height.
    // The parent has max-h-[300px]. 
    // If we add a header, we need to subtract its height from the List height or use AutoSizer.
    // For simplicity given the constraints, let's try to fit it.
    // The parent is flex-col. 
    // Let's reduce List height slightly to accommodate header? 
    // Or better, use Autoizer? No, let's stick to simple fixed height for now but slightly reduced: 300 - 32 (header) = 268?
    // User asked for "about 5 songs height". 5 * 50 = 250.
    // Let's set CONTAINER_HEIGHT to 250.
    const CONTAINER_HEIGHT = 250;

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
        ariaAttributes: { "aria-posinset": number; "aria-setsize": number; role: "listitem"; };
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
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col h-full max-h-[300px]">
                <div className="flex items-center justify-center h-full text-xs opacity-40">
                    播放列表为空
                </div>
            </motion.div>
        );
    }

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col h-full max-h-[300px]">
            {/* Header */}
            <div className="flex items-center justify-between px-2 pb-2 shrink-0">
                <span className="text-xs font-medium opacity-60">
                    播放队列 ({playQueue.length})
                </span>
                {onShuffle && (
                    <button
                        onClick={onShuffle}
                        className="p-1.5 rounded-md hover:bg-white/10 transition-colors opacity-60 hover:opacity-100"
                        title="打乱队列"
                    >
                        <Shuffle size={14} />
                    </button>
                )}
            </div>

            <div
                ref={queueScrollRef}
                className="flex-1 -mx-2 px-2 overflow-hidden"
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

