import React, { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Music, Search, X } from 'lucide-react';
import type { OnlineLyricsState, SongResult } from '../../types';
import { formatSongName } from '../../utils/songNameFormatter';
import { loadOnlineLyricsState, saveOnlineLyricsState } from '../../utils/onlineLyricsState';
import { useSettingsUiStore } from '../../stores/useSettingsUiStore';
import { calculateMatchScore } from '../../utils/lyrics/matchScore';
import { buildLyricSearchQuery } from '../../utils/lyrics/searchQuery';
import { fetchLyricsForMatchSource, LYRIC_MATCH_SOURCES, searchLyricsByMatchSource, sourceSupportsManualSearch } from '../../utils/lyrics/lyricMatchSources';
import { getLyricMatchSourceLabel, type LyricMatchSource } from './lyricMatchResultHelpers';
import {
    getMatchResultCoverUrl,
    getMatchResultArtists,
    getMatchResultAlbumName,
} from './lyricMatchResultHelpers';
import { LyricPreviewPanel } from './LyricPreviewPanel';

// src/components/modal/OnlineLyricMatchModal.tsx

interface OnlineLyricMatchModalProps {
    song: SongResult;
    onClose: () => void;
    onMatch: () => void;
    isDaylight: boolean;
}

const OnlineLyricMatchModal: React.FC<OnlineLyricMatchModalProps> = ({ song, onClose, onMatch, isDaylight }) => {
    const { t } = useTranslation();
    const isMouseDownOnOverlayRef = useRef(false);
    const enableAlternativeLyricSources = useSettingsUiStore(state => state.enableAlternativeLyricSources);
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

    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<SongResult[]>([]);
    const [selectedResult, setSelectedResult] = useState<SongResult | null>(null);
    const [isSearching, setIsSearching] = useState(false);
    const [isMatching, setIsMatching] = useState(false);
    const [source, setSource] = useState<LyricMatchSource>('netease');

    const songInfo = React.useMemo(() => {
        const artist = song.ar?.map(item => item.name).join(', ') || song.artists?.map(item => item.name).join(', ') || '';
        return {
            title: song.name || '',
            artist,
            album: song.al?.name || song.album?.name || '',
            durationMs: song.dt || song.duration || 0,
        };
    }, [song]);

    const getMatchQuery = (query = searchQuery) => (
        sourceSupportsManualSearch(source)
            ? query.trim()
            : buildLyricSearchQuery(songInfo.title, songInfo.artist, songInfo.album || '')
    );

    const handleSearch = async (query = searchQuery) => {
        const q = getMatchQuery(query);
        if (!q.trim()) {
            return;
        }

        setIsSearching(true);
        setSearchResults([]);
        setSelectedResult(null);
        try {
            const results = await searchLyricsByMatchSource(source, q, songInfo);
            setSearchResults(results);
            if (results.length > 0) {
                setSelectedResult(results[0]);
            }
        } catch (error) {
            console.error('Online lyric search failed', error);
        } finally {
            setIsSearching(false);
        }
    };

    useEffect(() => {
        let isCurrent = true;

        const artist = song.ar?.map(item => item.name).join(', ') || song.artists?.map(item => item.name).join(', ') || '';
        const album = song.al?.name || song.album?.name || '';
        const initialQuery = buildLyricSearchQuery(song.name, artist, album);
        setSearchQuery(initialQuery);
        setIsSearching(true);
        setSearchResults([]);
        setSelectedResult(null);

        void (async () => {
            try {
                const results = await searchLyricsByMatchSource(source, initialQuery, songInfo);

                if (!isCurrent) {
                    return;
                }

                setSearchResults(results);
                if (results.length > 0) {
                    setSelectedResult(results[0]);
                }
            } catch (error) {
                if (isCurrent) {
                    console.error('Online lyric search failed', error);
                }
            } finally {
                if (isCurrent) {
                    setIsSearching(false);
                }
            }
        })();

        return () => {
            isCurrent = false;
        };
    }, [song, source]);

    useEffect(() => {
        if (!enableAlternativeLyricSources && source !== 'netease') {
            setSource('netease');
        }
    }, [enableAlternativeLyricSources, source]);

    const handleConfirm = async () => {
        if (!selectedResult) {
            return;
        }

        setIsMatching(true);
        try {
            const processed = await fetchLyricsForMatchSource(source, selectedResult);

            if (processed && (processed.lyrics || processed.isPureMusic)) {
                const previousState = await loadOnlineLyricsState(song);
                const nextState: OnlineLyricsState = {
                    lyricsSource: 'online',
                    importedLyrics: previousState?.importedLyrics ?? null,
                    importedLyricsName: previousState?.importedLyricsName ?? null,
                    hasOnlineOverride: true,
                    onlineOverrideLyrics: processed.lyrics,
                    matchedSongId: selectedResult.id,
                    matchedIsPureMusic: processed.isPureMusic,
                    matchedLyricsSource: source,
                    matchedLyricsProviderPlatform: processed.matchedLyricsProviderPlatform,
                };
                await saveOnlineLyricsState(song, nextState);
                onMatch();
            }
        } catch (error) {
            console.error('Online lyric match failed', error);
        } finally {
            setIsMatching(false);
        }
    };

    const handleOverlayMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
        isMouseDownOnOverlayRef.current = event.target === event.currentTarget;
    };

    const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget && isMouseDownOnOverlayRef.current) {
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={handleOverlayMouseDown} onClick={handleBackdropClick}>
            <div
                className={`w-full max-w-5xl max-h-[85vh] overflow-hidden rounded-3xl border ${bgClass} shadow-2xl flex flex-col`}
                onClick={event => event.stopPropagation()}
            >
                <div className={`flex items-center justify-between px-6 py-5 border-b ${borderColor}`}>
                    <div>
                        <h2 className={`text-lg font-semibold ${textPrimary}`}>{t('localMusic.matchLyrics')}</h2>
                        <p className={`text-sm mt-1 ${textSecondary}`}>{song.name}</p>
                    </div>
                    <button onClick={onClose} className={`p-2 rounded-full transition-colors ${closeBtnHover}`}>
                        <X size={18} className={textPrimary} />
                    </button>
                </div>

                <div className="flex-1 flex min-h-0 overflow-hidden">
                    {/* LEFT PANEL */}
                    <div className={`w-[62%] flex flex-col border-r ${borderColor} p-6 gap-5 min-h-0`}>
                        <div className={`flex border-b ${borderColor} pb-2 gap-4`}>
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
                                        onClick={() => {
                                            setSelectedResult(null);
                                            setSearchResults([]);
                                            setSource(t.id as any);
                                        }}
                                        className={`pb-2 border-b-2 text-sm transition-all px-1 cursor-pointer ${activeTabClass}`}
                                    >
                                        {t.label}
                                    </button>
                                );
                            })}
                        </div>

                        {sourceSupportsManualSearch(source) && (
                            <div className="flex gap-3">
                                <div className={`flex-1 flex items-center gap-3 rounded-2xl border px-4 py-3 ${inputBg}`}>
                                    <Search size={18} className={textSecondary} />
                                    <input
                                        value={searchQuery}
                                        onChange={event => setSearchQuery(event.target.value)}
                                        onKeyDown={event => {
                                            if (event.key === 'Enter') {
                                                void handleSearch();
                                            }
                                        }}
                                        className={`flex-1 bg-transparent outline-none text-sm ${textPrimary}`}
                                    />
                                </div>
                                <button
                                    onClick={() => void handleSearch()}
                                    disabled={isSearching}
                                    className={`px-4 rounded-2xl text-sm font-medium transition-colors ${searchBtnBg}`}
                                >
                                    {isSearching ? <Loader2 size={16} className="animate-spin" /> : t('localMusic.search')}
                                </button>
                            </div>
                        )}

                        <div className="min-h-0 flex-1 overflow-y-auto space-y-3 pr-1">
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
                                searchResults.map(result => {
                                    const artist = getMatchResultArtists(result);
                                    const resultKey = `${source}-${result.amllDbPlatform ?? 'base'}-${result.id}`;
                                    const selectedKey = selectedResult ? `${source}-${selectedResult.amllDbPlatform ?? 'base'}-${selectedResult.id}` : null;
                                    const isSelected = selectedKey === resultKey;
                                    const resultCover = getMatchResultCoverUrl(result, source);
                                    return (
                                        <button
                                            key={resultKey}
                                            onClick={() => setSelectedResult(result)}
                                            className={`w-full text-left border rounded-2xl p-4 transition-colors ${isSelected ? resultItemSelected : resultItemBg}`}
                                        >
                                            <div className="flex items-start gap-4">
                                                <div className={`w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center ${isDaylight ? 'bg-black/5' : 'bg-white/5'} shrink-0`}>
                                                    {resultCover ? (
                                                        <img
                                                            src={resultCover}
                                                            alt="Cover"
                                                            className="w-full h-full object-cover"
                                                        />
                                                    ) : (
                                                        <Music size={18} className={textSecondary} />
                                                    )}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-sm font-medium truncate ${textPrimary}`}>{formatSongName(result)}</span>
                                                        <span className="text-[10px] px-1.5 py-0.2 bg-blue-500/10 text-blue-400 rounded-md font-mono shrink-0">
                                                            {calculateMatchScore(songInfo, result)}%
                                                        </span>
                                                    </div>
                                                    <div className={`text-xs mt-1 truncate ${textSecondary}`}>{artist || '-'}</div>
                                                    <div className={`text-xs mt-1 truncate ${textSecondary}`}>{getMatchResultAlbumName(result) || '-'}</div>
                                                </div>
                                                {isSelected && <Check size={18} className={isDaylight ? 'text-blue-600' : 'text-blue-300'} />}
                                            </div>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    {/* RIGHT PANEL: Centered-style preview with lower-half LyricPreviewPanel */}
                    <div className={`w-[38%] flex flex-col items-center justify-between px-6 py-6 border-l ${borderColor} min-h-0 overflow-hidden`}>
                        {/* Upper section: Cover and Info centered (Scrollable when height is constrained) */}
                        <div className="flex flex-col items-center justify-start w-full flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1">
                            {/* Cover Image */}
                            <div className="w-32 h-32 min-h-[64px] rounded-2xl overflow-hidden bg-zinc-800 shadow-md flex-shrink transition-all duration-300">
                                {selectedResult ? (
                                    getMatchResultCoverUrl(selectedResult, source) ? (
                                        <img src={getMatchResultCoverUrl(selectedResult, source) || ''} alt="Cover" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center"><Music size={28} className="opacity-10" /></div>
                                    )
                                ) : (
                                    song.al?.picUrl || song.album?.picUrl ? (
                                        <img src={song.al?.picUrl || song.album?.picUrl || ''} alt="Cover" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center"><Music size={28} className="opacity-10" /></div>
                                    )
                                )}
                            </div>

                            {/* Song Info (Centered) */}
                            <div className="w-full space-y-1.5 mt-4 text-center flex-shrink-0">
                                <h3 className={`text-base font-bold line-clamp-2 leading-snug px-2 ${textPrimary}`}>
                                    {selectedResult ? formatSongName(selectedResult) : song.name}
                                </h3>
                                
                                <div className={`text-sm opacity-75 font-medium line-clamp-1 ${textPrimary}`}>
                                    {selectedResult
                                        ? getMatchResultArtists(selectedResult)
                                        : (song.ar?.map(item => item.name).join(', ') || song.artists?.map(item => item.name).join(', ') || '')}
                                </div>
                                <div className={`text-xs opacity-60 line-clamp-1 ${textPrimary}`}>
                                    {selectedResult
                                        ? getMatchResultAlbumName(selectedResult)
                                        : (song.al?.name || song.album?.name || '')}
                                </div>
                            </div>
                        </div>

                        {/* Lyric Preview Panel */}
                        <div className="w-full h-28 flex-shrink-0 mt-4 flex flex-col">
                            <LyricPreviewPanel selectedResult={selectedResult} source={source} isDaylight={isDaylight} />
                        </div>
                    </div>
                </div>

                <div className={`px-6 py-5 border-t ${borderColor} flex justify-end gap-3`}>
                    <button onClick={onClose} className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${cancelBtnBg} ${textPrimary}`}>
                        {t('localMusic.cancel')}
                    </button>
                    <button
                        onClick={() => void handleConfirm()}
                        disabled={!selectedResult || isMatching}
                        className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${searchBtnBg} disabled:opacity-50`}
                    >
                        {isMatching ? t('localMusic.matching') : t('options.save')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default OnlineLyricMatchModal;
