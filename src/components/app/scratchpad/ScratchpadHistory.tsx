import React, { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, History, ListPlus, Music2, NotebookPen, Play, Star } from 'lucide-react';
import type { SongResult } from '../../../types';
import type { RecentPlay } from '../home/explore/recentPlays';
import { collectToScratchpad, useScratchpadStore } from '../../../stores/useScratchpadStore';
import { canOpenPlaylistPickerFor, openAddSongsToPlaylist } from '../../../stores/useAddToPlaylistStore';
import { getSongArtistLabel, getSongCoverUrl } from '../../../services/onlineMusic/songMetadata';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import { groupPlaysByDay, type HistoryDay } from './historyDays';
import { scratchpadSourceLabel } from './scratchpadModel';
import { useScratchpadHistory } from './useScratchpadHistory';
import type { ScratchpadPlayback } from './ScratchpadHost';

// src/components/app/scratchpad/ScratchpadHistory.tsx
// 速记簿的第二页：播放历史。最近七天在这台设备上放过的歌（Folia 自己的播放记录 recentPlays：在线平台、本地、
// Navidrome 合在一起），新的在前，按天分段；每一行写歌手 · 来源 · 几点几分，悬停出四颗：插进队列播放、加入队列、
// 加入速记簿（已经在里面时打勾、点不了）、收藏到歌单。

type ScratchpadHistoryProps = {
    playback: ScratchpadPlayback;
};

type HistoryRowProps = {
    song: SongResult;
    collected: boolean;
    timeLabel: string;
    sourceLabel: string;
    playback: ScratchpadPlayback;
};

const HistoryRow: React.FC<HistoryRowProps> = memo(({ song, collected, timeLabel, sourceLabel, playback }) => {
    const { t } = useTranslation();
    const [coverFailed, setCoverFailed] = useState(false);
    const coverUrl = getSongCoverUrl(song);
    const playLabel = t('scratchpad.play');
    const buttons = [
        { id: 'enqueue', label: t('scratchpad.enqueue'), icon: ListPlus, run: () => playback.enqueue(song), disabled: false },
        collected
            ? { id: 'collected', label: t('scratchpad.alreadyInOne'), icon: Check, run: () => undefined, disabled: true }
            : { id: 'collect', label: t('scratchpad.collect'), icon: NotebookPen, run: () => collectToScratchpad([song], { label: t('scratchpad.originHistory') }), disabled: false },
        ...(canOpenPlaylistPickerFor(song)
            ? [{ id: 'save-to-playlist', label: t('playlist.saveToPlaylist'), icon: Star, run: () => openAddSongsToPlaylist([song]), disabled: false }]
            : []),
    ];
    return (
        <li className="scratchpad-row" data-scratchpad-history-key={getPlaybackSongKey(song)}>
            <span className="scratchpad-cover" aria-hidden="true">
                {coverUrl && !coverFailed
                    ? <img src={coverUrl} alt="" loading="lazy" decoding="async" onError={() => setCoverFailed(true)} />
                    : <span className="grid h-full w-full place-items-center opacity-50"><Music2 size={16} /></span>}
            </span>
            <button type="button" className="scratchpad-song" title={playLabel} onClick={() => playback.playNow(song)}>
                <span className="scratchpad-name">{song.name}</span>
                <span className="scratchpad-meta">{[getSongArtistLabel(song), sourceLabel, timeLabel].filter(Boolean).join(' · ')}</span>
            </button>
            <span className="scratchpad-row-actions">
                <button
                    type="button"
                    className="scratchpad-icon-button"
                    data-scratchpad-action="play"
                    title={playLabel}
                    aria-label={playLabel}
                    onClick={() => playback.playNow(song)}
                >
                    <Play aria-hidden="true" />
                </button>
                {buttons.map(({ id, label, icon: Icon, run, disabled }) => (
                    <button
                        key={id}
                        type="button"
                        className="scratchpad-icon-button"
                        data-scratchpad-action={id}
                        title={label}
                        aria-label={label}
                        disabled={disabled}
                        onClick={event => {
                            if (event.detail > 0) event.currentTarget.blur();
                            run();
                        }}
                    >
                        <Icon aria-hidden="true" />
                    </button>
                ))}
            </span>
        </li>
    );
});
HistoryRow.displayName = 'HistoryRow';

const ScratchpadHistory: React.FC<ScratchpadHistoryProps> = ({ playback }) => {
    const { t, i18n } = useTranslation();
    const plays = useScratchpadHistory();
    const entries = useScratchpadStore(state => state.entries);
    const collectedKeys = useMemo(() => new Set(entries.map(entry => entry.key)), [entries]);
    // 分段按读的那一刻算「今天」：抽屉开着跨过零点，下一首播放时就重分。
    const days = useMemo(() => groupPlaysByDay(plays, Date.now()), [plays]);
    const formats = useMemo(() => ({
        time: new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }),
        day: new Intl.DateTimeFormat(i18n.language, { month: 'long', day: 'numeric', weekday: 'short' }),
    }), [i18n.language]);
    const dayLabel = (day: HistoryDay) => (
        day.kind === 'today' ? t('scratchpad.today') : day.kind === 'yesterday' ? t('scratchpad.yesterday') : formats.day.format(day.start)
    );

    if (plays.length === 0) {
        return (
            <div className="scratchpad-empty" data-testid="scratchpad-history-empty">
                <History aria-hidden="true" />
                <p>{t('scratchpad.historyEmpty')}</p>
            </div>
        );
    }

    return (
        <div className="scratchpad-list" data-testid="scratchpad-history">
            {days.map(day => (
                <section key={day.start} className="scratchpad-list-group">
                    <div className="scratchpad-group-header">
                        <span className="scratchpad-group-label">{dayLabel(day)}</span>
                        <span className="scratchpad-group-count">{t('scratchpad.count', { count: day.plays.length })}</span>
                    </div>
                    <ul>
                        {day.plays.map((play: RecentPlay) => (
                            <HistoryRow
                                key={getPlaybackSongKey(play.song)}
                                song={play.song}
                                collected={collectedKeys.has(getPlaybackSongKey(play.song))}
                                timeLabel={formats.time.format(play.at)}
                                sourceLabel={scratchpadSourceLabel(play.song, t)}
                                playback={playback}
                            />
                        ))}
                    </ul>
                </section>
            ))}
        </div>
    );
};

export default ScratchpadHistory;
