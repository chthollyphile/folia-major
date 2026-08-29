import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDownAZ, ArrowUpAZ, CalendarClock, Check, ListOrdered, Type } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LocalSongFolderSortDirection, LocalSongFolderSortField } from '../../utils/localSongSorting';

// src/components/shared/LocalTrackSortMenu.tsx
// Compact sort controls used by the local folder track list.

const FIELD_ICONS: Record<LocalSongFolderSortField, React.ComponentType<{ size?: number }>> = {
    fileName: Type,
    fileLastModified: CalendarClock,
    albumTrack: ListOrdered,
};

type LocalTrackSortMenuProps = {
    field: LocalSongFolderSortField;
    onFieldChange: (field: LocalSongFolderSortField) => void;
};

export const LocalTrackSortMenu: React.FC<LocalTrackSortMenuProps> = ({ field, onFieldChange }) => {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const StrategyIcon = FIELD_ICONS[field] ?? Type;

    useEffect(() => {
        const closeOnOutsideClick = (event: MouseEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', closeOnOutsideClick);
        return () => document.removeEventListener('mousedown', closeOnOutsideClick);
    }, []);

    return (
        <div ref={containerRef} className="relative shrink-0">
            <button
                type="button"
                onClick={() => setIsOpen(current => !current)}
                aria-label={t('localMusic.sortSongs')}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                title={t('localMusic.sortSongs')}
                className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                    isOpen ? 'bg-black/10 dark:bg-white/15' : 'hover:bg-black/10 dark:hover:bg-white/10'
                }`}
            >
                <StrategyIcon size={16} />
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: -6, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.96 }}
                        transition={{ duration: 0.16, ease: 'easeOut' }}
                        role="menu"
                        className="absolute right-0 top-10 z-10 w-44 rounded-2xl border p-1.5 shadow-xl backdrop-blur-2xl theme-glass-panel"
                    >
                        <SortFieldButton
                            active={field === 'fileName'}
                            icon={<Type size={15} />}
                            label={t('localMusic.sortByFileName')}
                            onClick={() => onFieldChange('fileName')}
                        />
                        <SortFieldButton
                            active={field === 'fileLastModified'}
                            icon={<CalendarClock size={15} />}
                            label={t('localMusic.sortByModifiedDate')}
                            onClick={() => onFieldChange('fileLastModified')}
                        />
                        <SortFieldButton
                            active={field === 'albumTrack'}
                            icon={<ListOrdered size={15} />}
                            label={t('localMusic.sortByAlbumTrack')}
                            onClick={() => onFieldChange('albumTrack')}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export const LocalTrackSortDirectionButton: React.FC<{
    direction: LocalSongFolderSortDirection;
    onDirectionChange: (direction: LocalSongFolderSortDirection) => void;
}> = ({ direction, onDirectionChange }) => {
    const { t } = useTranslation();
    const DirectionIcon = direction === 'asc' ? ArrowDownAZ : ArrowUpAZ;
    const nextDirection = direction === 'asc' ? 'desc' : 'asc';

    return (
        <button
            type="button"
            onClick={() => onDirectionChange(nextDirection)}
            aria-label={t('localMusic.sortDirection')}
            title={t(direction === 'asc' ? 'localMusic.sortAscending' : 'localMusic.sortDescending')}
            className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-black/10 dark:hover:bg-white/10"
        >
            <DirectionIcon size={16} />
        </button>
    );
};

const SortFieldButton: React.FC<{
    active: boolean;
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
}> = ({ active, icon, label, onClick }) => (
    <button
        type="button"
        role="menuitemradio"
        aria-checked={active}
        onClick={onClick}
        aria-label={label}
        className={`relative flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition-colors ${
            active ? 'bg-black/10 dark:bg-white/10' : 'hover:bg-black/5 dark:hover:bg-white/5'
        }`}
    >
        <span className="opacity-65">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {active && <Check size={14} className="opacity-80" />}
    </button>
);
