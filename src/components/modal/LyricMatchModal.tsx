import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Loader2, X, Music, Check } from 'lucide-react';
import { LocalSong, SongResult, LyricData } from '../../types';
import { neteaseApi } from '../../services/netease';
import { saveLocalSong, removeFromCache, saveToCache } from '../../services/db';
import { formatSongName } from '../../utils/songNameFormatter';
import { processNeteaseLyrics } from '../../utils/lyrics/neteaseProcessing';

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

    // Online data toggle state (dots)
    const [lyricsSource, setLyricsSource] = useState<'local' | 'embedded' | 'online' | undefined>(song.lyricsSource);
    const [useOnlineCover, setUseOnlineCover] = useState(song.useOnlineCover ?? !song.embeddedCover);
    const [useOnlineMetadata, setUseOnlineMetadata] = useState(song.useOnlineMetadata ?? true);

    // Editable metadata fields
    const [editArtist, setEditArtist] = useState(song.matchedArtists || song.embeddedArtist || song.artist || '');
    const [editAlbum, setEditAlbum] = useState(song.matchedAlbumName || song.embeddedAlbum || song.album || '');

    // When a search result is selected, update the preview
    useEffect(() => {
        if (selectedResult) {
            const onlineArtist = selectedResult.ar?.map(a => a.name).join(', ') || '';
            const onlineAlbum = selectedResult.al?.name || selectedResult.album?.name || '';
            setEditArtist(useOnlineMetadata ? onlineArtist : (song.embeddedArtist || song.artist || onlineArtist));
            setEditAlbum(useOnlineMetadata ? onlineAlbum : (song.embeddedAlbum || song.album || onlineAlbum));
        }
    }, [selectedResult]);

    // Update metadata fields when toggling online metadata
    useEffect(() => {
        if (!selectedResult) return;
        const onlineArtist = selectedResult.ar?.map(a => a.name).join(', ') || '';
        const onlineAlbum = selectedResult.al?.name || selectedResult.album?.name || '';
        if (useOnlineMetadata) {
            setEditArtist(onlineArtist);
            setEditAlbum(onlineAlbum);
        } else {
            setEditArtist(song.embeddedArtist || song.artist || onlineArtist);
            setEditAlbum(song.embeddedAlbum || song.album || onlineAlbum);
        }
    }, [useOnlineMetadata]);

    // Derive preview cover URL
    const previewCoverUrl = useMemo(() => {
        if (!selectedResult) {
            // Show current state
            if (song.embeddedCover) return URL.createObjectURL(song.embeddedCover);
            return song.matchedCoverUrl || null;
        }
        if (useOnlineCover) {
            return (selectedResult.al?.picUrl || selectedResult.album?.picUrl || '').replace('http:', 'https:') || null;
        }
        // Local cover
        if (song.embeddedCover) return URL.createObjectURL(song.embeddedCover);
        return null;
    }, [selectedResult, useOnlineCover, song]);

    // Derive lyrics source label
    const lyricsSourceLabel = useMemo(() => {
        if (lyricsSource === 'online') return t('localMusic.statusOnline');
        if (lyricsSource === 'embedded') return t('localMusic.statusEmbedded');
        if (lyricsSource === 'local') return t('localMusic.statusLocal');
        // Default: show what would be selected by priority
        if (song.hasLocalLyrics) return t('localMusic.statusLocal');
        if (song.hasEmbeddedLyrics) return t('localMusic.statusEmbedded');
        return t('localMusic.statusNone');
    }, [lyricsSource, song, t]);

    // Initialize search
    useEffect(() => {
        const initialQuery = song.artist
            ? `${song.artist} ${song.title}`
            : song.title || song.fileName.replace(/\.(mp3|flac|m4a|wav|ogg|opus|aac)$/i, '');
        setSearchQuery(initialQuery);
        handleSearch(initialQuery);
    }, [song]);

    // Title matching helpers
    const normalizeTitle = (title: string): string => {
        return title
            .toLowerCase()
            .trim()
            .replace(/[^\w\s\u4e00-\u9fa5]/g, '')
            .replace(/\s+/g, '');
    };

    const isTitleMatch = (localTitle: string, searchTitle: string): boolean => {
        return normalizeTitle(localTitle) === normalizeTitle(searchTitle);
    };

    const handleSearch = async (query?: string) => {
        const q = query || searchQuery;
        if (!q.trim()) return;

        setIsSearching(true);
        setSearchResults([]);
        setSelectedResult(null);

        try {
            const res = await neteaseApi.cloudSearch(q);
            if (res.result?.songs) {
                setSearchResults(res.result.songs);

                const localTitle = song.title || song.fileName.replace(/\.(mp3|flac|m4a|wav|ogg|opus|aac)$/i, '');
                const exactMatch = res.result.songs.find(s => isTitleMatch(localTitle, s.name));

                if (exactMatch) {
                    setSelectedResult(exactMatch);
                }
            }
        } catch (error) {
            console.error('Search failed:', error);
        } finally {
            setIsSearching(false);
        }
    };

    const handleConfirm = async () => {
        if (!selectedResult) return;

        setIsMatching(true);
        try {
            // Always fetch lyrics from selected song (we decide whether to save them based on toggle)
            const lyricRes = await neteaseApi.getLyric(selectedResult.id);
            const processed = await processNeteaseLyrics({
                type: 'netease',
                ...lyricRes
            });
            const parsedLyrics: LyricData | null = processed.lyrics;

            // Always save the matched song ID for reference
            song.matchedSongId = selectedResult.id;
            song.matchedIsPureMusic = processed.isPureMusic;

            // Save lyrics if online is selected
            if (lyricsSource === 'online') {
                song.matchedLyrics = parsedLyrics || undefined;
            }

            // Save cover if online is selected
            if (useOnlineCover) {
                const coverUrl = selectedResult.al?.picUrl || selectedResult.album?.picUrl;
                if (coverUrl) {
                    song.matchedCoverUrl = coverUrl.replace('http:', 'https:');
                }
            }

            // Save metadata - always save the user-edited values
            song.matchedArtists = editArtist;
            song.matchedAlbumId = selectedResult.al?.id || selectedResult.album?.id;
            song.matchedAlbumName = editAlbum;

            // Persist user override preferences
            song.lyricsSource = lyricsSource;
            song.useOnlineCover = useOnlineCover;
            song.useOnlineMetadata = useOnlineMetadata;

            song.hasManualLyricSelection = true;
            await saveLocalSong(song);

            // Remove old cached cover to force refresh
            await removeFromCache(`cover_local_${song.id}`);

            // Fetch and cache the cover blob so it persists across refreshes
            if (useOnlineCover && song.matchedCoverUrl) {
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
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xl flex items-center justify-center p-6">
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
                            <form
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    handleSearch();
                                }}
                                className="relative"
                            >
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder={t('localMusic.searchForSong')}
                                    className={`w-full ${inputBg} border rounded-lg py-2.5 pl-9 pr-4 text-sm focus:outline-none transition-all ${textPrimary}`}
                                    autoFocus
                                />
                                <Search className={`absolute left-3 top-1/2 -translate-y-1/2 opacity-40 ${textSecondary}`} size={16} />
                                <button
                                    type="submit"
                                    disabled={isSearching}
                                    className={`absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 ${searchBtnBg} rounded-md text-xs transition-colors disabled:opacity-50`}
                                >
                                    {isSearching ? t('localMusic.searching') : t('localMusic.search')}
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
                                    {searchResults.map((result) => (
                                        <div
                                            key={result.id}
                                            onClick={() => setSelectedResult(result)}
                                            className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all border ${selectedResult?.id === result.id
                                                ? resultItemSelected
                                                : resultItemBg
                                                }`}
                                        >
                                            <div className="w-10 h-10 rounded-lg overflow-hidden bg-zinc-800 flex-shrink-0">
                                                {result.al?.picUrl || result.album?.picUrl ? (
                                                    <img
                                                        src={(result.al?.picUrl || result.album?.picUrl || '').replace('http:', 'https:')}
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
                                                <div className={`text-sm font-semibold truncate ${textPrimary}`}>{formatSongName(result)}</div>
                                                <div className={`text-xs truncate ${textSecondary}`}>
                                                    {result.ar?.map(a => a.name).join(', ')} · {result.al?.name || result.album?.name}
                                                </div>
                                            </div>
                                            {selectedResult?.id === result.id && (
                                                <Check size={16} className="text-blue-400 flex-shrink-0" />
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* RIGHT PANEL: CoverTab-style preview */}
                    <div className="w-[38%] flex flex-col items-center justify-center px-5 py-6">
                        <div className="flex flex-col items-center text-center w-full space-y-4">
                            {/* Cover Image */}
                            <div className="w-40 h-40 rounded-2xl overflow-hidden bg-zinc-800 shadow-lg flex-shrink-0">
                                {previewCoverUrl ? (
                                    <img
                                        src={previewCoverUrl}
                                        alt="Cover"
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                        <Music size={40} className="opacity-10" />
                                    </div>
                                )}
                            </div>

                            {/* Three Indicator Dots: 封面 · 元数据 · 歌词 */}
                            <div className="flex items-center gap-4">
                                <button
                                    onClick={() => setUseOnlineCover(!useOnlineCover)}
                                    className="flex items-center gap-1.5 group"
                                    title={t('localMusic.coverSource')}
                                >
                                    <div className={`w-2 h-2 rounded-full transition-all duration-200 ${useOnlineCover ? dotActive + ' shadow-sm shadow-blue-400/50' : dotBase} group-hover:scale-150`} />
                                    <span className={`text-[11px] ${useOnlineCover ? (isDaylight ? 'text-blue-600 font-medium' : 'text-blue-300 font-medium') : textSecondary} transition-colors`}>
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

                            {/* Song Info (CoverTab-style) */}
                            <div className="space-y-2 w-full">
                                {/* Title */}
                                <h3 className={`text-lg font-bold line-clamp-2 ${textPrimary}`}>
                                    {selectedResult
                                        ? formatSongName(selectedResult)
                                        : (song.embeddedTitle || song.title || song.fileName.replace(/\.(mp3|flac|m4a|wav|ogg|opus|aac)$/i, ''))
                                    }
                                </h3>

                                    {/* Artist - editable if NOT using online metadata */}
                                    {useOnlineMetadata ? (
                                        <div className={`text-sm opacity-60 font-medium ${textPrimary}`}>
                                            {editArtist}
                                        </div>
                                    ) : (
                                        <input
                                            type="text"
                                            value={editArtist}
                                            onChange={(e) => setEditArtist(e.target.value)}
                                            className={`w-full text-center ${editInputBg} border rounded-lg py-1.5 px-3 text-sm focus:outline-none transition-all ${textPrimary}`}
                                            placeholder={t('localMusic.artistLabel')}
                                        />
                                    )}

                                    {/* Album - editable if NOT using online metadata */}
                                    {useOnlineMetadata ? (
                                        <div className={`text-sm opacity-40 ${textPrimary}`}>
                                            {editAlbum}
                                        </div>
                                    ) : (
                                        <input
                                            type="text"
                                            value={editAlbum}
                                            onChange={(e) => setEditAlbum(e.target.value)}
                                            className={`w-full text-center ${editInputBg} border rounded-lg py-1.5 px-3 text-sm focus:outline-none transition-all ${textPrimary}`}
                                            placeholder={t('localMusic.albumLabel')}
                                        />
                                    )}

                                    {/* Lyrics source (display only) */}
                                    <div className="flex items-center justify-center gap-2 pt-1">
                                        <span className={`text-xs ${textSecondary}`}>{t('localMusic.lyricsSource')}</span>
                                        <span className={`text-xs px-2 py-0.5 rounded-full ${lyricsSource === 'online'
                                            ? (isDaylight ? 'bg-blue-500/10 text-blue-600' : 'bg-blue-500/20 text-blue-300')
                                            : ((song.hasLocalLyrics || song.hasEmbeddedLyrics) ? 'bg-green-500/20 text-green-300' : 'bg-white/10 opacity-60')
                                            }`}>
                                            {lyricsSourceLabel}
                                        </span>
                                    </div>
                            </div>
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
