import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Check, FolderOpen, Loader2, TriangleAlert } from 'lucide-react';
import { useThemeSettingsStore } from '../../stores/useThemeSettingsStore';
import type { Theme } from '../../types';
import {
    closeLocalFolderAccessPrompt,
    reauthorizeFolder,
    useLocalFolderAccessStore,
    type LocalFolderAccessRow,
} from './localFolderAccessCheck';

// src/components/local-folder-access/LocalFolderAccessPrompt.tsx
// The last page of the start sequence, shown once when imported folders can no longer be reached
// (localFolderAccessCheck.ts): each folder is picked again in place, keeping its songs, playlists and lyrics.

export const LocalFolderAccessPrompt: React.FC<{ theme?: Theme | null }> = ({ theme }) => {
    const isOpen = useLocalFolderAccessStore(state => state.isOpen);
    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
                >
                    <PromptPanel theme={theme} />
                </motion.div>
            )}
        </AnimatePresence>
    );
};

const PromptPanel: React.FC<{ theme?: Theme | null }> = ({ theme }) => {
    const { t } = useTranslation();
    const rows = useLocalFolderAccessStore(state => state.rows);
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const busy = rows.some(row => row.result === 'scanning');
    const allRestored = rows.every(row => row.result === 'restored');

    const accentColor = theme?.accentColor || (isDaylight ? '#3b82f6' : '#60a5fa');
    const bgClass = isDaylight ? 'bg-white border-zinc-200' : 'bg-[#18181b] border-zinc-800';
    const textPrimary = isDaylight ? 'text-zinc-900' : 'text-zinc-50';
    const textSecondary = isDaylight ? 'text-zinc-500' : 'text-zinc-400';
    const rowClass = isDaylight ? 'bg-zinc-50 border-zinc-200' : 'bg-white/[0.03] border-zinc-800';
    const btnClass = isDaylight
        ? 'bg-gradient-to-r from-zinc-800 to-zinc-900 hover:from-zinc-700 hover:to-zinc-800 text-white shadow-xl shadow-zinc-900/10'
        : 'bg-gradient-to-r from-zinc-100 to-white hover:from-white hover:to-zinc-100 text-zinc-900 shadow-xl shadow-white/10';
    const secondaryBtnClass = isDaylight
        ? 'bg-zinc-100 hover:bg-zinc-200 text-zinc-700'
        : 'bg-white/[0.06] hover:bg-white/10 text-zinc-200';

    return (
        <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.5 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="local-folder-access-title"
            data-testid="local-folder-access-prompt"
            className={`${bgClass} border rounded-[2rem] max-w-lg w-full max-h-[85vh] p-8 shadow-2xl relative overflow-y-auto overflow-x-hidden hide-scrollbar`}
        >
            <div id="local-folder-access-title" className={`text-lg font-semibold ${textPrimary}`}>
                {t('localFolderAccess.title')}
            </div>
            <div className={`mt-2 text-sm leading-relaxed ${textSecondary}`}>
                {t('localFolderAccess.description')}
            </div>

            <ul className="mt-5 flex flex-col gap-2">
                {rows.map(row => (
                    <FolderRow
                        key={row.rootFolderName}
                        row={row}
                        disabled={busy}
                        rowClass={rowClass}
                        textPrimary={textPrimary}
                        textSecondary={textSecondary}
                        accentColor={accentColor}
                        secondaryBtnClass={secondaryBtnClass}
                    />
                ))}
            </ul>

            <div className={`mt-5 text-[11px] ${textSecondary}`}>
                {t('localFolderAccess.laterHint')}
            </div>

            <div className="mt-5 flex justify-end">
                <button
                    type="button"
                    data-testid="local-folder-access-close"
                    onClick={closeLocalFolderAccessPrompt}
                    className={`px-5 py-2.5 rounded-full text-sm font-medium transition-all disabled:opacity-50 ${allRestored ? btnClass : secondaryBtnClass}`}
                >
                    {t(allRestored ? 'localFolderAccess.done' : 'localFolderAccess.later')}
                </button>
            </div>
        </motion.div>
    );
};

const FolderRow: React.FC<{
    row: LocalFolderAccessRow;
    disabled: boolean;
    rowClass: string;
    textPrimary: string;
    textSecondary: string;
    accentColor: string;
    secondaryBtnClass: string;
}> = ({ row, disabled, rowClass, textPrimary, textSecondary, accentColor, secondaryBtnClass }) => {
    const { t } = useTranslation();
    const restored = row.result === 'restored';
    const statusText = row.result === null || row.result === 'cancelled'
        ? t('localFolderAccess.songCount', { count: row.songCount })
        : t(`localFolderAccess.result.${row.result}`);
    const warn = row.result === 'mismatch' || row.result === 'failed' || row.result === 'retry';

    return (
        <li className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${rowClass}`} data-folder={row.rootFolderName}>
            <FolderOpen className={`h-4 w-4 shrink-0 ${textSecondary}`} />
            <div className="min-w-0 flex-1">
                <div className={`truncate text-sm font-medium ${textPrimary}`}>{row.rootFolderName}</div>
                <div className={`mt-0.5 flex items-center gap-1 text-xs ${warn ? 'text-amber-500' : textSecondary}`}>
                    {warn && <TriangleAlert className="h-3 w-3" />}
                    {statusText}
                </div>
            </div>
            {restored ? (
                <Check className="h-5 w-5 shrink-0" style={{ color: accentColor }} aria-label={t('localFolderAccess.result.restored')} />
            ) : row.result === 'scanning' ? (
                <Loader2 className={`h-5 w-5 shrink-0 animate-spin ${textSecondary}`} />
            ) : (
                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => { void reauthorizeFolder(row.rootFolderName); }}
                    className={`shrink-0 px-4 py-2 rounded-full text-xs font-medium transition-all disabled:opacity-50 ${secondaryBtnClass}`}
                >
                    {t('localFolderAccess.pick')}
                </button>
            )}
        </li>
    );
};
