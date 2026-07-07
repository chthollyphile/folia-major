import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Loader2, X, Music, Check } from 'lucide-react';
import { AmllDbPlatform, LyricProviderSource, SongResult, LyricData } from '../../types';
import { NavidromeSong } from '../../types/navidrome';
import { saveToCache, getFromCacheWithMigration } from '../../services/db';
import { formatSongName } from '../../utils/songNameFormatter';
import { migrateMatchedLyricsCarrierRenderHints } from '../../utils/lyrics/storageMigration';
import { useSettingsUiStore } from '../../stores/useSettingsUiStore';
import { calculateMatchScore } from '../../utils/lyrics/matchScore';
import { buildLyricSearchQuery } from '../../utils/lyrics/searchQuery';
import { fetchLyricsForMatchSource, LYRIC_MATCH_SOURCES, searchLyricsByMatchSource, sourceSupportsManualSearch } from '../../utils/lyrics/lyricMatchSources';
import {
    getLyricMatchSourceLabel,
    getMatchResultAlbumName,
    getMatchResultArtists,
    getMatchResultCoverUrl,
    type LyricMatchSource,
} from './lyricMatchResultHelpers';
import { LyricPreviewPanel } from './LyricPreviewPanel';

export interface NavidromeMatchData {
    matchedSongId?: number;
    matchedLyrics?: LyricData;
    matchedIsPureMusic?: boolean;
    matchedCoverUrl?: string;
    matchedArtists?: string;
    matchedAlbumId?: number;
    matchedAlbumName?: string;
    useOnlineLyrics?: boolean; // Legacy, kept for backward compatibility
    lyricsSource?: 'navi' | 'online';
    useOnlineCover?: boolean;
    useOnlineMetadata?: boolean;
    noAutoMatch?: boolean;
    hasManualLyricSelection?: boolean;
    matchedLyricsSource?: LyricProviderSource;
    matchedLyricsProviderPlatform?: AmllDbPlatform;
}

interface NaviLyricMatchModalProps {
    song: NavidromeSong;
    onClose: () => void;
    onMatch: () => void;
    isDaylight: boolean;
}

