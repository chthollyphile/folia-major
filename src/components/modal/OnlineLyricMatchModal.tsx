import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Music, Search, X } from 'lucide-react';
import { neteaseApi } from '../../services/netease';
import type { OnlineLyricsState, SongResult } from '../../types';
import { processNeteaseLyrics } from '../../utils/lyrics/neteaseProcessing';
import { formatSongName } from '../../utils/songNameFormatter';
import { loadOnlineLyricsState, saveOnlineLyricsState } from '../../utils/onlineLyricsState';

// src/components/modal/OnlineLyricMatchModal.tsx

interface OnlineLyricMatchModalProps {
    song: SongResult;
    onClose: () => void;
    onMatch: () => void;
    isDaylight: boolean;
}

const OnlineLyricMatchModal: React.FC<OnlineLyricMatchModalProps> = ({ song, onClose, onMatch, isDaylight }) => {
    const { t } = useTranslation();
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

    const handleSearch = async (query = searchQuery) => {
        if (!query.trim()) {
            return;
        }

        setIsSearching(true);
        setSearchResults([]);
        setSelectedResult(null);
        try {
            const response = await neteaseApi.cloudSearch(query);
            const results = response.result?.songs ?? [];
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
        const initialQuery = `${song.name} ${artist}`.trim();
        setSearchQuery(initialQuery);
        setIsSearching(true);
        setSearchResults([]);
        setSelectedResult(null);

        void (async () => {
            try {
                const response = await neteaseApi.cloudSearch(initialQuery);
                if (!isCurrent) {
                    return;
                }

                const results = response.result?.songs ?? [];
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
    }, [song]);

    const handleConfirm = async () => {
        if (!selectedResult) {
            return;
        }

        setIsMatching(true);
        try {
            const lyricResponse = await neteaseApi.getLyric(selectedResult.id);
            const processed = await processNeteaseLyrics(neteaseApi.getProcessedLyricPayload(lyricResponse), { songId: selectedResult.id });
            const previousState = await loadOnlineLyricsState(song);
            const nextState: OnlineLyricsState = {
                lyricsSource: 'online',
                importedLyrics: previousState?.importedLyrics ?? null,
                importedLyricsName: previousState?.importedLyricsName ?? null,
                hasOnlineOverride: true,
                onlineOverrideLyrics: processed.lyrics,
                matchedSongId: selectedResult.id,
                matchedIsPureMusic: processed.isPureMusic,
            };
            await saveOnlineLyricsState(song, nextState);
            onMatch();
        } catch (error) {
            console.error('Online lyric match failed', error);
        } finally {
            setIsMatching(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div
                className={`w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-3xl border ${bgClass} shadow-2xl flex flex-col`}
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

                <div className="p-6 flex flex-col gap-5 min-h-0">
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

                    <div className="min-h-0 flex-1 overflow-y-auto space-y-3 pr-1">
                        {searchResults.map(result => {
                            const artist = result.ar?.map(item => item.name).join(', ') || result.artists?.map(item => item.name).join(', ') || '';
                            const isSelected = selectedResult?.id === result.id;
                            return (
                                <button
                                    key={result.id}
                                    onClick={() => setSelectedResult(result)}
                                    className={`w-full text-left border rounded-2xl p-4 transition-colors ${isSelected ? resultItemSelected : resultItemBg}`}
                                >
                                    <div className="flex items-start gap-4">
                                        <div className={`w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center ${isDaylight ? 'bg-black/5' : 'bg-white/5'} shrink-0`}>
                                            {result.al?.picUrl || result.album?.picUrl ? (
                                                <img
                                                    src={result.al?.picUrl || result.album?.picUrl}
                                                    alt="Cover"
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <Music size={18} className={textSecondary} />
                                            )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className={`text-sm font-medium truncate ${textPrimary}`}>{formatSongName(result)}</div>
                                            <div className={`text-xs mt-1 truncate ${textSecondary}`}>{artist || '-'}</div>
                                            <div className={`text-xs mt-1 truncate ${textSecondary}`}>{result.al?.name || result.album?.name || '-'}</div>
                                        </div>
                                        {isSelected && <Check size={18} className={isDaylight ? 'text-blue-600' : 'text-blue-300'} />}
                                    </div>
                                </button>
                            );
                        })}
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
                        {isMatching ? t('matching') : t('options.save')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default OnlineLyricMatchModal;
