import React, { useEffect, useRef, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { UnifiedSong, ReplayGainMode } from '../../types';
import { FileAudio, RefreshCw, FileText, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import LyricTimelineOffsetControl from './LyricTimelineOffsetControl';
import { getLyricProviderLabel } from '../../utils/lyrics/lyricSourceLabels';
import { getLocalSongs } from '../../services/db';
import type { LocalSong } from '../../types';
import { isLocalPlaybackSong } from '../../utils/appPlaybackGuards';
import ReplayGainControl from './ReplayGainControl';

interface LocalTabProps {
    currentSong: UnifiedSong;
    onMatchOnline: () => void;
    onUpdateLocalLyrics: (content: string, isTranslation: boolean, fileName?: string) => void;
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

    const [loadedLocalData, setLoadedLocalData] = useState<{
        songId: string;
        data: LocalSong | null;
    } | null>(null);
    const localSongId = currentSong.localRef?.songId;
    const isLocalSong = isLocalPlaybackSong(currentSong);
    const isLocalDataLoading = Boolean(localSongId && loadedLocalData?.songId !== localSongId);
    const localData = loadedLocalData && loadedLocalData.songId === localSongId
        ? loadedLocalData.data
        : null;

    useEffect(() => {
        let active = true;
        if (!localSongId) {
            return;
        }
        void getLocalSongs().then(songs => {
            if (active) {
                setLoadedLocalData({
                    songId: localSongId,
                    data: songs.find(song => song.id === localSongId) || null,
                });
            }
        });
        return () => { active = false; };
    }, [localSongId]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, isTranslation: boolean) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            if (content) {
                onUpdateLocalLyrics(content, isTranslation, file.name);
            }
        };
        reader.readAsText(file);

        // Reset input
        e.target.value = '';
    };

    // Compute available lyrics sources
    const availableSources = useMemo(() => {
        const sources: { key: 'local' | 'embedded' | 'online'; label: string }[] = [];
        if (!localData) return sources;
        if (localData.hasLocalLyrics) {
            sources.push({ key: 'local', label: t('localMusic.statusLocal') });
        }
        if (localData.hasEmbeddedLyrics) {
            sources.push({ key: 'embedded', label: t('localMusic.statusEmbedded') });
        }
        if ((localData.matchedLyrics?.lines?.length ?? 0) > 0) {
            sources.push({ key: 'online', label: getLyricProviderLabel(localData.matchedLyricsSource, localData.matchedLyricsProviderPlatform) });
        }
        return sources;
    }, [localData, t]);

    // Determine currently active source
    const activeSource = useMemo(() => {
        if (!localData) return null;
        if (localData.lyricsSource) return localData.lyricsSource;
        // Default priority: local > embedded > online
        if (localData.hasLocalLyrics) return 'local';
        if (localData.hasEmbeddedLyrics) return 'embedded';
        if ((localData.matchedLyrics?.lines?.length ?? 0) > 0) return 'online';
        return null;
    }, [localData]);

    const tabActiveBg = isDaylight ? 'bg-blue-500/15 text-blue-600' : 'bg-blue-500/20 text-blue-300';
    const tabInactiveBg = isDaylight ? 'bg-black/5 text-zinc-500 hover:bg-black/10' : 'bg-white/5 text-zinc-400 hover:bg-white/10';
    const lyricsStatus = useMemo(() => {
        const states: string[] = [];
        if (!localData) return t('localMusic.statusNone');
        if (localData.hasLocalLyrics) states.push(t('localMusic.statusLocal'));
        if (localData.hasEmbeddedLyrics) states.push(t('localMusic.statusEmbedded'));
        if ((localData.matchedLyrics?.lines?.length ?? 0) > 0) {
            states.push(getLyricProviderLabel(localData.matchedLyricsSource, localData.matchedLyricsProviderPlatform));
        }
        return states.length > 0 ? states.join(' / ') : t('localMusic.statusNone');
    }, [localData, t]);
    if (!isLocalSong) {
        return <div className="min-h-96" aria-hidden="true" />;
    }

    if (isLocalDataLoading) {
        return <div className="min-h-96" aria-busy="true" />;
    }

    if (!localData) {
        return (
            <div className="flex min-h-96 items-center justify-center px-4 text-center opacity-60">
                {t('status.localSongNotInLibrary')}
            </div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex min-h-96 flex-col space-y-6 pt-4 px-2"
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

            <ReplayGainControl
                values={{
                    trackGain: localData.replayGainTrackGain ?? localData.replayGain,
                    albumGain: localData.replayGainAlbumGain,
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
                            accept=".lrc,.vtt,.ttml,.qrc,.yrc,.krc,.txt"
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
