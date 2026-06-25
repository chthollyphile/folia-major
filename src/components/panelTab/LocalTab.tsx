import React, { useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { UnifiedSong, ReplayGainMode } from '../../types';
import { FileAudio, RefreshCw, FileText, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import LyricTimelineOffsetControl from './LyricTimelineOffsetControl';

interface LocalTabProps {
    currentSong: UnifiedSong;
    onMatchOnline: () => void;
    onUpdateLocalLyrics: (content: string, isTranslation: boolean) => void;
    onChangeLyricsSource: (source: 'local' | 'embedded' | 'online') => void;
    replayGainMode: ReplayGainMode;
    onChangeReplayGainMode: (mode: ReplayGainMode) => void;
    lyricTimelineOffsetMs: number;
    onLyricTimelineOffsetChange: (offsetMs: number) => void;
    isDaylight: boolean;
}

const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const LocalTab: React.FC<LocalTabProps> = ({
    currentSong,
    onMatchOnline,
    onUpdateLocalLyrics,
    onChangeLyricsSource,
    replayGainMode,
    onChangeReplayGainMode,
    lyricTimelineOffsetMs,
    onLyricTimelineOffsetChange,
    isDaylight
}) => {
    const { t } = useTranslation();
    const lrcInputRef = useRef<HTMLInputElement>(null);

    const localData = currentSong.localData;

    if (!currentSong.isLocal || !localData) {
        return (
            <div className="flex items-center justify-center h-full opacity-60">
                {t('localMusic.notALocalSong')}
            </div>
        );
    }

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, isTranslation: boolean) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            if (content) {
                onUpdateLocalLyrics(content, isTranslation);
            }
        };
        reader.readAsText(file);

        // Reset input
        e.target.value = '';
    };

    // Helper to get platform source label
    const getOnlineSourceLabel = (src?: 'netease' | 'qq' | 'kugou') => {
        if (src === 'qq') return 'QQ 音乐';
        if (src === 'kugou') return '酷狗音乐';
        return '网易云音乐';
    };

    // Compute available lyrics sources
    const availableSources = useMemo(() => {
        const sources: { key: 'local' | 'embedded' | 'online'; label: string }[] = [];
        if (localData.hasLocalLyrics) {
            sources.push({ key: 'local', label: t('localMusic.statusLocal') });
        }
        if (localData.hasEmbeddedLyrics) {
            sources.push({ key: 'embedded', label: t('localMusic.statusEmbedded') });
        }
        if ((localData.matchedLyrics?.lines?.length ?? 0) > 0) {
            sources.push({ key: 'online', label: getOnlineSourceLabel(localData.matchedLyricsSource) });
        }
        return sources;
    }, [localData, t]);

    // Determine currently active source
    const activeSource = useMemo(() => {
        if (localData.lyricsSource) return localData.lyricsSource;
        // Default priority: local > embedded > online
        if (localData.hasLocalLyrics) return 'local';
        if (localData.hasEmbeddedLyrics) return 'embedded';
        if ((localData.matchedLyrics?.lines?.length ?? 0) > 0) return 'online';
        return null;
    }, [localData]);

    // Style helpers
    const tabActiveBg = isDaylight ? 'bg-blue-500/15 text-blue-600' : 'bg-blue-500/20 text-blue-300';
    const tabInactiveBg = isDaylight ? 'bg-black/5 text-zinc-500 hover:bg-black/10' : 'bg-white/5 text-zinc-400 hover:bg-white/10';
    const replayGainModes: { key: ReplayGainMode; label: string; }[] = [
        { key: 'off', label: t('localMusic.replayGainOff') },
        { key: 'track', label: t('localMusic.replayGainTrack') },
        { key: 'album', label: t('localMusic.replayGainAlbum') }
    ];
    const lyricsStatus = useMemo(() => {
        const states: string[] = [];
        if (localData.hasLocalLyrics) states.push(t('localMusic.statusLocal'));
        if (localData.hasEmbeddedLyrics) states.push(t('localMusic.statusEmbedded'));
        if ((localData.matchedLyrics?.lines?.length ?? 0) > 0) {
            states.push(getOnlineSourceLabel(localData.matchedLyricsSource));
        }
        return states.length > 0 ? states.join(' / ') : t('localMusic.statusNone');
    }, [localData, t]);
    const replayGainSummary = useMemo(() => {
        const parts: string[] = [];
        if (typeof localData.replayGainTrackGain === 'number') {
            parts.push(`T ${localData.replayGainTrackGain > 0 ? '+' : ''}${localData.replayGainTrackGain.toFixed(1)} dB`);
        }
        if (typeof localData.replayGainAlbumGain === 'number') {
            parts.push(`A ${localData.replayGainAlbumGain > 0 ? '+' : ''}${localData.replayGainAlbumGain.toFixed(1)} dB`);
        }
        return parts.length > 0 ? parts.join(' / ') : t('localMusic.replayGainUnavailable');
    }, [localData, t]);

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col space-y-6 pt-4 px-2"
        >
            {/* File Info */}
            <div className="space-y-3">
                <h3 className="text-sm font-semibold opacity-50 uppercase tracking-wider flex items-center gap-2">
                    <FileAudio size={14} /> {t('localMusic.fileInfo')}
                </h3>
                <div className="bg-white/5 rounded-xl p-3 space-y-2 text-sm">
                    <div className="flex justify-between">
                        <span className="opacity-60">{t('localMusic.filename')}</span>
                        <span className="font-mono text-xs opacity-80 truncate max-w-[150px]" title={localData.fileName}>
                            {localData.fileName}
                        </span>
                    </div>
                    <div className="flex justify-between">
                        <span className="opacity-60">{t('localMusic.size')}</span>
                        <span className="font-mono text-xs opacity-80 truncate max-w-[150px]" title={`${formatBytes(localData.fileSize)}${localData.bitrate ? ` / ${Math.round(localData.bitrate / 1000)} kbps` : ''}`}>
                            {formatBytes(localData.fileSize)}{localData.bitrate && ` / ${Math.round(localData.bitrate / 1000)} kbps`}
                        </span>
                    </div>
                    <div className="flex justify-between">
                        <span className="opacity-60">{t('localMusic.lyrics')}</span>
                        <span className="text-xs opacity-80 truncate max-w-[150px]" title={lyricsStatus}>
                            {lyricsStatus}
                        </span>
                    </div>
                </div>
            </div>

            {/* ReplayGain */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold opacity-50 uppercase tracking-wider">
                        音频增益
                    </h3>
                    <span className="text-[11px] opacity-60 text-right">
                        {replayGainSummary}
                    </span>
                </div>
                <div className="flex gap-1.5">
                    {replayGainModes.map((mode) => (
                        <button
                            key={mode.key}
                            onClick={() => onChangeReplayGainMode(mode.key)}
                            className={`flex-1 text-xs py-1.5 px-2 rounded-lg font-medium transition-all ${
                                replayGainMode === mode.key ? tabActiveBg : tabInactiveBg
                            }`}
                        >
                            {mode.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Lyrics Management */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold opacity-50 uppercase tracking-wider flex items-center gap-2">
                        <FileText size={14} /> {t('localMusic.lyrics')}
                    </h3>
                    <div className="flex items-center gap-1.5">
                        <button
                            onClick={() => lrcInputRef.current?.click()}
                            className="p-1.5 hover:bg-white/10 rounded-md transition-colors"
                            title={t('localMusic.selectLrcFile')}
                        >
                            <Upload size={14} />
                        </button>
                        <input
                            type="file"
                            accept=".lrc,.txt"
                            ref={lrcInputRef}
                            className="hidden"
                            onChange={(e) => handleFileChange(e, false)}
                        />
                        <button
                            onClick={onMatchOnline}
                            className="px-3 py-1 bg-white/10 hover:bg-white/20 active:bg-white/30 transition-colors rounded-lg text-xs font-medium flex items-center gap-1.5"
                        >
                            <RefreshCw size={12} />
                            {t('localMusic.matchOnline')}
                        </button>
                    </div>
                </div>

                {/* Lyrics Source Selector */}
                {availableSources.length === 0 ? (
                    <div className={`text-xs px-3 py-2 rounded-lg bg-white/5 ${isDaylight ? 'text-zinc-400' : 'text-zinc-500'}`}>
                        {t('localMusic.statusNone')}
                    </div>
                ) : availableSources.length === 1 ? (
                    <div className={`text-xs px-3 py-2 rounded-lg ${tabActiveBg} font-medium`}>
                        {availableSources[0].label}
                    </div>
                ) : (
                    <div className="flex gap-1.5">
                        {availableSources.map((source) => (
                            <button
                                key={source.key}
                                onClick={() => onChangeLyricsSource(source.key)}
                                className={`flex-1 text-xs py-1.5 px-2 rounded-lg font-medium transition-all ${
                                    activeSource === source.key ? tabActiveBg : tabInactiveBg
                                }`}
                            >
                                {source.label}
                            </button>
                        ))}
                    </div>
                )}

                <LyricTimelineOffsetControl
                    offsetMs={lyricTimelineOffsetMs}
                    onOffsetChange={onLyricTimelineOffsetChange}
                    isDaylight={isDaylight}
                />
            </div>
        </motion.div>
    );
};

export default LocalTab;
