import { useMemo, useState } from 'react';
import { Tags, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LocalSong } from '../../types';
import type { LocalLibraryAssignment } from '../../types/localLibrary';
import { FolderAutoMatchEditor } from '../local-library-entity/FolderAutoMatchEditor';
import { LocalSongMetadataMatchDialog } from './LocalSongMetadataMatchDialog';

// src/components/modal/LocalFolderSongInfoPanel.tsx
// Hosts explicit folder-scoped automatic and per-song online matching workflows.

interface LocalFolderSongInfoPanelProps {
    folderName: string;
    songs: LocalSong[];
    assignments: LocalLibraryAssignment[];
    isDaylight: boolean;
    onClose: () => void;
    onChanged: () => Promise<void>;
}

export const LocalFolderSongInfoPanel = ({ folderName, songs, assignments, isDaylight, onClose, onChanged }: LocalFolderSongInfoPanelProps) => {
    const { t } = useTranslation();
    const [manualMatchSong, setManualMatchSong] = useState<LocalSong | null>(null);
    const assignmentBySongId = useMemo(() => new Map(assignments.map(item => [item.songId, item])), [assignments]);
    const panelTheme = isDaylight ? 'border-black/10 bg-white/90 text-zinc-900' : 'border-white/10 bg-zinc-950/90 text-white';

    return (
        <div data-folia-keyboard-window="true" className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-3 backdrop-blur-xl md:p-6">
            <div role="dialog" aria-modal="true" className={`${panelTheme} flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border shadow-2xl`}>
                <header className="flex items-center justify-between gap-4 border-b border-current/10 px-6 py-5">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] opacity-45"><Tags size={14} />{t('localMusic.organizeSongInfo')}</div>
                        <h2 className="mt-1 truncate text-xl font-bold">{folderName}</h2>
                        <p className="mt-1 text-xs opacity-50">{t('localMusic.folderSongInfoHint', { count: songs.length })}</p>
                    </div>
                    <button type="button" onClick={onClose} className="rounded-full p-2.5 hover:bg-current/10"><X size={21} /></button>
                </header>
                <main className="min-h-0 flex-1 overflow-y-auto p-6 custom-scrollbar">
                    <FolderAutoMatchEditor
                        songs={songs}
                        assignments={assignments}
                        isDaylight={isDaylight}
                        onManualMatch={setManualMatchSong}
                        onChanged={onChanged}
                    />
                </main>
            </div>
            {manualMatchSong && (
                <LocalSongMetadataMatchDialog
                    song={manualMatchSong}
                    assignment={assignmentBySongId.get(manualMatchSong.id)}
                    isDaylight={isDaylight}
                    onClose={() => setManualMatchSong(null)}
                    onChanged={onChanged}
                />
            )}
        </div>
    );
};
