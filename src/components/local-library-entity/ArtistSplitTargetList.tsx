import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LocalLibrarySplitTarget } from '../../types/localLibrary';

// src/components/local-library-entity/ArtistSplitTargetList.tsx
// Shows every artist that selected songs will link to after a split.

type ArtistSplitTargetListProps = {
    targets: LocalLibrarySplitTarget[];
    selectedTheme: string;
    onRemove: (index: number) => void;
};

export const ArtistSplitTargetList = ({ targets, selectedTheme, onRemove }: ArtistSplitTargetListProps) => {
    const { t } = useTranslation();
    if (targets.length === 0) return null;

    return (
        <div className="mt-5">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider opacity-60">
                {t('localMusic.artistSplitTargets', { count: targets.length })}
            </div>
            <div className="flex flex-wrap gap-2">
                {targets.map((target, index) => (
                    <span
                        key={`${target.entityId || target.displayName}-${index}`}
                        className={`flex max-w-full items-center gap-2 rounded-full border py-1.5 pl-3 pr-1.5 text-sm font-semibold ${selectedTheme}`}
                    >
                        <span className="truncate">{target.displayName}</span>
                        <button
                            type="button"
                            onClick={() => onRemove(index)}
                            className="shrink-0 rounded-full p-1 transition-colors hover:bg-blue-500/20"
                            aria-label={t('localMusic.removeArtistSplitTarget', { name: target.displayName })}
                        >
                            <X size={14} />
                        </button>
                    </span>
                ))}
            </div>
        </div>
    );
};
