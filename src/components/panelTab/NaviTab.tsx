import React from 'react';
import { motion } from 'framer-motion';
import { NavidromeSong } from '../../types/navidrome';
import { RefreshCw, FileText, Cloud } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface NaviTabProps {
    currentSong: NavidromeSong;
    hasLyrics: boolean;
    onMatchOnline: () => void;
    isDaylight: boolean;
}

const NaviTab: React.FC<NaviTabProps> = ({ currentSong, hasLyrics, onMatchOnline, isDaylight }) => {
    const { t } = useTranslation();
    const navidromeData = currentSong.navidromeData;

    if (!currentSong.isNavidrome || !navidromeData) {
        return (
            <div className="flex items-center justify-center h-full opacity-60">
                {t('localMusic.notALocalSong')}
            </div>
        );
    }

    // We determine source:
    // If hasManualLyricSelection is true AND useOnlineLyrics is not explicitly false -> "在线" (Online matched)
    // Else if hasLyrics is true -> "navi" (Navidrome native)
    // Else -> "无" (None)
    
    // Check if the current song is using online matched lyrics
    // We can assume it if hasManualLyricSelection is true and useOnlineLyrics !== false
    const matchData = (currentSong as any).navidromeMatchData; // Wait, we didn't inject this yet. Let's rely on basic logic or inject it.
    // Wait, the user said they can later choose to enable online matching. The App.tsx will apply the matched lyrics.
    // If it's a Navidrome song, we don't have matchedLyrics stored IN the song object natively by App.tsx unless we attach it.
    // Let's attach 'useOnlineLyrics', 'hasMatchedLyrics' in App.tsx when we build the Navidrome song, or use a new prop.
    // Let's assume currentSong has useOnlineLyrics attached, or we simply check:
    const matchedLyrics = currentSong.matchedLyrics || navidromeData?.matchedLyrics;
    const songLyricsSource = (currentSong as any).lyricsSource ?? (navidromeData as any)?.lyricsSource;
    const hasMatchedLyrics = (matchedLyrics?.lines?.length ?? 0) > 0;
    const isOnline = hasMatchedLyrics && songLyricsSource === 'online';
    
    let lyricsSourceLabel = '无';
    if (isOnline) {
        lyricsSourceLabel = '在线';
    } else if (hasLyrics) {
        lyricsSourceLabel = 'navi';
    }

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col space-y-6 pt-4 px-2"
        >
            {/* Server Info */}
            <div className="space-y-3">
                <h3 className="text-sm font-semibold opacity-50 uppercase tracking-wider flex items-center gap-2">
                    <Cloud size={14} /> Navidrome Server
                </h3>
                <div className="bg-white/5 rounded-xl p-3 space-y-2 text-sm">
                    <div className="flex justify-between">
                        <span className="opacity-60">Song ID</span>
                        <span className="font-mono text-xs opacity-80 truncate max-w-[150px]" title={navidromeData.id}>
                            {navidromeData.id}
                        </span>
                    </div>
                </div>
            </div>

            {/* Lyrics Management */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold opacity-50 uppercase tracking-wider flex items-center gap-2">
                        <FileText size={14} /> {t('localMusic.lyrics')}
                    </h3>
                    <button
                        onClick={onMatchOnline}
                        className="px-3 py-1 bg-white/10 hover:bg-white/20 active:bg-white/30 transition-colors rounded-lg text-xs font-medium flex items-center gap-1.5"
                    >
                        <RefreshCw size={12} />
                        {t('localMusic.matchOnline')}
                    </button>
                </div>

                {/* Status Indicator */}
                <div className="flex items-center justify-between bg-white/5 rounded-lg p-2 pl-3">
                    <div className="flex items-center gap-2">
                        <FileText size={16} className="opacity-60" />
                        <span className="text-sm">歌词来源</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${isOnline
                                ? isDaylight ? 'bg-[#1686eb]/10 text-[#1686eb]' : 'bg-blue-500/20 text-blue-300'
                                : (hasLyrics ? 'bg-green-500/20 text-green-300' : 'bg-white/10 opacity-60')
                            }`}>
                            {lyricsSourceLabel}
                        </span>
                    </div>
                </div>
            </div>
        </motion.div>
    );
};

export default NaviTab;
