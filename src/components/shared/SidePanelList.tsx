import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Play, Plus } from 'lucide-react';
import { List as VirtualList } from 'react-window';
import { useTranslation } from 'react-i18next';
import { getSizedCoverUrl } from '../../utils/coverUrl';

export interface SidePanelListProps<T> {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    items: T[];
    renderItem: (item: T, index: number, style: React.CSSProperties) => React.ReactNode;
    itemHeight: number;
    isDaylight: boolean;
    focusedIndex?: number;
}

const RowComponent = ({ index, style, items, renderItem }: any): React.ReactElement => {
    return <>{renderItem(items[index], index, style)}</>;
};

export function SidePanelList<T>({
    isOpen,
    onClose,
    title,
    items,
    renderItem,
    itemHeight,
    isDaylight,
    focusedIndex,
}: SidePanelListProps<T>) {
    const { t } = useTranslation();
    const [listHeight, setListHeight] = useState(400);
    const listContainerRef = useRef<HTMLDivElement>(null);
    const virtualListRef = useRef<any>(null);

    const rowProps = React.useMemo(() => ({ items, renderItem }), [items, renderItem]);

    // Measure list container height for react-window
    useEffect(() => {
        if (isOpen && listContainerRef.current) {
            const el = listContainerRef.current;
            setListHeight(el.clientHeight);
            const observer = new ResizeObserver(() => {
                setListHeight(el.clientHeight);
            });
            observer.observe(el);
            return () => observer.disconnect();
        }
    }, [isOpen]);

    const lastScrollTargetRef = useRef<number | null>(null);

    // Scroll to focused index when opened or focused index changes
    useEffect(() => {
        if (isOpen && focusedIndex !== undefined && virtualListRef.current) {
            // Use a small timeout to ensure the list has rendered first
                const isInitialOpen = lastScrollTargetRef.current === null;
                const delay = isInitialOpen ? 50 : 350; // Debounce subsequent scroll updates
                
                const timer = setTimeout(() => {
                    const list = virtualListRef.current;
                    if (!list) return;
    
                    // If opening panel for the first time
                    if (isInitialOpen) {
                        // Start from nearby (e.g. 8 items above) to create a short smooth scroll effect
                        const jumpIndex = Math.max(0, focusedIndex - 8);
                        list.scrollToRow({ index: jumpIndex, align: 'start', behavior: 'auto' });
                        
                        setTimeout(() => {
                            list.scrollToRow({ index: focusedIndex, align: 'center', behavior: 'smooth' });
                        }, 50);
                    } else {
                        // If already open, just smoothly scroll to the target directly
                        list.scrollToRow({ index: focusedIndex, align: 'center', behavior: 'smooth' });
                    }
                    
                    lastScrollTargetRef.current = focusedIndex;
                }, delay);
                return () => clearTimeout(timer);
            } else if (!isOpen) {
                lastScrollTargetRef.current = null;
            }
    }, [isOpen, focusedIndex]);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0, x: 60, scale: 0.95 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, x: 60, scale: 0.95 }}
                    transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute right-6 top-24 bottom-28 sm:bottom-6 w-80 max-w-[calc(100vw-3rem)] rounded-3xl z-[80] flex flex-col p-6 shadow-2xl border backdrop-blur-2xl pointer-events-auto theme-glass-panel"
                    style={{
                        boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.2)',
                        color: 'var(--text-primary)'
                    }}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between mb-4 shrink-0">
                        <h3 className="font-bold text-lg tracking-tight truncate pr-2">
                            {title}
                        </h3>
                        <button
                            onClick={onClose}
                            className="p-1.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors shrink-0"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    {/* List Area */}
                    <div ref={listContainerRef} className="flex-1 overflow-hidden relative rounded-xl">
                        {items.length === 0 ? (
                            <div className="absolute inset-0 flex items-center justify-center opacity-50 text-sm">
                                {t('home.loadingLibrary') || 'No items'}
                            </div>
                        ) : (
                            <VirtualList
                                listRef={virtualListRef}
                                style={{ height: listHeight, width: '100%' }}
                                rowCount={items.length}
                                rowHeight={itemHeight}
                                rowProps={rowProps}
                                rowComponent={RowComponent}
                                className="overflow-x-hidden custom-scrollbar"
                            />
                        )}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

// Reusable list item for tracks
export const TrackListItem = React.memo<{
    track: any;
    index: number;
    style: React.CSSProperties;
    onPlay: () => void;
    onAddToQueue?: () => void;
    isUnavailable?: boolean;
    isActive?: boolean;
}>(({ track, index, style, onPlay, onAddToQueue, isUnavailable, isActive }) => {
    const { t } = useTranslation();
    const coverUrl = track.al?.picUrl || track.album?.picUrl || '';
    const artistName = track.ar?.[0]?.name || track.artists?.[0]?.name || 'Unknown Artist';
    
    return (
        <div 
            style={style} 
            className="px-2 py-1"
        >
            <div 
                onClick={isUnavailable ? undefined : onPlay}
                className={`flex items-center gap-3 p-2 rounded-lg transition-colors w-full h-full ${
                    isUnavailable 
                        ? 'opacity-40 cursor-not-allowed' 
                        : isActive
                            ? 'bg-black/10 dark:bg-white/10 cursor-pointer group'
                            : 'hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer group'
                }`}
            >
                <div className="relative w-10 h-10 shrink-0 rounded overflow-hidden bg-zinc-200 dark:bg-zinc-800">
                    {coverUrl && (
                        <img 
                            src={getSizedCoverUrl(coverUrl, 50)} 
                            alt={track.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                        />
                    )}
                    {!isUnavailable && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <Play size={16} className="text-white fill-white ml-0.5" />
                        </div>
                    )}
                </div>
                <div className="flex flex-col min-w-0 flex-1 justify-center">
                    <div className="text-sm font-semibold truncate leading-tight">{track.name}</div>
                    <div className="text-[10px] opacity-60 truncate leading-tight mt-0.5">{artistName}</div>
                </div>
                {!isUnavailable && onAddToQueue && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onAddToQueue();
                        }}
                        className="p-2 ml-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                        title={t('navidrome.addToQueue')}
                        style={{ color: 'var(--text-secondary)' }}
                    >
                        <Plus size={16} />
                    </button>
                )}
            </div>
        </div>
    );
});

// Reusable list item for collections
export const CollectionListItem = React.memo<{
    item: any;
    index: number;
    style: React.CSSProperties;
    onClick: () => void;
    isActive?: boolean;
}>(({ item, index, style, onClick, isActive }) => {
    return (
        <div 
            style={style} 
            className="px-2 py-1"
        >
            <div 
                onClick={onClick}
                className={`flex items-center gap-3 p-2 rounded-lg transition-colors w-full h-full ${
                    isActive
                        ? 'bg-black/10 dark:bg-white/10 cursor-pointer group'
                        : 'hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer group'
                }`}
            >
                <div className="w-10 h-10 shrink-0 rounded overflow-hidden bg-zinc-200 dark:bg-zinc-800 relative">
                    {item.coverUrl && (
                        <img 
                            src={item.coverUrl} 
                            alt={item.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                        />
                    )}
                </div>
                <div className="flex flex-col min-w-0 flex-1 justify-center">
                    <div className="text-sm font-semibold truncate leading-tight">{item.name}</div>
                    {item.description && (
                        <div className="text-[10px] opacity-60 truncate leading-tight mt-0.5">{item.description}</div>
                    )}
                </div>
            </div>
        </div>
    );
});
