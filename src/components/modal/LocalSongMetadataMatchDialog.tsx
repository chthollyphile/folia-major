import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, FileAudio, Loader2, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LocalSong } from '../../types';
import type { LocalLibraryAssignment } from '../../types/localLibrary';
import { createSafeObjectUrl, isBlob } from '../../utils/blobGuards';
import { applyOnlineMetadataCandidate, useImportedSnapshotForLocalSong } from '../../services/localSongMetadataMatchService';
import {
    buildLocalSongMetadataSearchQuery,
    buildLocalSongMetadataSearchTarget,
    searchOnlineMetadata,
    type OnlineMetadataCandidate,
    type OnlineMetadataSource,
} from '../../services/onlineMetadataSearchService';
import { DurationMatchBadge } from './DurationMatchBadge';

// src/components/modal/LocalSongMetadataMatchDialog.tsx
// Lets the user search one provider and independently choose its metadata bundle and cover.

interface LocalSongMetadataMatchDialogProps {
    song: LocalSong;
    assignment?: LocalLibraryAssignment;
    isDaylight: boolean;
    onClose: () => void;
    onChanged: () => Promise<void>;
}

export const LocalSongMetadataMatchDialog = ({ song, assignment, isDaylight, onClose, onChanged }: LocalSongMetadataMatchDialogProps) => {
    const { t } = useTranslation();
    const [source, setSource] = useState<OnlineMetadataSource>('netease');
    const [query, setQuery] = useState(() => buildLocalSongMetadataSearchQuery(song));
    const [results, setResults] = useState<OnlineMetadataCandidate[]>([]);
    const [selected, setSelected] = useState<OnlineMetadataCandidate | null>(null);
    const [searching, setSearching] = useState(false);
    const [applying, setApplying] = useState(false);
    const [restoringLocalInfo, setRestoringLocalInfo] = useState(false);
    const [useOnlineMetadata, setUseOnlineMetadata] = useState(song.titleOrigin !== 'import');
    const [useOnlineCover, setUseOnlineCover] = useState(song.useOnlineCover ?? !isBlob(song.embeddedCover));
    const [embeddedCoverUrl, setEmbeddedCoverUrl] = useState<string | null>(null);
    const requestIdRef = useRef(0);
    const target = useMemo(() => buildLocalSongMetadataSearchTarget(song), [song]);
    const currentTitle = song.title;
    const currentArtist = (song.titleOrigin !== 'import'
        ? song.onlineMetadata?.artists.map(artist => artist.name).join(', ')
        : song.importedMetadata.artistNames.join(', ')) || t('localMusic.unknownArtist');
    const currentAlbum = (song.titleOrigin !== 'import'
        ? song.onlineMetadata?.album?.name
        : song.importedMetadata.albumName) || t('localMusic.unknownAlbum');
    const currentCoverUrl = song.useOnlineCover && song.onlineMetadata?.coverUrl
        ? song.onlineMetadata.coverUrl
        : embeddedCoverUrl;
    const selectedArtist = selected?.artists.map(artist => artist.name).join(', ') || '';
    const previewTitle = useOnlineMetadata && selected?.title ? selected.title : currentTitle;
    const previewArtist = useOnlineMetadata && selectedArtist ? selectedArtist : currentArtist;
    const previewAlbum = useOnlineMetadata && selected?.album?.name ? selected.album.name : currentAlbum;
    const previewCoverUrl = useOnlineCover && selected?.coverUrl ? selected.coverUrl : currentCoverUrl;

    useEffect(() => {
        if (!isBlob(song.embeddedCover)) {
            setEmbeddedCoverUrl(null);
            return;
        }
        const url = createSafeObjectUrl(song.embeddedCover);
        if (!url) return;
        setEmbeddedCoverUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [song.embeddedCover]);

    const search = async () => {
        const safeQuery = query.trim();
        if (!safeQuery) return;
        const requestId = ++requestIdRef.current;
        setSearching(true);
        setSelected(null);
        try {
            const next = await searchOnlineMetadata(source, safeQuery, target);
            if (requestId === requestIdRef.current) setResults(next);
        } catch (error) {
            console.error('[LocalMusic] Manual metadata search failed:', error);
            if (requestId === requestIdRef.current) setResults([]);
        } finally {
            if (requestId === requestIdRef.current) setSearching(false);
        }
    };
    const apply = async () => {
        if (!selected) return;
        const replacesProtectedArtist = selected.artists.length > 0 && ['manual', 'split'].includes(assignment?.artistOrigin || '');
        const replacesProtectedAlbum = Boolean(selected.album) && ['manual', 'split'].includes(assignment?.albumOrigin || '');
        if (useOnlineMetadata && (replacesProtectedArtist || replacesProtectedAlbum)
            && !window.confirm(t('localMusic.replaceProtectedEntityConfirm'))) return;
        setApplying(true);
        try {
            const applied = await applyOnlineMetadataCandidate(song, selected, {
                mode: 'manual',
                useOnlineMetadata,
                useOnlineCover,
            });
            await onChanged();
            if (applied.coverAttempted && !applied.coverCached) {
                window.alert(t('localMusic.coverCacheFailed'));
            }
            onClose();
        } catch (error) {
            console.error('[LocalMusic] Failed to apply manual metadata match:', error);
        } finally {
            setApplying(false);
        }
    };
    const useLocalInfo = async () => {
        setRestoringLocalInfo(true);
        try {
            await useImportedSnapshotForLocalSong(song.id);
            await onChanged();
            onClose();
        } catch (error) {
            console.error('[LocalMusic] Failed to restore imported snapshot:', error);
        } finally {
            setRestoringLocalInfo(false);
        }
    };
    const panelTheme = isDaylight ? 'border-black/10 bg-white text-zinc-900' : 'border-white/10 bg-zinc-950 text-white';

    return (
        <div data-folia-keyboard-window="true" className="fixed inset-0 z-[140] flex items-center justify-center bg-black/65 p-4 backdrop-blur-xl">
            <div role="dialog" aria-modal="true" className={`${panelTheme} flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border shadow-2xl`}>
                <header className="flex items-center justify-between border-b border-current/10 px-5 py-4">
                    <div className="min-w-0">
                        <h3 className="truncate text-lg font-bold">{t('localMusic.manualMetadataMatch')}</h3>
                        <p className="mt-1 truncate text-xs opacity-60">{song.title || song.importedMetadata.title}</p>
                        <div className="mt-1 flex min-w-0 items-center gap-2">
                            <span title={song.fileName} className="flex min-w-0 items-center gap-1 text-[11px] opacity-45">
                                <FileAudio size={12} className="shrink-0" />
                                <span className="shrink-0">{t('localMusic.filename')}:</span>
                                <span className="truncate">{song.fileName}</span>
                            </span>
                            {song.noAutoMatch && (
                                <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-500">
                                    {t('localMusic.localInfoBadge')}
                                </span>
                            )}
                        </div>
                    </div>
                    <button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-current/10"><X size={19} /></button>
                </header>
                <div className="flex min-h-0 flex-1 flex-col gap-4 p-5">
                    <div className="flex gap-2">
                        {(['netease', 'qq', 'kugou'] as const).map(item => (
                            <button key={item} type="button" onClick={() => { setSource(item); setResults([]); setSelected(null); }} className={`rounded-full px-4 py-2 text-xs font-bold ${source === item ? 'bg-blue-500 text-white' : 'bg-current/10'}`}>
                                {item === 'netease'
                                    ? t('localMusic.neteaseSource')
                                    : item === 'qq'
                                        ? t('localMusic.qqSource')
                                        : t('localMusic.kugouSource')}
                            </button>
                        ))}
                    </div>
                    <form onSubmit={event => { event.preventDefault(); void search(); }} className="flex gap-2">
                        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-current/10 px-3">
                            <Search size={15} className="opacity-45" />
                            <input value={query} onChange={event => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none" />
                        </label>
                        <button type="submit" disabled={searching || !query.trim()} className="rounded-xl bg-blue-500 px-4 text-sm font-bold text-white disabled:opacity-40">
                            {searching ? <Loader2 size={16} className="animate-spin" /> : t('localMusic.search')}
                        </button>
                    </form>
                    <div className="min-h-48 flex-1 space-y-2 overflow-y-auto custom-scrollbar">
                        {results.map(candidate => (
                            <button key={`${candidate.source}:${candidate.songId}`} type="button" onClick={() => { setSelected(candidate); if (!candidate.coverUrl) setUseOnlineCover(false); }} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${selected === candidate ? 'border-blue-500 bg-blue-500/10' : 'border-current/10 hover:bg-current/5'}`}>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-bold">{candidate.title}</span>
                                    <span className="block truncate text-xs opacity-55">{candidate.artists.map(artist => artist.name).join(', ')} · {candidate.album?.name || t('localMusic.unknownAlbum')}</span>
                                </span>
                                <span className="flex shrink-0 items-center gap-2">
                                    <DurationMatchBadge matched={candidate.durationMatched} />
                                    <span className="text-xs font-bold opacity-50">{candidate.score}%</span>
                                </span>
                                {selected === candidate && <Check size={17} className="text-blue-500" />}
                            </button>
                        ))}
                        {!searching && results.length === 0 && <div className="flex h-48 items-center justify-center text-sm opacity-40">{t('localMusic.enterMetadataSearch')}</div>}
                    </div>
                    {selected && (
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="rounded-xl border border-current/10 p-3">
                                <div className="mb-2 text-[11px] font-bold uppercase tracking-wider opacity-45">{t('localMusic.currentSongInfo')}</div>
                                <div className="flex gap-3">
                                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-current/10">
                                        {currentCoverUrl && <img src={currentCoverUrl} alt="" className="h-full w-full object-cover" />}
                                    </div>
                                    <div className="min-w-0 text-xs">
                                        <div className="truncate font-bold">{currentTitle}</div>
                                        <div className="truncate opacity-65">{currentArtist}</div>
                                        <div className="truncate opacity-45">{currentAlbum}</div>
                                    </div>
                                </div>
                            </div>
                            <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-3">
                                <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-blue-500">{t('localMusic.matchResultPreview')}</div>
                                <div className="flex gap-3">
                                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-current/10">
                                        {previewCoverUrl && <img src={previewCoverUrl} alt="" className="h-full w-full object-cover" />}
                                    </div>
                                    <div className="min-w-0 text-xs">
                                        <div className="truncate font-bold">{previewTitle}</div>
                                        <div className="truncate opacity-65">{previewArtist}</div>
                                        <div className="truncate opacity-45">{previewAlbum}</div>
                                    </div>
                                </div>
                            </div>
                            <button type="button" role="switch" aria-checked={useOnlineMetadata} onClick={() => setUseOnlineMetadata(value => !value)} className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left ${useOnlineMetadata ? 'border-blue-500 bg-blue-500/10' : 'border-current/10'}`}>
                                <span>
                                    <span className="block text-sm font-bold">{t('localMusic.useOnlineMetadataResult')}</span>
                                    <span className="block text-xs opacity-50">{t('localMusic.metadataBundleHint')}</span>
                                </span>
                                {useOnlineMetadata && <Check size={18} className="text-blue-500" />}
                            </button>
                            <button type="button" role="switch" aria-checked={useOnlineCover} disabled={!selected.coverUrl} onClick={() => setUseOnlineCover(value => !value)} className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left disabled:opacity-35 ${useOnlineCover ? 'border-blue-500 bg-blue-500/10' : 'border-current/10'}`}>
                                <span>
                                    <span className="block text-sm font-bold">{t('localMusic.useOnlineCoverResult')}</span>
                                    {!selected.coverUrl && <span className="block text-xs opacity-50">{t('localMusic.candidateHasNoCover')}</span>}
                                </span>
                                {useOnlineCover && selected.coverUrl && <Check size={18} className="text-blue-500" />}
                            </button>
                        </div>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <button type="button" disabled={applying || restoringLocalInfo} onClick={() => void useLocalInfo()} className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm font-bold text-amber-500 disabled:opacity-35">
                            {restoringLocalInfo && <Loader2 size={15} className="animate-spin" />}{t('localMusic.dontUseOnlineMetadata')}
                        </button>
                        <button type="button" disabled={!selected || applying || restoringLocalInfo} onClick={() => void apply()} className="flex items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-35">
                            {applying && <Loader2 size={15} className="animate-spin" />}{t('localMusic.applyMetadataMatch')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
