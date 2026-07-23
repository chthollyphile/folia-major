import React from 'react';
import { motion } from 'framer-motion';
import { ReplayGainMode, SongResult } from '../../types';
import { RefreshCw, FileText, Cloud } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import LyricTimelineOffsetControl from './LyricTimelineOffsetControl';
import { getLyricProviderLabel } from '../../utils/lyrics/lyricSourceLabels';
import { resolveNavidromePlaybackCarrier } from '../../utils/appPlaybackGuards';
import ReplayGainControl from './ReplayGainControl';

interface NaviTabProps {
    currentSong: SongResult;
    hasLyrics: boolean;
    onMatchOnline: () => void;
    lyricTimelineOffsetMs: number;
    onLyricTimelineOffsetChange: (offsetMs: number) => void;
    replayGainMode: ReplayGainMode;
    onChangeReplayGainMode: (mode: ReplayGainMode) => void;
    isDaylight: boolean;
}

const NaviTab: React.FC<NaviTabProps> = ({
    currentSong,
    hasLyrics,
    onMatchOnline,
    lyricTimelineOffsetMs,
    onLyricTimelineOffsetChange,
    replayGainMode,
    onChangeReplayGainMode,
    isDaylight,
}) => {
    const { t } = useTranslation();
    const navidromeSong = resolveNavidromePlaybackCarrier(currentSong);
    const navidromeData = navidromeSong?.navidromeData;

    if (!navidromeSong || !navidromeData) {
        return (
            <div className="flex items-center justify-center h-full opacity-60">
                {t('localMusic.notALocalSong')}
            </div>
        );
    }

    // The unified player song retains the original Navidrome metadata carrier for lyric and gain details.
    const matchedLyrics = navidromeSong.matchedLyrics;
    const songLyricsSource = navidromeSong.lyricsSource;
    const matchedLyricsSource = navidromeSong.matchedLyricsSource;
    const matchedLyricsProviderPlatform = navidromeSong.matchedLyricsProviderPlatform;
    const hasMatchedLyrics = (matchedLyrics?.lines?.length ?? 0) > 0;
    const isOnline = hasMatchedLyrics && songLyricsSource === 'online';
    
    let lyricsSourceLabel = t('localMusic.statusNone');
    if (isOnline) {
        lyricsSourceLabel = getLyricProviderLabel(matchedLyricsSource, matchedLyricsProviderPlatform);
    } else if (hasLyrics) {
        lyricsSourceLabel = t('navidrome.server');
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

            <ReplayGainControl
                values={{
                    trackGain: navidromeData.replayGain?.trackGain,
                    albumGain: navidromeData.replayGain?.albumGain,
                }}
                mode={replayGainMode}
                onChangeMode={onChangeReplayGainMode}
                isDaylight={isDaylight}
            />

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
                        <span className="text-sm">{t('localMusic.lyricsSource')}</span>
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

                <LyricTimelineOffsetControl
                    offsetMs={lyricTimelineOffsetMs}
                    onOffsetChange={onLyricTimelineOffsetChange}
                    isDaylight={isDaylight}
                />
            </div>
        </motion.div>
    );
};

export default NaviTab;
