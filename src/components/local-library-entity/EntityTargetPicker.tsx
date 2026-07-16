import { motion } from 'framer-motion';
import { ArrowRight, GitMerge, Scissors } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LocalLibraryEntity } from '../../types/localLibrary';

// src/components/local-library-entity/EntityTargetPicker.tsx

type EntityTargetPickerProps = {
    currentEntity: LocalLibraryEntity;
    targetEntity?: LocalLibraryEntity;
    suggestions: LocalLibraryEntity[];
    mode: 'merge' | 'move';
    mergeIntoCurrent: boolean;
    selectedSongCount: number;
    resultTheme: string;
    selectedTheme: string;
    onToggleMergeDirection: () => void;
    onSelect: (entity: LocalLibraryEntity) => void;
};

export const EntityTargetPicker = ({
    currentEntity,
    targetEntity,
    suggestions,
    mode,
    mergeIntoCurrent,
    selectedSongCount,
    resultTheme,
    selectedTheme,
    onToggleMergeDirection,
    onSelect,
}: EntityTargetPickerProps) => {
    const { t } = useTranslation();

    if (targetEntity && mode === 'move') {
        return (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`mt-5 flex items-center gap-3 rounded-xl border px-5 py-4 text-sm ${selectedTheme}`}>
                <Scissors size={18} className="shrink-0 text-blue-500" />
                <span className="min-w-0 flex-1 font-medium">
                    {t('localMusic.moveMembersPreview', { count: selectedSongCount })}
                </span>
                <ArrowRight size={16} className="shrink-0 opacity-50" />
                <span className="max-w-[50%] truncate text-base font-bold" title={targetEntity.displayName}>
                    {targetEntity.displayName}
                </span>
            </motion.div>
        );
    }

    if (targetEntity) {
        return (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`mt-5 flex items-center gap-2 rounded-xl border px-5 py-4 text-sm ${selectedTheme}`}>
                <GitMerge size={18} className="mr-2 shrink-0 text-blue-500 opacity-60" />
                <div title={currentEntity.displayName} className={`min-w-0 flex-1 truncate text-right transition-all duration-300 ${mergeIntoCurrent ? 'text-lg font-bold' : 'font-medium opacity-50 line-through decoration-2'}`}>
                    {currentEntity.displayName}
                </div>
                <motion.button
                    whileTap={{ scale: 0.9 }}
                    animate={{ rotate: mergeIntoCurrent ? 180 : 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    type="button"
                    onClick={onToggleMergeDirection}
                    className="mx-2 flex shrink-0 items-center justify-center rounded-full p-2 text-blue-500 transition-colors hover:bg-blue-500/20 active:bg-blue-500/30"
                    title={t('localMusic.switchMergeDirection')}
                >
                    <ArrowRight size={18} />
                </motion.button>
                <div title={targetEntity.displayName} className={`min-w-0 flex-1 truncate transition-all duration-300 ${mergeIntoCurrent ? 'font-medium opacity-50 line-through decoration-2' : 'text-lg font-bold'}`}>
                    {targetEntity.displayName}
                </div>
            </motion.div>
        );
    }

    if (suggestions.length === 0) return null;
    return (
        <motion.div className="mt-5 space-y-2">
            {suggestions.map(candidate => (
                <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    key={candidate.id}
                    type="button"
                    onClick={() => onSelect(candidate)}
                    className={`flex w-full items-center gap-4 rounded-xl border px-5 py-4 text-left text-sm transition-colors ${resultTheme}`}
                >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-blue-500">
                        <GitMerge size={14} />
                    </div>
                    <span className="min-w-0 flex-1 truncate font-semibold">{candidate.displayName}</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider opacity-40">
                        {t(mode === 'move' ? 'localMusic.selectAsSplitTarget' : 'localMusic.selectForMerge')}
                    </span>
                </motion.button>
            ))}
        </motion.div>
    );
};
