import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Loader2, X, Music, Check } from 'lucide-react';
import { LocalSong, SongResult, LyricData } from '../types';
import { neteaseApi } from '../services/netease';
import { parseLRC } from '../utils/lrcParser';
import { parseYRC } from '../utils/yrcParser';
import { detectChorusLines } from '../utils/chorusDetector';
import { saveLocalSong, removeFromCache } from '../services/db';
import { formatSongName } from '../utils/songNameFormatter';

interface LyricMatchModalProps {
    song: LocalSong;
    onClose: () => void;
    onMatch: () => void;
    isDaylight: boolean;
}

const LyricMatchModal: React.FC<LyricMatchModalProps> = ({ song, onClose, onMatch, isDaylight }) => {
    const { t } = useTranslation();

    // Dynamic theme classes based on isDaylight
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
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<SongResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedResult, setSelectedResult] = useState<SongResult | null>(null);
    const [isMatching, setIsMatching] = useState(false);

    // Initialize search query with song metadata
    useEffect(() => {
        const initialQuery = song.artist
            ? `${song.artist} ${song.title}`
            : song.title || song.fileName.replace(/\.(mp3|flac|m4a|wav|ogg|opus|aac)$/i, '');
        setSearchQuery(initialQuery);
        handleSearch(initialQuery);
    }, [song]);

    // Helper function to normalize title for comparison
    const normalizeTitle = (title: string): string => {
        return title
            .toLowerCase()
            .trim()
            .replace(/[^\w\s\u4e00-\u9fa5]/g, '') // Remove punctuation except Chinese characters
            .replace(/\s+/g, ''); // Remove all whitespace
    };

    // Helper function to check if two titles match
    const isTitleMatch = (localTitle: string, searchTitle: string): boolean => {
        const normalizedLocal = normalizeTitle(localTitle);
        const normalizedSearch = normalizeTitle(searchTitle);
        return normalizedLocal === normalizedSearch;
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

                // Try to find a song with matching title
                const localTitle = song.title || song.fileName.replace(/\.(mp3|flac|m4a|wav|ogg|opus|aac)$/i, '');
                const exactMatch = res.result.songs.find(s => isTitleMatch(localTitle, s.name));

                if (exactMatch) {
                    // Auto-select the exact match
                    setSelectedResult(exactMatch);
                    console.log(`[LyricMatchModal] Auto-selected exact title match: ${exactMatch.name}`);
                } else {
                    // No exact match found, user will need to select manually
                    console.log(`[LyricMatchModal] No exact title match found for: "${localTitle}". User selection required.`);
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
            // Fetch lyrics for selected song
            const lyricRes = await neteaseApi.getLyric(selectedResult.id);
            const yrcLrc = lyricRes.yrc?.lyric || lyricRes.lrc?.yrc?.lyric;
            const mainLrc = lyricRes.lrc?.lyric;
            const ytlrc = lyricRes.ytlrc?.lyric || lyricRes.lrc?.ytlrc?.lyric;
            const tlyric = lyricRes.tlyric?.lyric || "";

            const transLrc = (yrcLrc && ytlrc) ? ytlrc : tlyric;

            let parsedLyrics: LyricData | null = null;
            if (yrcLrc) {
                parsedLyrics = parseYRC(yrcLrc, transLrc);
            } else if (mainLrc) {
                parsedLyrics = parseLRC(mainLrc, transLrc);
            }

            // Add chorus detection
            if (parsedLyrics && !lyricRes.pureMusic && !lyricRes.lrc?.pureMusic && mainLrc) {
                const chorusLines = detectChorusLines(mainLrc);
                if (chorusLines.size > 0) {
                    const effectMap = new Map<string, 'bars' | 'circles' | 'beams'>();
                    const effects: ('bars' | 'circles' | 'beams')[] = ['bars', 'circles', 'beams'];

                    chorusLines.forEach(text => {
                        const randomEffect = effects[Math.floor(Math.random() * effects.length)];
                        effectMap.set(text, randomEffect);
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

            // Update local song with matched lyrics
            song.matchedSongId = selectedResult.id;
            song.matchedArtists = selectedResult.ar?.map(a => a.name).join(', ');
            song.matchedAlbumId = selectedResult.al?.id || selectedResult.album?.id;
            song.matchedAlbumName = selectedResult.al?.name || selectedResult.album?.name;
            song.matchedLyrics = parsedLyrics || undefined;
            // Get cover URL from matched song
            const coverUrl = selectedResult.al?.picUrl || selectedResult.album?.picUrl;
            if (coverUrl) {
                song.matchedCoverUrl = coverUrl.replace('http:', 'https:');
            }
            song.hasManualLyricSelection = true;
            await saveLocalSong(song);

            // Remove old cached cover to force refresh on next play
            await removeFromCache(`cover_local_${song.id}`);

            onMatch();
        } catch (error) {
            console.error('Failed to match lyrics or save song:', error);
            alert(t('localMusic.matchFailed'));
        } finally {
            setIsMatching(false);
        }
    };

    const handleNoMatch = async () => {
        try {
            // Set noAutoMatch flag to true
            song.noAutoMatch = true;
            await saveLocalSong(song);
            onClose();
        } catch (error) {
            console.error('Failed to save song:', error);
            alert(t('localMusic.matchFailed'));
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xl flex items-center justify-center p-6">
            <div className={`${bgClass} border rounded-2xl max-w-2xl w-full max-h-[80vh] flex flex-col shadow-2xl backdrop-blur-md`}>
                {/* Header */}
                <div className={`p-6 border-b ${borderColor} flex items-center justify-between`}>
                    <div>
                        <h2 className={`text-xl font-bold ${textPrimary}`}>{t('localMusic.matchLyrics')}</h2>
                        <p className={`text-sm ${textSecondary} mt-1`}>
                            {t('localMusic.matchLyricsDescription')} <span className="font-semibold">{song.title || song.fileName}</span>
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className={`p-2 ${closeBtnHover} rounded-lg transition-colors ${textPrimary}`}
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Search Bar */}
                <div className={`p-6 border-b ${borderColor}`}>
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
                            className={`w-full ${inputBg} border rounded-lg py-3 pl-10 pr-4 focus:outline-none transition-all ${textPrimary}`}
                            autoFocus
                        />
                        <Search className={`absolute left-3 top-1/2 -translate-y-1/2 opacity-40 ${textSecondary}`} size={18} />
                        <button
                            type="submit"
                            disabled={isSearching}
                            className={`absolute right-2 top-1/2 -translate-y-1/2 px-4 py-1.5 ${searchBtnBg} rounded-md text-sm transition-colors disabled:opacity-50`}
                        >
                            {isSearching ? t('localMusic.searching') : t('localMusic.search')}
                        </button>
                    </form>
                </div>

                {/* Search Results */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                    {isSearching ? (
                        <div className="flex justify-center items-center h-40">
                            <Loader2 className="animate-spin opacity-50" size={32} />
                        </div>
                    ) : searchResults.length === 0 ? (
                        <div className={`flex flex-col items-center justify-center h-40 opacity-50 ${textSecondary}`}>
                            <Music size={48} className="mb-3" />
                            <p>{t('localMusic.noResults')}</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {searchResults.map((result) => (
                                <div
                                    key={result.id}
                                    onClick={() => setSelectedResult(result)}
                                    className={`flex items-center gap-4 p-4 rounded-lg cursor-pointer transition-all border ${selectedResult?.id === result.id
                                        ? resultItemSelected
                                        : resultItemBg
                                        }`}
                                >
                                    {/* Album Cover */}
                                    <div className="w-12 h-12 rounded-lg overflow-hidden bg-zinc-800 flex-shrink-0">
                                        {result.al?.picUrl || result.album?.picUrl ? (
                                            <img
                                                src={(result.al?.picUrl || result.album?.picUrl || '').replace('http:', 'https:')}
                                                alt={result.name}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center">
                                                <Music size={20} className="opacity-20" />
                                            </div>
                                        )}
                                    </div>

                                    {/* Song Info */}
                                    <div className="flex-1 min-w-0">
                                        <div className={`font-semibold truncate ${textPrimary}`}>{formatSongName(result)}</div>
                                        <div className={`text-sm truncate ${textSecondary}`}>
                                            {result.ar?.map(a => a.name).join(', ')} • {result.al?.name || result.album?.name}
                                        </div>
                                    </div>

                                    {/* Selection Indicator */}
                                    {selectedResult?.id === result.id && (
                                        <Check size={20} className="text-blue-400 flex-shrink-0" />
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className={`p-6 border-t ${borderColor} flex justify-end gap-3`}>
                    <button
                        onClick={onClose}
                        className={`px-6 py-2 ${cancelBtnBg} rounded-lg transition-colors ${textPrimary}`}
                    >
                        {t('localMusic.cancel')}
                    </button>
                    <button
                        onClick={handleNoMatch}
                        className={`px-6 py-2 ${noMatchBtnBg} text-red-400 border rounded-lg transition-colors mr-auto`}
                    >
                        {t('localMusic.dontUseOnlineMetadata')}
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!selectedResult || isMatching}
                        className="px-6 py-2 bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isMatching ? (
                            <>
                                <Loader2 className="animate-spin" size={16} />
                                <span>{t('localMusic.matching')}</span>
                            </>
                        ) : (
                            t('localMusic.confirmMatch')
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default LyricMatchModal;
