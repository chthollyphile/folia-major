import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Loader2, X, Music, Check, FileAudio } from 'lucide-react';
import { LocalSong, SongResult } from '../../types';
import { applyLocalSongMatchSelection } from '../../services/localSongMatchSelectionService';
import { buildLocalSongMetadataSearchTarget, normalizeLyricMatchMetadataCandidate } from '../../services/onlineMetadataSearchService';
import { formatSongName } from '../../utils/songNameFormatter';
import { useSettingsUiStore } from '../../stores/useSettingsUiStore';
import { calculateMatchScoreDetails } from '../../utils/lyrics/matchScore';
import { buildLyricSearchQuery } from '../../utils/lyrics/searchQuery';
import { fetchLyricsForMatchSource, LYRIC_MATCH_SOURCES, searchLyricsByMatchSource, sourceSupportsManualSearch } from '../../utils/lyrics/lyricMatchSources';
import { createSafeObjectUrl, isBlob } from '../../utils/blobGuards';
import { getLocalLibraryAssignment } from '../../services/localLibraryEntityRepository';
import {
    getLyricMatchSourceLabel,
    getMatchResultAlbumName,
    getMatchResultArtists,
    getMatchResultCoverUrl,
    sourceSupportsCover,
    type LyricMatchSource,
} from './lyricMatchResultHelpers';
import { LyricPreviewPanel } from './LyricPreviewPanel';
import { DurationMatchBadge } from './DurationMatchBadge';

interface LyricMatchModalProps {
    song: LocalSong;
    onClose: () => void;
    onMatch: () => void;
    isDaylight: boolean;
}