const NaviLyricMatchModal: React.FC<NaviLyricMatchModalProps> = ({ song, onClose, onMatch, isDaylight }) => {
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
    const editInputBg = isDaylight ? 'bg-black/5 border-black/10 focus:border-black/20' : 'bg-white/5 border-white/10 focus:border-white/20';

    // Search state
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<SongResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedResult, setSelectedResult] = useState<SongResult | null>(null);
    const [isMatching, setIsMatching] = useState(false);

    // Initial config from cache
    const [initialMatchData, setInitialMatchData] = useState<NavidromeMatchData | null>(null);

    // Online data toggle state
    const [lyricsSource, setLyricsSource] = useState<'navi' | 'online'>('online');
    const enableAlternativeLyricSources = useSettingsUiStore(state => state.enableAlternativeLyricSources);
    const [source, setSource] = useState<LyricMatchSource>('netease');

    const navidromeArtist = song.artists?.map(a => a.name).join(', ') || song.ar?.map(a => a.name).join(', ') || '';
    const navidromeAlbum = song.album?.name || song.al?.name || '';

    const songInfo = useMemo(() => {
        return {
            title: song.name || '',
            artist: navidromeArtist || '',
            album: navidromeAlbum || '',
            durationMs: song.duration || song.dt || 0,
        };
    }, [song, navidromeArtist, navidromeAlbum]);

    // Prepare component data
    useEffect(() => {
        const loadExistingMatch = async () => {
            const data = await getFromCacheWithMigration<NavidromeMatchData>(
                `navidrome_match_${song.navidromeData.id}`,
                migrateMatchedLyricsCarrierRenderHints
            );
            if (data) {
                setInitialMatchData(data);
                setLyricsSource(data.lyricsSource ?? 'online');
            } else {
                setLyricsSource('online');
            }
        };
        loadExistingMatch();
    }, [song]);

    const handleSearch = async (query?: string) => {
        const q = sourceSupportsManualSearch(source)
            ? (query || searchQuery)
            : buildLyricSearchQuery(songInfo.title, songInfo.artist, songInfo.album || '');
        if (!q.trim()) return;

        setIsSearching(true);
        setSearchResults([]);
        setSelectedResult(null);

        try {
            const results = await searchLyricsByMatchSource(source, q, songInfo);
            setSearchResults(results);

            // Preselect exact match roughly
            const exactMatch = results.find(s => s.name.toLowerCase() === song.name.toLowerCase());
            if (exactMatch) {
                setSelectedResult(exactMatch);
            } else if (results.length > 0) {
                setSelectedResult(results[0]);
            }
        } catch (error) {
            console.error('Search failed:', error);
        } finally {
            setIsSearching(false);
        }
    };

    // Auto search on mount
    useEffect(() => {
        let isCurrent = true;
        const query = buildLyricSearchQuery(song.name, navidromeArtist, navidromeAlbum);
        setSearchQuery(query);
        setIsSearching(true);
        setSearchResults([]);
        setSelectedResult(null);

        void (async () => {
            try {
                const results = await searchLyricsByMatchSource(source, query, songInfo);

                if (!isCurrent) return;

                setSearchResults(results);
                const exactMatch = results.find(s => s.name.toLowerCase() === song.name.toLowerCase());
                if (exactMatch) {
                    setSelectedResult(exactMatch);
                } else if (results.length > 0) {
                    setSelectedResult(results[0]);
                }
            } catch (error) {
                console.error('Search failed:', error);
            } finally {
                if (isCurrent) {
                    setIsSearching(false);
                }
            }
        })();

        return () => {
            isCurrent = false;
        };
    }, [song, source, navidromeArtist, navidromeAlbum]);

    useEffect(() => {
        if (!enableAlternativeLyricSources && source !== 'netease') {
            setSource('netease');
        }
    }, [enableAlternativeLyricSources, source]);

    // When a search result is selected, update lyricsSource to 'online'
    useEffect(() => {
        if (selectedResult) {
            setLyricsSource('online');
        }
    }, [selectedResult]);



    const handleConfirm = async () => {
        if (!selectedResult) return;

        setIsMatching(true);
        try {
            // Always fetch lyrics
            const processed = await fetchLyricsForMatchSource(source, selectedResult);
            if (!processed) return;
            const parsedLyrics: LyricData | null = processed ? processed.lyrics : null;

            const matchData: NavidromeMatchData = {
                matchedSongId: selectedResult.id,
                matchedLyrics: parsedLyrics || undefined,
                matchedIsPureMusic: processed.isPureMusic,
                useOnlineLyrics: lyricsSource === 'online',
                lyricsSource,
                hasManualLyricSelection: true,
                matchedLyricsSource: source,
                matchedLyricsProviderPlatform: processed.matchedLyricsProviderPlatform,
            };

            if (source !== 'netease') {
                matchData.useOnlineCover = false;
                matchData.useOnlineMetadata = false;
            }

            await saveToCache(`navidrome_match_${song.navidromeData.id}`, matchData);

            onMatch();
        } catch (error) {
            console.error('Failed to save Navidrome match:', error);
            alert(t('localMusic.matchFailed'));
        } finally {
            setIsMatching(false);
        }
    };

    const handleNoMatch = async () => {
        setIsMatching(true);
        try {
            const matchData: NavidromeMatchData = {
                noAutoMatch: true,
                useOnlineLyrics: false,
                lyricsSource: 'navi' as const,
                hasManualLyricSelection: true
            };
            await saveToCache(`navidrome_match_${song.navidromeData.id}`, matchData);
            onMatch();
        } catch (error) {
            console.error('Failed to save no match preference:', error);
        } finally {
            setIsMatching(false);
        }
    };

    const coverUrl = song.album?.picUrl || song.al?.picUrl || song.navidromeData?.coverArtUrl || null;
    const selectedCoverUrl = getMatchResultCoverUrl(selectedResult, source);
    const selectedArtists = getMatchResultArtists(selectedResult);
    const selectedAlbum = getMatchResultAlbumName(selectedResult);

    return (
        <div data-folia-keyboard-window="true" className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xl flex items-center justify-center p-6">
            <div className={`${bgClass} border rounded-2xl max-w-5xl w-full max-h-[80vh] flex flex-col shadow-2xl backdrop-blur-md`}>
                {/* Header */}
                <div className={`px-6 py-4 border-b ${borderColor} flex items-center justify-between`}>
                    <h2 className={`text-lg font-bold ${textPrimary}`}>{t('localMusic.matchLyrics')} (Navidrome)</h2>
                    <button onClick={onClose} className={`p-2 ${closeBtnHover} rounded-lg transition-colors ${textPrimary}`}>
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 flex min-h-0 overflow-hidden">
                    {/* LEFT PANEL */}
                    <div className={`w-[62%] flex flex-col border-r ${borderColor}`}>
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
                        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-4">
                            {isSearching ? (
                                <div className="flex justify-center items-center h-40"><Loader2 className="animate-spin opacity-50" size={28} /></div>
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
                                        return (
                                            <div key={resultKey} onClick={() => setSelectedResult(result)} className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all border ${selectedKey === resultKey ? resultItemSelected : resultItemBg}`}>
                                                <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-zinc-800">
                                                    {resultCoverUrl ? (
                                                        <img src={resultCoverUrl} alt={result.name} className="w-full h-full object-cover" />
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
                                                    <div className={`text-xs truncate ${textSecondary}`}>{[resultArtists, resultAlbum].filter(Boolean).join(' · ')}</div>
                                                </div>
                                                {selectedResult?.id === result.id && <Check size={16} className="text-blue-400 flex-shrink-0" />}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* RIGHT PANEL: Centered-style preview with lower-half LyricPreviewPanel */}
                    <div className={`w-[38%] flex flex-col items-center justify-between px-6 py-6 border-l ${borderColor} min-h-0 overflow-hidden`}>
                        {/* Upper section: Cover and Info centered (Scrollable when height is constrained) */}
                        <div className="flex flex-col items-center justify-start w-full flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1">
                            {/* Cover Image */}
                            <div className="w-32 h-32 min-h-[64px] rounded-2xl overflow-hidden bg-zinc-800 shadow-md flex-shrink transition-all duration-300">
                                {selectedCoverUrl || coverUrl ? (
                                    <img src={selectedCoverUrl || coverUrl || ''} alt="Cover" className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                        <Music size={28} className="opacity-10" />
                                    </div>
                                )}
                            </div>

                            {/* Song Info (Centered) */}
                            <div className="w-full space-y-1.5 mt-4 text-center flex-shrink-0">
                                <h3 className={`text-base font-bold line-clamp-2 leading-snug px-2 ${textPrimary}`}>
                                    {selectedResult ? formatSongName(selectedResult) : song.name}
                                </h3>
                                
                                <div className={`text-sm opacity-75 font-medium line-clamp-1 ${textPrimary}`}>
                                    {selectedResult ? selectedArtists : navidromeArtist}
                                </div>
                                <div className={`text-xs opacity-60 line-clamp-1 ${textPrimary}`}>
                                    {selectedResult ? selectedAlbum : navidromeAlbum}
                                </div>

                                {selectedResult && (
                                    <div className="flex items-center justify-center gap-2 pt-1">
                                        <span className={`text-[11px] ${textSecondary}`}>{t('localMusic.matchStatus')}</span>
                                        <span className={`text-[11px] px-2 py-0.5 rounded-full ${lyricsSource === 'online' ? (isDaylight ? 'bg-blue-500/10 text-blue-600' : 'bg-blue-500/20 text-blue-300') : (isDaylight ? 'bg-orange-500/10 text-orange-600' : 'bg-orange-500/20 text-orange-300')}`}>
                                            {lyricsSource === 'online' ? t('localMusic.preferOnline') : t('localMusic.forceServer')}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Lyric Preview Panel */}
                        <div className="w-full h-28 flex-shrink-0 mt-4 flex flex-col">
                            <LyricPreviewPanel selectedResult={selectedResult} source={source} isDaylight={isDaylight} />
                        </div>
                    </div>
                </div>

                <div className={`px-6 py-4 border-t ${borderColor} flex justify-end gap-3`}>
                    <button onClick={handleNoMatch} className={`px-5 py-2 ${noMatchBtnBg} text-red-400 border rounded-lg transition-colors mr-auto text-sm`}>
                        {t('localMusic.skipOnlineMatch')}
                    </button>
                    <button onClick={onClose} className={`px-5 py-2 ${cancelBtnBg} rounded-lg transition-colors ${textPrimary} text-sm`}>
                        {t('localMusic.cancel')}
                    </button>
                    <button onClick={handleConfirm} disabled={!selectedResult || isMatching} className="px-5 py-2 bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm text-white">
                        {isMatching ? <><Loader2 className="animate-spin" size={14} />{t('localMusic.saving')}</> : t('localMusic.save')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default NaviLyricMatchModal;
