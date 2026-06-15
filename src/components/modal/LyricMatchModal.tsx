import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Loader2, X, Music, Check } from 'lucide-react';
import { LocalSong, SongResult, LyricData } from '../../types';
import { neteaseApi } from '../../services/netease';
import { saveLocalSong, removeFromCache, saveToCache } from '../../services/db';
import { formatSongName } from '../../utils/songNameFormatter';
import { processNeteaseLyrics } from '../../utils/lyrics/neteaseProcessing';
import { useSettingsUiStore } from '../../stores/useSettingsUiStore';
import { searchQQLyrics, fetchQQLyrics } from '../../utils/lyrics/providers/qqLyricProvider';
import { searchKugouLyrics, fetchKugouLyrics } from '../../utils/lyrics/providers/kugouLyricProvider';
import { calculateMatchScore, normalizeLyricMatchText } from '../../utils/lyrics/matchScore';
import { buildLyricSearchQuery } from '../../utils/lyrics/searchQuery';
import {
    getLyricMatchSourceLabel,
    getMatchResultAlbumId,
    getMatchResultAlbumName,
    getMatchResultArtists,
    getMatchResultCoverUrl,
    sourceSupportsCover,
    type LyricMatchSource,
} from './lyricMatchResultHelpers';
import { LyricPreviewPanel } from './LyricPreviewPanel';

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
    const cardBg = isDaylight ? 'bg-black/[0.03]' : 'bg-white/[0.03]';
    const dotBase = isDaylight ? 'bg-zinc-300' : 'bg-zinc-600';
    const dotActive = isDaylight ? 'bg-blue-500' : 'bg-blue-400';
    const editInputBg = isDaylight ? 'bg-black/5 border-black/10 focus:border-black/20' : 'bg-white/5 border-white/10 focus:border-white/20';

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
    const [useOnlineCover, setUseOnlineCover] = useState(song.useOnlineCover ?? !song.embeddedCover);
    const [useOnlineMetadata, setUseOnlineMetadata] = useState(song.useOnlineMetadata ?? true);

    // Editable metadata fields
    const [editArtist, setEditArtist] = useState(song.matchedArtists || song.embeddedArtist || song.artist || '');
    const [editAlbum, setEditAlbum] = useState(song.matchedAlbumName || song.embeddedAlbum || song.album || '');

    // Derive song information for matching
    const songInfo = useMemo(() => {
        const title = song.title || song.fileName.replace(/\.(mp3|flac|m4a|wav|ogg|opus|aac)$/i, '');
        const artist = song.artist || '';
        const durationMs = song.duration || 0;
        return { title, artist, durationMs };
    }, [song]);

    // When a search result is selected, update the preview
    useEffect(() => {
        if (selectedResult) {
            const onlineArtist = getMatchResultArtists(selectedResult);
            const onlineAlbum = getMatchResultAlbumName(selectedResult);
            setEditArtist(useOnlineMetadata ? onlineArtist : (song.embeddedArtist || song.artist || onlineArtist));
            setEditAlbum(useOnlineMetadata ? onlineAlbum : (song.embeddedAlbum || song.album || onlineAlbum));
            setLyricsSource('online');
        }
    }, [selectedResult, source, useOnlineMetadata, song.embeddedArtist, song.artist, song.embeddedAlbum, song.album]);

    // Update metadata fields when toggling online metadata
    useEffect(() => {
        if (!selectedResult) return;
        const onlineArtist = getMatchResultArtists(selectedResult);
        const onlineAlbum = getMatchResultAlbumName(selectedResult);
        if (useOnlineMetadata) {
            setEditArtist(onlineArtist);
            setEditAlbum(onlineAlbum);
        } else {
            setEditArtist(song.embeddedArtist || song.artist || onlineArtist);
            setEditAlbum(song.embeddedAlbum || song.album || onlineAlbum);
        }
    }, [useOnlineMetadata, selectedResult, song.embeddedArtist, song.artist, song.embeddedAlbum, song.album]);

    // Derive preview cover URL with proper ObjectURL lifecycle management
    const [previewCoverUrl, setPreviewCoverUrl] = useState<string | null>(null);
    useEffect(() => {
        let objectUrl: string | null = null;

        if (!selectedResult) {
            // Show current state
            if (song.embeddedCover) {
                objectUrl = URL.createObjectURL(song.embeddedCover);
                setPreviewCoverUrl(objectUrl);
            } else {
                setPreviewCoverUrl(song.matchedCoverUrl || null);
            }
        } else if (useOnlineCover) {
            const selectedCoverUrl = getMatchResultCoverUrl(selectedResult, source);
            setPreviewCoverUrl(selectedCoverUrl || song.matchedCoverUrl || null);
        } else {
            // Local cover
            if (song.embeddedCover) {
                objectUrl = URL.createObjectURL(song.embeddedCover);
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
            return getLyricMatchSourceLabel(src);
        }
        if (lyricsSource === 'embedded') return t('localMusic.statusEmbedded');
        if (lyricsSource === 'local') return t('localMusic.statusLocal');
        // Default: show what would be selected by priority
        if (song.hasLocalLyrics) return t('localMusic.statusLocal');
        if (song.hasEmbeddedLyrics) return t('localMusic.statusEmbedded');
        return t('localMusic.statusNone');
    }, [lyricsSource, song, t, source, selectedResult]);

    // Title matching helpers
    const normalizeTitle = (title: string): string => {
        return normalizeLyricMatchText(title).replace(/\s+/g, '');
    };

    const isTitleMatch = (localTitle: string, searchTitle: string): boolean => {
        return normalizeTitle(localTitle) === normalizeTitle(searchTitle);
    };

    const runSearch = async (query: string, activeSource: LyricMatchSource) => {
        const q = query.trim();
        if (!q.trim()) return;

        const requestId = ++searchRequestIdRef.current;
        setIsSearching(true);
        setSearchResults([]);
        setSelectedResult(null);

        try {
            let results: SongResult[] = [];
            if (activeSource === 'netease') {
                const res = await neteaseApi.cloudSearch(q);
                results = res.result?.songs ?? [];
            } else if (activeSource === 'qq') {
                results = await searchQQLyrics(q);
            } else if (activeSource === 'kugou') {
                results = await searchKugouLyrics(q);
            }
            if (requestId !== searchRequestIdRef.current) return;

            setSearchResults(results);

            const localTitle = song.title || song.fileName.replace(/\.(mp3|flac|m4a|wav|ogg|opus|aac)$/i, '');
            const exactMatch = results.find(s => isTitleMatch(localTitle, s.name));

            if (exactMatch) {
                setSelectedResult(exactMatch);
            } else if (results.length > 0) {
                setSelectedResult(results[0]);
            }
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
        const initialQuery = buildLyricSearchQuery(title, song.artist || '', song.album || song.embeddedAlbum || '');
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
            // Always fetch lyrics from selected song (we decide whether to save them based on toggle)
            let processed: { lyrics: any; isPureMusic: boolean } | null = null;
            if (source === 'netease') {
                const lyricRes = await neteaseApi.getLyric(selectedResult.id);
                processed = await processNeteaseLyrics(
                    {
                        type: 'netease',
                        ...lyricRes
                    },
                    { songId: selectedResult.id }
                );
            } else if (source === 'qq') {
                const parsedLyrics = await fetchQQLyrics(selectedResult);
                processed = {
                    lyrics: parsedLyrics,
                    isPureMusic: false,
                };
            } else if (source === 'kugou') {
                const parsedLyrics = await fetchKugouLyrics(selectedResult);
                processed = {
                    lyrics: parsedLyrics,
                    isPureMusic: false,
                };
            }
            const parsedLyrics: LyricData | null = processed ? processed.lyrics : null;

            // Always save the matched song ID for reference
            song.matchedSongId = selectedResult.id;
            song.matchedIsPureMusic = processed.isPureMusic;
            song.matchedLyricsSource = source;

            // Save lyrics if online is selected
            if (lyricsSource === 'online') {
                song.matchedLyrics = parsedLyrics || undefined;
            }

            const selectedCoverUrl = getMatchResultCoverUrl(selectedResult, source);
            if (useOnlineCover) {
                if (selectedCoverUrl) {
                    song.matchedCoverUrl = selectedCoverUrl;
                }
            } else {
                delete song.matchedCoverUrl;
            }

            // Save metadata - always save the user-edited values.
            song.matchedArtists = editArtist;
            song.matchedAlbumId = getMatchResultAlbumId(selectedResult);
            song.matchedAlbumName = editAlbum;
            song.useOnlineCover = Boolean(useOnlineCover && (selectedCoverUrl || song.matchedCoverUrl));
            song.useOnlineMetadata = useOnlineMetadata;

            song.lyricsSource = lyricsSource;
            song.hasManualLyricSelection = true;
            await saveLocalSong(song);

            // Remove old cached cover to force refresh
            await removeFromCache(`cover_local_${song.id}`);

            // Fetch and cache the cover blob so it persists across refreshes.
            if (song.useOnlineCover && song.matchedCoverUrl) {
                try {
                    const coverResponse = await fetch(song.matchedCoverUrl, { mode: 'cors' });
                    const coverBlob = await coverResponse.blob();
                    await saveToCache(`cover_local_${song.id}`, coverBlob);
                } catch (e) {
                    console.warn('Failed to cache cover blob:', e);
                }
            }

            onMatch();
        } catch (error) {
            console.error('Failed to match or save song:', error);
            alert(t('localMusic.matchFailed'));
        } finally {
            setIsMatching(false);
        }
    };

    const handleNoMatch = async () => {
        try {
            song.noAutoMatch = true;
            // Set all data sources to local
            // Set all data sources to local / reset
            delete song.lyricsSource;
            song.useOnlineCover = false;
            song.useOnlineMetadata = false;

            // Clear all matched data to restore original local state
            delete song.matchedSongId;
            delete song.matchedArtists;
            delete song.matchedAlbumId;
            delete song.matchedAlbumName;
            delete song.matchedLyrics;
            delete song.matchedCoverUrl;
            delete song.matchedLyricsSource;

            await saveLocalSong(song);
            // Clear cached online cover so embedded cover is used
            await removeFromCache(`cover_local_${song.id}`);
            onMatch(); // Trigger refresh so the change applies
        } catch (error) {
            console.error('Failed to save song:', error);
            alert(t('localMusic.matchFailed'));
        }
    };


    return (
        <div data-folia-keyboard-window="true" className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xl flex items-center justify-center p-6">
            <div className={`${bgClass} border rounded-2xl max-w-5xl w-full max-h-[80vh] flex flex-col shadow-2xl backdrop-blur-md`}>
                {/* Header */}
                <div className={`px-6 py-4 border-b ${borderColor} flex items-center justify-between`}>
                    <h2 className={`text-lg font-bold ${textPrimary}`}>{t('localMusic.matchLyrics')}</h2>
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
                                {[
                                    { id: 'netease', label: '网易云音乐' },
                                    ...(enableAlternativeLyricSources ? [
                                        { id: 'qq', label: 'QQ 音乐' },
                                        { id: 'kugou', label: '酷狗音乐' }
                                    ] : [])
                                ].map(t => {
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
                                        const resultCoverUrl = getMatchResultCoverUrl(result, source);
                                        const resultArtists = getMatchResultArtists(result);
                                        const resultAlbum = getMatchResultAlbumName(result);
                                        return (
                                            <div
                                                key={result.id}
                                                onClick={() => setSelectedResult(result)}
                                                className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all border ${selectedResult?.id === result.id
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
                                                            {calculateMatchScore(songInfo, result)}%
                                                        </span>
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
                                    {selectedResult
                                        ? formatSongName(selectedResult)
                                        : (song.embeddedTitle || song.title || song.fileName.replace(/\.(mp3|flac|m4a|wav|ogg|opus|aac)$/i, ''))
                                    }
                                </h3>

                                {/* Artist */}
                                <div className="flex justify-center w-full">
                                    {useOnlineMetadata ? (
                                        <div className={`text-sm opacity-75 font-medium line-clamp-1 ${textPrimary}`}>
                                            {editArtist}
                                        </div>
                                    ) : (
                                        <input
                                            type="text"
                                            value={editArtist}
                                            onChange={(e) => setEditArtist(e.target.value)}
                                            className={`w-48 text-center ${editInputBg} border border-white/10 rounded-lg py-1 px-2 text-xs focus:outline-none transition-all ${textPrimary}`}
                                            placeholder={t('localMusic.artistLabel')}
                                        />
                                    )}
                                </div>

                                {/* Album */}
                                <div className="flex justify-center w-full">
                                    {useOnlineMetadata ? (
                                        <div className={`text-xs opacity-60 line-clamp-1 ${textPrimary}`}>
                                            {editAlbum}
                                        </div>
                                    ) : (
                                        <input
                                            type="text"
                                            value={editAlbum}
                                            onChange={(e) => setEditAlbum(e.target.value)}
                                            className={`w-48 text-center ${editInputBg} border border-white/10 rounded-lg py-1 px-2 text-xs focus:outline-none transition-all ${textPrimary}`}
                                            placeholder={t('localMusic.albumLabel')}
                                        />
                                    )}
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