const LyricMatchModal: React.FC<LyricMatchModalProps> = ({ song, onClose, onMatch, isDaylight }) => {
    const { t } = useTranslation();

    // Dynamic theme classes
    const bgClass = isDaylight ? 'bg-white/90 border-white/20' : 'bg-zinc-900/95 border-white/10';
    const textPrimary = isDaylight ? 'text-zinc-900' : 'text-white';
    const textSecondary = isDaylight ? 'text-zinc-500' : 'text-zinc-400';
    const borderColor = isDaylight ? 'border-black/5' : 'border-white/10';
    const inputBg = isDaylight ? 'bg-black/5 focus:bg-black/10 border-black/10 focus:border-black/20' : 'bg-white/5 focus:bg-white/10 border-white/10 focus:border-white/20';
    const searchBtnBg = isDaylight ? 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-600' : 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-300';
    const resultItemBg = isDaylight ? 'bg-black/5 hover:bg-black/10 border-black/5' : 'bg-white/5 hover:bg-white/10 border-white/5';
    const resultItemSelected = isDaylight ? 'bg-blue-500/10 border-blue-500/30' : 'bg-blue-500/20 border-blue-500/50';
    const closeBtnHover = isDaylight ? 'hover:bg-zinc-200/50' : 'hover:bg-white/10';
    const cancelBtnBg = isDaylight ? 'bg-zinc-100/80 hover:bg-zinc-200' : 'bg-white/5 hover:bg-white/10';
    const noMatchBtnBg = isDaylight ? 'bg-red-500/5 hover:bg-red-500/10 border-red-500/10' : 'bg-red-500/10 hover:bg-red-500/20 border-red-500/20';
    const dotBase = isDaylight ? 'bg-zinc-300' : 'bg-zinc-600';
    const dotActive = isDaylight ? 'bg-blue-500' : 'bg-blue-400';

    // Search state
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<SongResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedResult, setSelectedResult] = useState<SongResult | null>(null);
    const [isMatching, setIsMatching] = useState(false);
    const searchRequestIdRef = useRef(0);

    const enableAlternativeLyricSources = useSettingsUiStore(state => state.enableAlternativeLyricSources);
    const [source, setSource] = useState<LyricMatchSource>('netease');

    // Online data toggle state (dots)
    const [lyricsSource, setLyricsSource] = useState<'local' | 'embedded' | 'online' | undefined>(song.lyricsSource || 'online');
    const [useOnlineCover, setUseOnlineCover] = useState(song.useOnlineCover ?? !isBlob(song.embeddedCover));
    const [useOnlineMetadata, setUseOnlineMetadata] = useState(song.titleOrigin !== 'import');

    // Derive song information for matching
    const songInfo = useMemo(() => {
        const title = song.title || song.fileName.replace(/\.(mp3|flac|m4a|wav|ogg|opus|aac)$/i, '');
        const artist = song.onlineMetadata?.artists.map(item => item.name).join(', ')
            || song.importedMetadata.artistNames.join(', ');
        const durationMs = song.duration || 0;
        const album = song.onlineMetadata?.album?.name || song.importedMetadata.albumName || '';
        return { title, artist, album, durationMs };
    }, [song]);

    // Selecting a result defaults lyrics to online while metadata remains an all-or-nothing bundle.
    useEffect(() => {
        if (selectedResult) {
            setLyricsSource('online');
        }
    }, [selectedResult]);

    // Derive preview cover URL with proper ObjectURL lifecycle management
    const [previewCoverUrl, setPreviewCoverUrl] = useState<string | null>(null);
    useEffect(() => {
        let objectUrl: string | null = null;

        if (!selectedResult) {
            // Show current state
            if (isBlob(song.embeddedCover)) {
                objectUrl = createSafeObjectUrl(song.embeddedCover);
                setPreviewCoverUrl(objectUrl);
            } else {
                setPreviewCoverUrl(song.useOnlineCover ? song.onlineMetadata?.coverUrl || null : null);
            }
        } else if (useOnlineCover) {
            const selectedCoverUrl = getMatchResultCoverUrl(selectedResult, source);
            setPreviewCoverUrl(selectedCoverUrl || song.onlineMetadata?.coverUrl || null);
        } else {
            // Local cover
            if (isBlob(song.embeddedCover)) {
                objectUrl = createSafeObjectUrl(song.embeddedCover);
                setPreviewCoverUrl(objectUrl);
            } else {
                setPreviewCoverUrl(null);
            }
        }

        return () => {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [selectedResult, useOnlineCover, song, source]);

    // Derive lyrics source label
    const lyricsSourceLabel = useMemo(() => {
        if (lyricsSource === 'online') {
            const src = selectedResult ? source : (song.matchedLyricsSource || 'netease');
            const platform = selectedResult?.amllDbPlatform ?? song.matchedLyricsProviderPlatform;
            return getLyricMatchSourceLabel(src, platform);
        }
        if (lyricsSource === 'embedded') return t('localMusic.statusEmbedded');
        if (lyricsSource === 'local') return t('localMusic.statusLocal');
        // Default: show what would be selected by priority
        if (song.hasLocalLyrics) return t('localMusic.statusLocal');
        if (song.hasEmbeddedLyrics) return t('localMusic.statusEmbedded');
        return t('localMusic.statusNone');
    }, [lyricsSource, song, t, source, selectedResult]);

    const runSearch = async (query: string, activeSource: LyricMatchSource) => {
        const q = sourceSupportsManualSearch(activeSource)
            ? query.trim()
            : buildLyricSearchQuery(songInfo.title, songInfo.artist, songInfo.album || '');
        if (!q.trim()) return;

        const requestId = ++searchRequestIdRef.current;
        setIsSearching(true);
        setSearchResults([]);
        setSelectedResult(null);

        try {
            const results = await searchLyricsByMatchSource(activeSource, q, songInfo);
            if (requestId !== searchRequestIdRef.current) return;

            setSearchResults(results);
        } catch (error) {
            console.error('Search failed:', error);
        } finally {
            if (requestId === searchRequestIdRef.current) {
                setIsSearching(false);
            }
        }
    };

    // Initialize the query only when the target song changes.
    useEffect(() => {
        const title = song.title || song.fileName.replace(/\.(mp3|flac|m4a|wav|ogg|opus|aac)$/i, '');
        const initialQuery = buildLyricSearchQuery(
            title,
            song.onlineMetadata?.artists.map(item => item.name).join(', ') || song.importedMetadata.artistNames.join(', '),
            song.onlineMetadata?.album?.name || song.importedMetadata.albumName || '',
        );
        setSearchQuery(initialQuery);
        void runSearch(initialQuery, source);
    }, [song]);

    // Source changes should reuse the user's current query instead of resetting it.
    useEffect(() => {
        void runSearch(searchQuery, source);
    }, [source]);

    useEffect(() => {
        if (!enableAlternativeLyricSources && source !== 'netease') {
            setSource('netease');
        }
    }, [enableAlternativeLyricSources, source]);

    const handleSearch = async (query?: string) => {
        await runSearch(query || searchQuery, source);
    };

    const handleConfirm = async () => {
        if (!selectedResult) return;

        setIsMatching(true);
        try {
            const candidate = normalizeLyricMatchMetadataCandidate(
                source,
                selectedResult,
                buildLocalSongMetadataSearchTarget(song),
            );
            if (useOnlineMetadata) {
                const assignment = await getLocalLibraryAssignment(song.id);
                const protectedOrigins = new Set(['manual', 'split']);
                const replacesProtectedArtist = Boolean(
                    candidate.artists.length
                    && assignment
                    && protectedOrigins.has(assignment.artistOrigin),
                );
                const replacesProtectedAlbum = Boolean(
                    candidate.album?.name
                    && assignment
                    && protectedOrigins.has(assignment.albumOrigin),
                );
                if ((replacesProtectedArtist || replacesProtectedAlbum)
                    && !window.confirm(t('localMusic.replaceProtectedEntityConfirm'))) return;
            }
            let processed = null;
            let lyricsFailed = false;
            if (lyricsSource === 'online') {
                try {
                    processed = await fetchLyricsForMatchSource(source, selectedResult);
                    lyricsFailed = !processed?.lyrics;
                } catch (error) {
                    console.warn('[LocalMusic] Lyrics failed while applying metadata selection:', error);
                    lyricsFailed = true;
                }
            }
            const applied = await applyLocalSongMatchSelection({
                songId: song.id,
                candidate,
                metadata: useOnlineMetadata ? 'online' : 'imported',
                cover: useOnlineCover && candidate.coverUrl ? 'online' : 'embedded',
                lyrics: lyricsSource || 'automatic',
                onlineLyrics: processed?.lyrics ? {
                    lyrics: processed.lyrics,
                    songId: selectedResult.id,
                    source,
                    providerPlatform: processed.matchedLyricsProviderPlatform,
                    isPureMusic: processed.isPureMusic,
                } : undefined,
                lyricsFailed,
            });
            onMatch();
            if (applied.partialLyricsFailure) alert(t('localMusic.lyricsNotAppliedOtherSaved'));
            else if (applied.coverAttempted && !applied.coverCached) alert(t('localMusic.coverCacheFailed'));
        } catch (error) {
            console.error('Failed to match or save song:', error);
            alert(t('localMusic.matchFailed'));
        } finally {
            setIsMatching(false);
        }
    };

    const handleNoMatch = async () => {
        try {
            await applyLocalSongMatchSelection({
                songId: song.id,
                metadata: 'imported',
                cover: 'embedded',
                lyrics: 'automatic',
                setNoAutoMatch: true,
            });
            onMatch(); // Trigger refresh so the change applies
        } catch (error) {
            console.error('Failed to save song:', error);
            alert(t('localMusic.matchFailed'));
        }
    };

    const previewTitle = useOnlineMetadata && selectedResult
        ? formatSongName(selectedResult)
        : song.importedMetadata.title;
    const previewArtist = useOnlineMetadata && selectedResult
        ? getMatchResultArtists(selectedResult)
        : song.importedMetadata.artistNames.join(', ');
    const previewAlbum = useOnlineMetadata && selectedResult
        ? getMatchResultAlbumName(selectedResult)
        : song.importedMetadata.albumName || '';


    return (
        <div data-folia-keyboard-window="true" className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xl flex items-center justify-center p-6">
            <div className={`${bgClass} border rounded-2xl max-w-5xl w-full max-h-[80vh] flex flex-col shadow-2xl backdrop-blur-md`}>
                {/* Header */}
                <div className={`px-6 py-4 border-b ${borderColor} flex items-center justify-between`}>
                    <div className="min-w-0">
                        <h2 className={`text-lg font-bold ${textPrimary}`}>{t('localMusic.matchLyrics')}</h2>
                        <p className={`mt-1 truncate text-xs ${textSecondary}`}>{song.title || song.importedMetadata.title}</p>
                        <div title={song.fileName} className={`mt-1 flex min-w-0 items-center gap-1 text-[11px] opacity-55 ${textSecondary}`}>
                            <FileAudio size={12} className="shrink-0" />
                            <span className="shrink-0">{t('localMusic.filename')}:</span>
                            <span className="truncate">{song.fileName}</span>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className={`p-2 ${closeBtnHover} rounded-lg transition-colors ${textPrimary}`}
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body: Two-panel layout */}
                <div className="flex-1 flex min-h-0 overflow-hidden">
                    {/* LEFT PANEL: Search + Results (wider) */}
                    <div className={`w-[62%] flex flex-col border-r ${borderColor}`}>
                        {/* Search Bar */}
                        <div className="p-4">
                            <div className={`flex border-b ${borderColor} pb-2 mb-3.5 gap-4`}>
                                {LYRIC_MATCH_SOURCES
                                    .filter(id => id === 'netease' || enableAlternativeLyricSources)
                                    .map(id => ({ id, label: getLyricMatchSourceLabel(id) }))
                                    .map(t => {
                                    const isSelected = source === t.id;
                                    const activeTabClass = isSelected
                                        ? isDaylight
                                            ? 'border-blue-500 text-blue-600 font-semibold'
                                            : 'border-blue-400 text-blue-300 font-semibold'
                                        : 'border-transparent text-zinc-400 hover:text-zinc-200';
                                    return (
                                        <button
                                            key={t.id}
                                            type="button"
                                            onClick={() => setSource(t.id as any)}
                                            className={`pb-2 border-b-2 text-sm transition-all px-1 cursor-pointer ${activeTabClass}`}
                                        >
                                            {t.label}
                                        </button>
                                    );
                                })}
                            </div>
                            {sourceSupportsManualSearch(source) && (
                                <form
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        handleSearch();
                                    }}
                                    className="flex gap-3"
                                >
                                    <div className={`flex-1 flex items-center gap-3 rounded-2xl border px-4 py-3 ${inputBg}`}>
                                        <Search size={18} className={`opacity-40 ${textSecondary}`} />
                                        <input
                                            type="text"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            placeholder={t('localMusic.searchForSong')}
                                            className={`flex-1 bg-transparent outline-none text-sm ${textPrimary}`}
                                            autoFocus
                                        />
                                    </div>
                                    <button
                                        type="submit"
                                        disabled={isSearching}
                                        className={`px-4 rounded-2xl text-sm font-medium transition-colors ${searchBtnBg}`}
                                    >
                                        {isSearching ? <Loader2 size={16} className="animate-spin" /> : t('localMusic.search')}
                                    </button>
                                </form>
                            )}
                        </div>

                        {/* Results List */}
                        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-4">
                            {isSearching ? (
                                <div className="flex justify-center items-center h-40">
                                    <Loader2 className="animate-spin opacity-50" size={28} />
                                </div>
                            ) : searchResults.length === 0 ? (
                                <div className={`flex flex-col items-center justify-center h-40 opacity-50 ${textSecondary}`}>
                                    <Music size={40} className="mb-2" />
                                    <p className="text-sm">{t('localMusic.noResults')}</p>
                                </div>
                            ) : (
                                <div className="space-y-1.5">
                                    {searchResults.map((result) => {
                                        const resultKey = `${source}-${result.amllDbPlatform ?? 'base'}-${result.id}`;
                                        const selectedKey = selectedResult ? `${source}-${selectedResult.amllDbPlatform ?? 'base'}-${selectedResult.id}` : null;
                                        const resultCoverUrl = getMatchResultCoverUrl(result, source);
                                        const resultArtists = getMatchResultArtists(result);
                                        const resultAlbum = getMatchResultAlbumName(result);
                                        const matchDetails = calculateMatchScoreDetails(songInfo, result);
                                        return (
                                            <div
                                                key={resultKey}
                                                onClick={() => setSelectedResult(result)}
                                                className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all border ${selectedKey === resultKey
                                                    ? resultItemSelected
                                                    : resultItemBg
                                                    }`}
                                            >
                                                <div className="w-10 h-10 rounded-lg overflow-hidden bg-zinc-800 flex-shrink-0">
                                                    {resultCoverUrl ? (
                                                        <img
                                                            src={resultCoverUrl}
                                                            alt={result.name}
                                                            className="w-full h-full object-cover"
                                                        />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center">
                                                            <Music size={16} className="opacity-20" />
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-sm font-semibold truncate ${textPrimary}`}>{formatSongName(result)}</span>
                                                        <span className="text-[10px] px-1.5 py-0.2 bg-blue-500/10 text-blue-400 rounded-md font-mono shrink-0">
                                                            {matchDetails.score}%
                                                        </span>
                                                        <DurationMatchBadge matched={matchDetails.durationMatched} />
                                                    </div>
                                                    <div className={`text-xs truncate ${textSecondary}`}>
                                                        {[resultArtists, resultAlbum].filter(Boolean).join(' · ')}
                                                    </div>
                                                </div>
                                                {selectedResult?.id === result.id && (
                                                    <Check size={16} className="text-blue-400 flex-shrink-0" />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* RIGHT PANEL: Centered-style preview with lower-half LyricPreviewPanel */}
                    <div className="w-[38%] flex flex-col items-center justify-between px-6 py-6 border-l border-white/10 min-h-0 overflow-hidden">
                        {/* Upper section: Cover, Indicators and Info centered (Scrollable when height is constrained) */}
                        <div className="flex flex-col items-center justify-start w-full flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1">
                            {/* Cover Image */}
                            <div className="w-32 h-32 min-h-[64px] rounded-2xl overflow-hidden bg-zinc-800 shadow-md flex-shrink transition-all duration-300">
                                {previewCoverUrl ? (
                                    <img
                                        src={previewCoverUrl}
                                        alt="Cover"
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                        <Music size={28} className="opacity-10" />
                                    </div>
                                )}
                            </div>

                            {/* Toggle Buttons in a single row */}
                            <div className="flex flex-row items-center justify-center gap-4 w-full mt-3 flex-shrink-0">
                                <button
                                    onClick={() => {
                                        if (sourceSupportsCover(source, selectedResult)) {
                                            setUseOnlineCover(!useOnlineCover);
                                        }
                                    }}
                                    disabled={!sourceSupportsCover(source, selectedResult)}
                                    className="flex items-center gap-1.5 group disabled:opacity-40 disabled:cursor-not-allowed"
                                    title={t('localMusic.coverSource')}
                                >
                                    <div className={`w-2 h-2 rounded-full transition-all duration-200 ${useOnlineCover && sourceSupportsCover(source, selectedResult) ? dotActive + ' shadow-sm shadow-blue-400/50' : dotBase} group-hover:scale-150`} />
                                    <span className={`text-[11px] ${useOnlineCover && sourceSupportsCover(source, selectedResult) ? (isDaylight ? 'text-blue-600 font-medium' : 'text-blue-300 font-medium') : textSecondary} transition-colors`}>
                                        {t('localMusic.coverSource')}
                                    </span>
                                </button>
                                <button
                                    onClick={() => setUseOnlineMetadata(!useOnlineMetadata)}
                                    className="flex items-center gap-1.5 group"
                                    title={t('localMusic.metadataSource')}
                                >
                                    <div className={`w-2 h-2 rounded-full transition-all duration-200 ${useOnlineMetadata ? dotActive + ' shadow-sm shadow-blue-400/50' : dotBase} group-hover:scale-150`} />
                                    <span className={`text-[11px] ${useOnlineMetadata ? (isDaylight ? 'text-blue-600 font-medium' : 'text-blue-300 font-medium') : textSecondary} transition-colors`}>
                                        {t('localMusic.metadataSource')}
                                    </span>
                                </button>
                                <button
                                    onClick={() => setLyricsSource(lyricsSource === 'online' ? undefined : 'online')}
                                    className="flex items-center gap-1.5 group"
                                    title={t('localMusic.lyricsSource')}
                                >
                                    <div className={`w-2 h-2 rounded-full transition-all duration-200 ${lyricsSource === 'online' ? dotActive + ' shadow-sm shadow-blue-400/50' : dotBase} group-hover:scale-150`} />
                                    <span className={`text-[11px] ${lyricsSource === 'online' ? (isDaylight ? 'text-blue-600 font-medium' : 'text-blue-300 font-medium') : textSecondary} transition-colors`}>
                                        {t('localMusic.lyricsSource')}
                                    </span>
                                </button>
                            </div>

                            {/* Song Info (Centered) */}
                            <div className="w-full space-y-1.5 mt-4 text-center flex-shrink-0">
                                {/* Title */}
                                <h3 className={`text-base font-bold line-clamp-2 leading-snug px-2 ${textPrimary}`}>
                                    {previewTitle}
                                </h3>

                                {/* Artist */}
                                <div className="flex justify-center w-full">
                                    <div className={`text-sm opacity-75 font-medium line-clamp-1 ${textPrimary}`}>
                                        {previewArtist}
                                    </div>
                                </div>

                                {/* Album */}
                                <div className="flex justify-center w-full">
                                    <div className={`text-xs opacity-60 line-clamp-1 ${textPrimary}`}>
                                        {previewAlbum}
                                    </div>
                                </div>

                                {/* Lyrics source (display only) */}
                                <div className="flex items-center justify-center gap-2 pt-0.5">
                                    <span className={`text-[11px] ${textSecondary}`}>{t('localMusic.lyricsSource')}</span>
                                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${lyricsSource === 'online'
                                        ? (isDaylight ? 'bg-blue-500/10 text-blue-600' : 'bg-blue-500/20 text-blue-300')
                                        : ((song.hasLocalLyrics || song.hasEmbeddedLyrics) ? 'bg-green-500/20 text-green-300' : 'bg-white/10 opacity-60')
                                        }`}>
                                        {lyricsSourceLabel}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Lyric Preview Panel */}
                        <div className="w-full h-28 flex-shrink-0 mt-4 flex flex-col">
                            <LyricPreviewPanel selectedResult={selectedResult} source={source} isDaylight={isDaylight} />
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className={`px-6 py-4 border-t ${borderColor} flex justify-end gap-3`}>
                    <button
                        onClick={handleNoMatch}
                        className={`px-5 py-2 ${noMatchBtnBg} text-red-400 border rounded-lg transition-colors mr-auto text-sm`}
                    >
                        {t('localMusic.dontUseOnlineMetadata')}
                    </button>
                    <button
                        onClick={onClose}
                        className={`px-5 py-2 ${cancelBtnBg} rounded-lg transition-colors ${textPrimary} text-sm`}
                    >
                        {t('localMusic.cancel')}
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!selectedResult || isMatching}
                        className="px-5 py-2 bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm text-white"
                    >
                        {isMatching ? (
                            <>
                                <Loader2 className="animate-spin" size={14} />
                                <span>{t('localMusic.matching')}</span>
                            </>
                        ) : (
                            t('localMusic.save')
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default LyricMatchModal;
