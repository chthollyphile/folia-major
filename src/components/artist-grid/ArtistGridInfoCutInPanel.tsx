import { AnimatePresence, motion } from 'framer-motion';
import { Disc, Pencil, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// src/components/artist-grid/ArtistGridInfoCutInPanel.tsx
// Presents ArtistGrid metadata in the same left-side cut-in pattern used by GridView.

type ArtistGridInfoCutInPanelProps = {
    isOpen: boolean;
    artistName: string;
    coverUrl?: string;
    description?: string;
    musicSize?: number;
    albumSize?: number;
    entityId?: string;
    onClose: () => void;
    onEditEntity?: (entityId: string) => void;
};

export const ArtistGridInfoCutInPanel = ({
    isOpen,
    artistName,
    coverUrl,
    description,
    musicSize,
    albumSize,
    entityId,
    onClose,
    onEditEntity,
}: ArtistGridInfoCutInPanelProps) => {
    const { t } = useTranslation();
    const stats = [
        musicSize !== undefined ? `${musicSize} ${t('home.songs')}` : '',
        albumSize !== undefined ? `${albumSize} ${t('home.albums')}` : '',
    ].filter(Boolean).join(' • ');

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.aside
                    initial={{ opacity: 0, x: -60, scale: 0.95 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, x: -60, scale: 0.95 }}
                    transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute bottom-28 left-6 top-24 z-[80] flex w-80 flex-col overflow-y-auto rounded-3xl border p-6 shadow-2xl backdrop-blur-2xl pointer-events-auto theme-glass-panel sm:bottom-6"
                    style={{ boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.2)' }}
                >
                    <div className="mb-4 flex items-center justify-between gap-2">
                        <h3 className="min-w-0 flex-1 truncate text-lg font-bold">{artistName}</h3>
                        <button type="button" onClick={onClose} className="shrink-0 rounded-full p-1.5 hover:bg-black/10 dark:hover:bg-white/10" aria-label={t('ui.close')}>
                            <X size={18} />
                        </button>
                    </div>

                    <div className="relative mb-4 aspect-square w-full shrink-0 overflow-hidden rounded-2xl bg-zinc-800/20 shadow-lg">
                        {coverUrl ? (
                            <img src={coverUrl} alt={artistName} className="h-full w-full object-cover select-none pointer-events-none" />
                        ) : (
                            <Disc size={64} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-20" />
                        )}
                    </div>

                    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto text-left custom-scrollbar">
                        {stats && <div className="text-xs font-semibold opacity-55">{stats}</div>}
                        {description && <p className="whitespace-pre-wrap break-words text-xs leading-relaxed opacity-65">{description}</p>}
                    </div>

                    {entityId && onEditEntity && (
                        <div className="mt-4 border-t pt-4" style={{ borderTopColor: 'color-mix(in srgb, var(--text-primary) 12%, transparent)' }}>
                            <button
                                type="button"
                                onClick={() => onEditEntity(entityId)}
                                className="flex w-full items-center justify-center gap-1.5 rounded-full py-3 text-xs font-bold transition-transform hover:scale-102 active:scale-98"
                                style={{ backgroundColor: 'var(--text-primary)', color: 'var(--bg-color)' }}
                            >
                                <Pencil size={14} />
                                {t('localMusic.entityInfo', { kind: t('localMusic.artistLabel') })}
                            </button>
                        </div>
                    )}
                </motion.aside>
            )}
        </AnimatePresence>
    );
};
