import React, { useEffect, useMemo, useState } from 'react';
import { UnifiedSong, ReplayGainMode } from '../../types';
import { FileAudio, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getLyricProviderLabel } from '../../utils/lyrics/lyricSourceLabels';
import { detectLyricFileIssues } from '../../utils/lyrics/lyricFileIssues';
import { getLocalSongs } from '../../services/db';
import type { LocalSong } from '../../types';
import { isLocalPlaybackSong } from '../../utils/appPlaybackGuards';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import SourceTab from './SourceTab';
import { EmptyState } from './shell/EmptyState';

// src/components/panelTab/LocalTab.tsx
// The song's tab for a local file: reads the song's record from the library and hands SourceTab
// what it shows for it.

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
    const activeSource = usePlaybackStore(state => state.activeLocalLyricsSource);

    const [loadedLocalData, setLoadedLocalData] = useState<{
        songId: string;
        data: LocalSong | null;
    } | null>(null);
    const localSongId = currentSong.localRef?.songId;
    const isLocalSong = isLocalPlaybackSong(currentSong);
    const isLocalDataLoading = Boolean(localSongId && loadedLocalData?.songId !== localSongId);
    // While the playing song's record is being read, the record read last stays on screen, out of
    // reach: the panel is as tall as its tab, so an empty moment would fold it and open it again.
    const localData = localSongId ? loadedLocalData?.data ?? null : null;

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
    // Source changes keep the same local song id, but the controller refreshes the current-song
    // snapshot after persisting them. Re-read the record so this panel does not keep stale source UI.
    }, [localSongId, currentSong]);

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
        } else if (sources.length === 0 && localData.markedPureMusic) {
            // A song marked instrumental has no lyrics on purpose: its row says so. A lone entry is
            // shown as a name, not as a choice, so its key is never picked.
            sources.push({ key: 'online', label: t('localMusic.statusPureMusic') });
        }
        return sources;
    }, [localData, t]);
    const localLyricFileIssues = useMemo(
        () => detectLyricFileIssues(localData?.localLyricsContent, localData?.localLyricsFormat),
        [localData?.localLyricsContent, localData?.localLyricsFormat]
    );

    if (!isLocalSong) {
        return null;
    }

    // Nothing has been read yet.
    if (localSongId && !loadedLocalData) {
        return <div aria-busy="true" />;
    }

    if (!localData) {
        return (
            <EmptyState icon={<FileAudio size={28} />}>
                {t('status.localSongNotInLibrary')}
            </EmptyState>
        );
    }

    return (
        <div inert={isLocalDataLoading}>
            {activeSource === 'local' && localLyricFileIssues.includes('translation-shifted-to-end-time') && (
                <div
                    role="alert"
                    className={`mx-1 mb-2 space-y-1.5 rounded-[10px] px-3 py-2.5 text-xs leading-relaxed ${isDaylight ? 'bg-amber-500/15 text-amber-800' : 'bg-amber-400/10 text-amber-200'}`}
                >
                    <div className="flex items-center gap-1.5 font-semibold">
                        <TriangleAlert size={13} className="shrink-0" />
                        {t('localMusic.lyricFileIssueShiftedTitle')}
                    </div>
                    <p className="opacity-90">{t('localMusic.lyricFileIssueShiftedBody')}</p>
                    <p className="opacity-90">{t('localMusic.lyricFileIssueShiftedFix')}</p>
                </div>
            )}
            <SourceTab
                key={localSongId}
                lyricSources={availableSources}
                activeLyricSource={activeSource}
                onChangeLyricSource={onChangeLyricsSource}
                onMatchOnline={onMatchOnline}
                onImportLyrics={(content, fileName) => onUpdateLocalLyrics(content, false, fileName)}
                gainValues={{
                    trackGain: localData.replayGainTrackGain ?? localData.replayGain,
                    albumGain: localData.replayGainAlbumGain,
                }}
                replayGainMode={replayGainMode}
                onChangeReplayGainMode={onChangeReplayGainMode}
                lyricTimelineOffsetMs={lyricTimelineOffsetMs}
                onLyricTimelineOffsetChange={onLyricTimelineOffsetChange}
                facts={[
                    { label: t('localMusic.filename'), value: localData.fileName },
                    {
                        label: t('localMusic.size'),
                        value: `${formatBytes(localData.fileSize)}${localData.bitrate ? ` / ${Math.round(localData.bitrate / 1000)} kbps` : ''}`,
                    },
                ]}
                isDaylight={isDaylight}
            />
        </div>
    );
};

export default LocalTab;
