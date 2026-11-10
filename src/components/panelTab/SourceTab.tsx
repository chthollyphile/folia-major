import React from 'react';
import { RotateCcw, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ReplayGainMode } from '../../types';
import LyricFileButton from './LyricFileButton';
import LyricTimelineOffsetControl from './LyricTimelineOffsetControl';
import ReplayGainControl, { type ReplayGainValues } from './ReplayGainControl';
import { FactList, type Fact } from './shell/FactList';
import { GroupLine } from './shell/GroupLine';
import { PanelButton } from './shell/PanelButton';
import { PanelIconButton } from './shell/PanelIconButton';
import { PanelRow } from './shell/PanelRow';
import { Segments } from './shell/Segments';

// src/components/panelTab/SourceTab.tsx
// The panel tab that follows the playing song, as one layout for every kind of song: where the
// lyrics come from, the timeline offset, online matching and the lyric file window, the audio gain,
// and what is known about the file. LocalTab, NaviTab and OnlineLyricsTab each work out these
// things for their kind of song and hand them over; a new kind of song is one more such file.
// Each of them keys this layout by the song: a number half typed in the offset field and an open
// lyric file window belong to one song, and go when another song starts.

type SourceTabProps<K extends string> = {
    /** Where this song's lyrics can come from. None: the row says so. One: its name. Several: a choice. */
    lyricSources: ReadonlyArray<{ key: K; label: string }>;
    /** The one in use, of several. */
    activeLyricSource?: K | null;
    onChangeLyricSource?: (source: K) => void;
    /** Takes away the lyric the listener put in place of the song's own. Given, its button shows. */
    onClearLyrics?: () => void;
    onMatchOnline: () => void;
    /** Left out for a song that cannot take a lyric file; the lyric file window then only exports. */
    onImportLyrics?: (content: string, fileName: string) => void;
    /** The gains measured for the song. */
    gainValues?: ReplayGainValues;
    replayGainMode: ReplayGainMode;
    onChangeReplayGainMode: (mode: ReplayGainMode) => void;
    lyricTimelineOffsetMs: number;
    onLyricTimelineOffsetChange: (offsetMs: number) => void;
    /** What is known about the song's file or its copy on a server. */
    facts?: ReadonlyArray<Fact>;
    isDaylight: boolean;
};

export const SourceTab = <K extends string>({
    lyricSources,
    activeLyricSource,
    onChangeLyricSource,
    onClearLyrics,
    onMatchOnline,
    onImportLyrics,
    gainValues,
    replayGainMode,
    onChangeReplayGainMode,
    lyricTimelineOffsetMs,
    onLyricTimelineOffsetChange,
    facts,
    isDaylight,
}: SourceTabProps<K>): React.ReactElement => {
    const { t } = useTranslation();

    return (
        <div>
            <PanelRow label={t('localMusic.lyrics')}>
                {onClearLyrics && (
                    <PanelIconButton size="s" label={t('localMusic.delete')} onClick={onClearLyrics}>
                        <RotateCcw size={15} />
                    </PanelIconButton>
                )}
                {lyricSources.length > 1 ? (
                    // '' stands for no source in use: none of the options is marked then.
                    <Segments<K | ''>
                        fill
                        value={activeLyricSource ?? ''}
                        onChange={(source) => {
                            if (source !== '') onChangeLyricSource?.(source);
                        }}
                        options={lyricSources.map(source => ({ value: source.key, label: source.label }))}
                    />
                ) : (
                    <span className="truncate text-[13px] text-[color:var(--st-t2)]">
                        {lyricSources[0]?.label ?? t('localMusic.statusNone')}
                    </span>
                )}
            </PanelRow>
            <LyricTimelineOffsetControl offsetMs={lyricTimelineOffsetMs} onOffsetChange={onLyricTimelineOffsetChange} />
            <div className="flex flex-wrap gap-2 px-1 py-2">
                <PanelButton grow icon={Search} onClick={onMatchOnline}>
                    {t('localMusic.matchOnline')}
                </PanelButton>
                <LyricFileButton isDaylight={isDaylight} onImportLyrics={onImportLyrics} />
            </div>

            <GroupLine />

            <ReplayGainControl values={gainValues} mode={replayGainMode} onChangeMode={onChangeReplayGainMode} />

            {facts && facts.length > 0 && (
                <>
                    <GroupLine />
                    <FactList facts={facts} />
                </>
            )}
        </div>
    );
};

export default SourceTab;
