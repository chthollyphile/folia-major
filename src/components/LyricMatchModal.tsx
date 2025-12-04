import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Loader2, X, Music, Check } from 'lucide-react';
import { LocalSong, SongResult, LyricData } from '../types';
import { neteaseApi } from '../services/netease';
import { parseLRC } from '../utils/lrcParser';
import { parseYRC } from '../utils/yrcParser';
import { detectChorusLines } from '../utils/chorusDetector';
import { saveLocalSong } from '../services/db';
import { formatSongName } from '../utils/songNameFormatter';

interface LyricMatchModalProps {
    song: LocalSong;
    onClose: () => void;
    onMatch: () => void;
}

const LyricMatchModal: React.FC<LyricMatchModalProps> = ({ song, onClose, onMatch }) => {
    const { t } = useTranslation();
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

    const handleSearch = async (query?: string) => {
        const q = query || searchQuery;
        if (!q.trim()) return;

        setIsSearching(true);
        setSearchResults([]);

        try {
            const res = await neteaseApi.cloudSearch(q);
            if (res.result?.songs) {
                setSearchResults(res.result.songs);
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
            const mainLrc = lyricRes.lrc?.lyric;
            const yrcLrc = lyricRes.yrc?.lyric || lyricRes.lrc?.yrc?.lyric;
            const transLrc = lyricRes.tlyric?.lyric || "";

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

            onMatch();
        } catch (error) {
            console.error('Failed to fetch lyrics:', error);
            alert('Failed to fetch lyrics for selected song');
        } finally {
            setIsMatching(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-center justify-center p-6">
            <div className="bg-zinc-900/95 border border-white/10 rounded-2xl max-w-2xl w-full max-h-[80vh] flex flex-col shadow-2xl">
                {/* Header */}
                <div className="p-6 border-b border-white/10 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold">Match Lyrics</h2>
                        <p className="text-sm opacity-60 mt-1">
                            Search and select the correct song for: <span className="font-semibold">{song.title || song.fileName}</span>
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Search Bar */}
                <div className="p-6 border-b border-white/10">
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
                            placeholder="Search for song..."
                            className="w-full bg-white/5 border border-white/10 rounded-lg py-3 pl-10 pr-4 focus:outline-none focus:bg-white/10 focus:border-white/20 transition-all"
                            autoFocus
                        />
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" size={18} />
                        <button
                            type="submit"
                            disabled={isSearching}
                            className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded-md text-sm transition-colors disabled:opacity-50"
                        >
                            {isSearching ? 'Searching...' : 'Search'}
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
                        <div className="flex flex-col items-center justify-center h-40 opacity-50">
                            <Music size={48} className="mb-3" />
                            <p>No results found. Try a different search query.</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {searchResults.map((result) => (
                                <div
                                    key={result.id}
                                    onClick={() => setSelectedResult(result)}
                                    className={`flex items-center gap-4 p-4 rounded-lg cursor-pointer transition-all border ${selectedResult?.id === result.id
                                        ? 'bg-blue-500/20 border-blue-500/50'
                                        : 'bg-white/5 hover:bg-white/10 border-white/5'
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
                                        <div className="font-semibold truncate">{formatSongName(result)}</div>
                                        <div className="text-sm opacity-60 truncate">
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
                <div className="p-6 border-t border-white/10 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!selectedResult || isMatching}
                        className="px-6 py-2 bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isMatching ? (
                            <>
                                <Loader2 className="animate-spin" size={16} />
                                <span>Matching...</span>
                            </>
                        ) : (
                            'Confirm Match'
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default LyricMatchModal;
