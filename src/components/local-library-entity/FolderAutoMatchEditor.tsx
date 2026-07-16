import { useEffect, useMemo, useRef, useState } from 'react';
import { HardDrive, Loader2, Square, WandSparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LocalSong } from '../../types';
import type { LocalLibraryAssignment } from '../../types/localLibrary';
import { batchAutoMatchLocalSongMetadata, useImportedSnapshotForLocalSong } from '../../services/localSongMetadataMatchService';
import type { OnlineMetadataCandidate } from '../../services/onlineMetadataSearchService';
import { FolderSongPicker } from './FolderSongPicker';

// src/components/local-library-entity/FolderAutoMatchEditor.tsx
// Runs and reports the metadata-and-cover folder batch while keeping manual song matching available.

interface FolderAutoMatchEditorProps {
    songs: LocalSong[];
    assignments: LocalLibraryAssignment[];
    isDaylight: boolean;
    onManualMatch: (song: LocalSong) => void;
    onChanged: () => Promise<void>;
}

const formatMatchCandidate = (candidate: OnlineMetadataCandidate) => [
    candidate.title,
    candidate.artists.map(artist => artist.name).join(', '),
    candidate.album?.name,
].filter(Boolean).join(' · ');

export const FolderAutoMatchEditor = ({ songs, assignments, isDaylight, onManualMatch, onChanged }: FolderAutoMatchEditorProps) => {
    const { t } = useTranslation();
    const assignmentBySongId = useMemo(() => new Map(assignments.map(item => [item.songId, item])), [assignments]);
    const [selectedSongIds, setSelectedSongIds] = useState(() => new Set(songs
        .filter(song => {
            const assignment = assignmentBySongId.get(song.id);
            return !song.noAutoMatch && (!assignment?.artistEntityIds.length || !assignment.albumEntityId);
        })
        .map(song => song.id)));
    const [running, setRunning] = useState(false);
    const [restoringLocalInfo, setRestoringLocalInfo] = useState(false);
    const [completed, setCompleted] = useState(0);
    const [statusBySongId, setStatusBySongId] = useState(new Map<string, string>());
    const abortControllerRef = useRef<AbortController | null>(null);
    const selectAllRef = useRef<HTMLInputElement | null>(null);
    const eligibleSongs = useMemo(() => songs.filter(song => !song.noAutoMatch), [songs]);
    const selectedCount = eligibleSongs.reduce((count, song) => count + Number(selectedSongIds.has(song.id)), 0);
    const allSelected = eligibleSongs.length > 0 && selectedCount === eligibleSongs.length;
    const localInfoCount = songs.length - eligibleSongs.length;
    const busy = running || restoringLocalInfo;

    useEffect(() => {
        if (selectAllRef.current) {
            selectAllRef.current.indeterminate = selectedCount > 0 && !allSelected;
        }
    }, [allSelected, selectedCount]);

    useEffect(() => {
        const eligibleSongIds = new Set(eligibleSongs.map(song => song.id));
        setSelectedSongIds(current => new Set([...current].filter(songId => eligibleSongIds.has(songId))));
    }, [eligibleSongs]);

    const run = async () => {
        const selectedSongs = songs.filter(song => selectedSongIds.has(song.id));
        if (selectedSongs.length === 0) return;
        const controller = new AbortController();
        abortControllerRef.current = controller;
        setRunning(true);
        setCompleted(0);
        setStatusBySongId(new Map());
        try {
            await batchAutoMatchLocalSongMetadata(selectedSongs, {
                signal: controller.signal,
                concurrency: 2,
                onUpdate: update => {
                    setCompleted(value => value + 1);
                    const statusText = t(`localMusic.autoMatchStatus.${update.status}`);
                    const candidateText = update.candidate ? formatMatchCandidate(update.candidate) : '';
                    const displayText = update.status === 'matched'
                        ? candidateText || statusText
                        : update.status === 'matched-cover-failed' && candidateText
                            ? `${candidateText} · ${statusText}`
                            : statusText;
                    setStatusBySongId(current => new Map(current).set(update.songId, displayText));
                },
            });
            await onChanged();
        } finally {
            abortControllerRef.current = null;
            setRunning(false);
        }
    };

    const useLocalInfo = async () => {
        const songIds = eligibleSongs.filter(song => selectedSongIds.has(song.id)).map(song => song.id);
        if (songIds.length === 0) return;
        setRestoringLocalInfo(true);
        try {
            await Promise.all(songIds.map(useImportedSnapshotForLocalSong));
            const restoredIds = new Set(songIds);
            setSelectedSongIds(current => new Set([...current].filter(songId => !restoredIds.has(songId))));
            await onChanged();
        } catch (error) {
            console.error('[LocalMusic] Failed to restore imported snapshots:', error);
            window.alert(t('localMusic.entityOperationFailed'));
        } finally {
            setRestoringLocalInfo(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <div className="text-sm font-bold">{t('localMusic.batchMetadataMatch')}</div>
                    <div className="mt-1 text-xs opacity-55">{t('localMusic.batchMetadataMatchHint')}</div>
                </div>
                {running ? (
                    <button type="button" onClick={() => abortControllerRef.current?.abort()} className="flex items-center gap-2 rounded-xl bg-red-500/15 px-4 py-2 text-sm font-bold text-red-500">
                        <Square size={14} /> {t('localMusic.cancelMatch')} ({completed}/{selectedCount})
                    </button>
                ) : (
                    <div className="flex flex-wrap items-center gap-2">
                        <button type="button" disabled={selectedCount === 0 || busy} onClick={() => void useLocalInfo()} className="flex items-center gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-2 text-sm font-bold text-amber-500 disabled:opacity-35">
                            {restoringLocalInfo ? <Loader2 size={15} className="animate-spin" /> : <HardDrive size={15} />}
                            {t('localMusic.useLocalInfoForSelected', { count: selectedCount })}
                        </button>
                        <button type="button" disabled={selectedCount === 0 || busy} onClick={() => void run()} className="flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-35">
                            <WandSparkles size={15} /> {t('localMusic.startAutoMatch', { count: selectedCount })}
                        </button>
                    </div>
                )}
            </div>
            {running && (
                <div className="h-1.5 overflow-hidden rounded-full bg-current/10">
                    <div className="h-full rounded-full bg-blue-500 transition-[width]" style={{ width: `${selectedCount ? completed / selectedCount * 100 : 0}%` }} />
                </div>
            )}
            <label className="flex w-fit items-center gap-2 text-xs font-semibold">
                <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allSelected}
                    disabled={busy || eligibleSongs.length === 0}
                    onChange={() => setSelectedSongIds(allSelected
                        ? new Set()
                        : new Set(eligibleSongs.map(song => song.id)))}
                    className="h-4 w-4 cursor-pointer accent-blue-500 disabled:cursor-not-allowed"
                />
                <span>{t(allSelected ? 'localMusic.deselectAllSongs' : 'localMusic.selectAllSongs')}</span>
                <span className="opacity-45">({selectedCount}/{eligibleSongs.length})</span>
                {localInfoCount > 0 && <span className="text-amber-500/90">{t('localMusic.localInfoSkippedCount', { count: localInfoCount })}</span>}
            </label>
            <FolderSongPicker
                songs={songs}
                selectedSongIds={selectedSongIds}
                onToggle={songId => setSelectedSongIds(current => {
                    const next = new Set(current);
                    if (next.has(songId)) next.delete(songId); else next.add(songId);
                    return next;
                })}
                onManualMatch={onManualMatch}
                manualMatchLabel={t('localMusic.manualMetadataMatch')}
                statusBySongId={statusBySongId}
                disabled={busy}
                isDaylight={isDaylight}
            />
            {running && <div className="flex items-center justify-center gap-2 text-xs opacity-55"><Loader2 size={13} className="animate-spin" />{t('localMusic.matchingMetadata')}</div>}
        </div>
    );
};
