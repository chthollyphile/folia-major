import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { OnlineLyricsState, ReplayGainMode, SongResult } from '../../types';
import { getOnlineLyricSourceLabel } from '../../utils/lyrics/lyricSourceLabels';
import { omni } from '../../services/onlineMusic/omni';
import SourceTab from './SourceTab';

// src/components/panelTab/OnlineLyricsTab.tsx
// The song's tab for a song of an online platform: hands SourceTab what it shows for it.

interface OnlineLyricsTabProps {
    song: SongResult;
    onlineLyricsState: OnlineLyricsState | null;
    onImportLyrics: (content: string, fileName: string) => void;
    onChangeLyricsSource: (source: 'online' | 'imported') => void;
    onMatchOnlineLyrics: () => void;
    onClearOnlineLyricsState: () => void;
    lyricTimelineOffsetMs: number;
    onLyricTimelineOffsetChange: (offsetMs: number) => void;
    replayGainMode: ReplayGainMode;
    onChangeReplayGainMode: (mode: ReplayGainMode) => void;
    isDaylight: boolean;
}

const OnlineLyricsTab: React.FC<OnlineLyricsTabProps> = ({
    song,
    onlineLyricsState,
    onImportLyrics,
    onChangeLyricsSource,
    onMatchOnlineLyrics,
    onClearOnlineLyricsState,
    lyricTimelineOffsetMs,
    onLyricTimelineOffsetChange,
    replayGainMode,
    onChangeReplayGainMode,
    isDaylight,
}) => {
    const { t } = useTranslation();

    const hasImportedLyrics = Boolean(onlineLyricsState?.importedLyrics);
    const hasOverride = Boolean(onlineLyricsState?.hasOnlineOverride || onlineLyricsState?.importedLyrics);
    const activeSource = onlineLyricsState?.lyricsSource === 'imported' && hasImportedLyrics ? 'imported' : 'online';

    const onlineSourceLabel = useMemo(() => {
        const providerId = song.sourceRef?.kind === 'online' ? song.sourceRef.providerId : undefined;
        return getOnlineLyricSourceLabel(song, onlineLyricsState, providerId ? omni.getProviderLabel(providerId) : '');
    }, [onlineLyricsState, song]);

    const availableSources = useMemo(
        () => (hasImportedLyrics
            ? [
                { key: 'online' as const, label: onlineSourceLabel },
                { key: 'imported' as const, label: t('localMusic.statusImported') },
            ]
            : [{ key: 'online' as const, label: onlineSourceLabel }]),
        [hasImportedLyrics, onlineSourceLabel, t],
    );

    return (
        <SourceTab
            key={song.id}
            lyricSources={availableSources}
            activeLyricSource={activeSource}
            onChangeLyricSource={onChangeLyricsSource}
            onClearLyrics={hasOverride ? onClearOnlineLyricsState : undefined}
            onMatchOnline={onMatchOnlineLyrics}
            onImportLyrics={onImportLyrics}
            gainValues={song.replayGain}
            replayGainMode={replayGainMode}
            onChangeReplayGainMode={onChangeReplayGainMode}
            lyricTimelineOffsetMs={lyricTimelineOffsetMs}
            onLyricTimelineOffsetChange={onLyricTimelineOffsetChange}
            isDaylight={isDaylight}
        />
    );
};

export default OnlineLyricsTab;
