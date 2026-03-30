import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Loader2, X, Music, Check } from 'lucide-react';
import { SongResult, LyricData } from '../types';
import { NavidromeSong } from '../types/navidrome';
import { neteaseApi } from '../services/netease';
import { parseLRC } from '../utils/lrcParser';
import { parseYRC } from '../utils/yrcParser';
import { detectChorusLines } from '../utils/chorusDetector';
import { saveToCache, getFromCache, removeFromCache } from '../services/db';
import { formatSongName } from '../utils/songNameFormatter';

export interface NavidromeMatchData {
    matchedSongId?: number;
    matchedLyrics?: LyricData;
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

    const navidromeArtist = song.artists?.map(a => a.name).join(', ') || song.ar?.map(a => a.name).join(', ') || '';
    const navidromeAlbum = song.album?.name || song.al?.name || '';

    // Prepare component data
    useEffect(() => {
        const loadExistingMatch = async () => {
            const data = await getFromCache<NavidromeMatchData>(`navidrome_match_${song.navidromeData.id}`);
            if (data) {
                setInitialMatchData(data);
                setLyricsSource(data.lyricsSource ?? (data.useOnlineLyrics ? 'online' : 'navi'));
            } else {
                setLyricsSource('online');
            }
        };
        loadExistingMatch();
    }, [song]);

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
                // Preselect exact match roughly
                const exactMatch = res.result.songs.find(s => s.name.toLowerCase() === song.name.toLowerCase());
                if (exactMatch) setSelectedResult(exactMatch);
            }
        } catch (error) {
            console.error('Search failed:', error);
        } finally {
            setIsSearching(false);
        }
    };

    // Auto search on mount
    useEffect(() => {
        const query = `${song.name} ${navidromeArtist}`.trim();
        setSearchQuery(query);
        handleSearch(query);
    }, [song]);



    const handleConfirm = async () => {
        if (!selectedResult) return;

        setIsMatching(true);
        try {
            // Always fetch lyrics
            const lyricRes = await neteaseApi.getLyric(selectedResult.id);
            const mainLrc = lyricRes.yrc?.lyric || lyricRes.lrc?.yrc?.lyric || lyricRes.lrc?.lyric;
            const transLrc = lyricRes.ytlrc?.lyric || lyricRes.tlyric?.lyric || "";

            let parsedLyrics: LyricData | null = null;
            if (mainLrc) {
                parsedLyrics = lyricRes.yrc?.lyric ? parseYRC(mainLrc, transLrc) : parseLRC(mainLrc, transLrc);
            }

            if (parsedLyrics && mainLrc) {
                const chorusLines = detectChorusLines(mainLrc);
                if (chorusLines.size > 0) {
                    const effectMap = new Map<string, 'bars' | 'circles' | 'beams'>();
                    const effects: ('bars' | 'circles' | 'beams')[] = ['bars', 'circles', 'beams'];
                    chorusLines.forEach(text => {
                        effectMap.set(text, effects[Math.floor(Math.random() * effects.length)]);
                    });
                    parsedLyrics.lines.forEach(line => {
                        const text = line.fullText.trim();
                        if (chorusLines.has(text)) {
                            line.isChorus = true;
                            line.chorusEffect = effectMap.get(text);
                        }
                    });
                }
            }

            const matchData: NavidromeMatchData = {
                matchedSongId: selectedResult.id,
                matchedLyrics: parsedLyrics || undefined,
                useOnlineLyrics: lyricsSource === 'online',
                lyricsSource,
                hasManualLyricSelection: true
            };

            await saveToCache(`navidrome_match_${song.navidromeData.id}`, matchData);

            onMatch();
        } catch (error) {
            console.error('Failed to save Navidrome match:', error);
            alert(t('localMusic.matchFailed') || '匹配失败');
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

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xl flex items-center justify-center p-6">
            <div className={`${bgClass} border rounded-2xl max-w-5xl w-full max-h-[80vh] flex flex-col shadow-2xl backdrop-blur-md`}>
                {/* Header */}
                <div className={`px-6 py-4 border-b ${borderColor} flex items-center justify-between`}>
                    <h2 className={`text-lg font-bold ${textPrimary}`}>{t('localMusic.matchLyrics') || '匹配歌词'} (Navidrome)</h2>
                    <button onClick={onClose} className={`p-2 ${closeBtnHover} rounded-lg transition-colors ${textPrimary}`}>
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 flex min-h-0 overflow-hidden">
                    {/* LEFT PANEL */}
                    <div className={`w-[62%] flex flex-col border-r ${borderColor}`}>
                        <div className="p-4">
                            <form onSubmit={(e) => { e.preventDefault(); handleSearch(); }} className="relative">
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder={t('localMusic.searchForSong')}
                                    className={`w-full ${inputBg} border rounded-lg py-2.5 pl-9 pr-4 text-sm focus:outline-none transition-all ${textPrimary}`}
                                    autoFocus
                                />
                                <Search className={`absolute left-3 top-1/2 -translate-y-1/2 opacity-40 ${textSecondary}`} size={16} />
                                <button type="submit" disabled={isSearching} className={`absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 ${searchBtnBg} rounded-md text-xs transition-colors disabled:opacity-50`}>
                                    {isSearching ? t('localMusic.searching') || '搜索中...' : t('localMusic.search') || '搜索'}
                                </button>
                            </form>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-4">
                            {isSearching ? (
                                <div className="flex justify-center items-center h-40"><Loader2 className="animate-spin opacity-50" size={28} /></div>
                            ) : searchResults.length === 0 ? (
                                <div className={`flex flex-col items-center justify-center h-40 opacity-50 ${textSecondary}`}>
                                    <Music size={40} className="mb-2" />
                                    <p className="text-sm">{t('localMusic.noResults') || '未找到结果'}</p>
                                </div>
                            ) : (
                                <div className="space-y-1.5">
                                    {searchResults.map((result) => (
                                        <div key={result.id} onClick={() => setSelectedResult(result)} className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all border ${selectedResult?.id === result.id ? resultItemSelected : resultItemBg}`}>
                                            <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-zinc-800">
                                                {result.al?.picUrl ? <img src={result.al.picUrl.replace('http:', 'https:')} alt="" className="w-full h-full object-cover" /> : <Music size={16} className="opacity-20 m-auto" />}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className={`text-sm font-semibold truncate ${textPrimary}`}>{formatSongName(result)}</div>
                                                <div className={`text-xs truncate ${textSecondary}`}>{result.ar?.map(a => a.name).join(', ')} · {result.al?.name}</div>
                                            </div>
                                            {selectedResult?.id === result.id && <Check size={16} className="text-blue-400 flex-shrink-0" />}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* RIGHT PANEL */}
                    <div className="w-[38%] flex flex-col items-center justify-center px-5 py-6">
                        <div className="flex flex-col items-center text-center w-full space-y-4">
                            <div className="w-40 h-40 rounded-2xl overflow-hidden bg-zinc-800 shadow-lg flex-shrink-0">
                                {coverUrl ? <img src={coverUrl} alt="Cover" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><Music size={40} className="opacity-10" /></div>}
                            </div>
                            <div className="space-y-4 w-full mt-2">
                                <div>
                                    <h3 className={`text-lg font-bold line-clamp-2 ${textPrimary}`}>{song.name}</h3>
                                    <div className={`text-sm opacity-60 font-medium ${textPrimary} mt-1`}>{navidromeArtist}</div>
                                    <div className={`text-sm opacity-40 ${textPrimary} mt-1`}>{navidromeAlbum}</div>
                                </div>
                                {selectedResult && (
                                    <div className="flex items-center justify-center gap-2 pt-2">
                                        <span className={`text-xs ${textSecondary}`}>匹配状态</span>
                                        <span className={`text-xs px-2 py-0.5 rounded-full ${lyricsSource === 'online' ? (isDaylight ? 'bg-blue-500/10 text-blue-600' : 'bg-blue-500/20 text-blue-300') : (isDaylight ? 'bg-orange-500/10 text-orange-600' : 'bg-orange-500/20 text-orange-300')}`}>
                                            {lyricsSource === 'online' ? '优先使用在线歌词' : '强制回退服务器歌词'}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className={`px-6 py-4 border-t ${borderColor} flex justify-end gap-3`}>
                    <button onClick={handleNoMatch} className={`px-5 py-2 ${noMatchBtnBg} text-red-400 border rounded-lg transition-colors mr-auto text-sm`}>
                        不使用在线匹配
                    </button>
                    <button onClick={onClose} className={`px-5 py-2 ${cancelBtnBg} rounded-lg transition-colors ${textPrimary} text-sm`}>
                        取消
                    </button>
                    <button onClick={handleConfirm} disabled={!selectedResult || isMatching} className="px-5 py-2 bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm text-white">
                        {isMatching ? <><Loader2 className="animate-spin" size={14} />保存...</> : '保存匹配'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default NaviLyricMatchModal;
