import React, { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, History, ListPlus, Music2, NotebookPen, Play, Star, Trash2 } from 'lucide-react';
import type { SongResult } from '../../../types';
import { forgetPlays, type RecentPlay } from '../home/explore/recentPlays';
import { collectToScratchpad, scratchpadGroupKey, useScratchpadStore } from '../../../stores/useScratchpadStore';
import { canOpenPlaylistPickerFor, openAddSongsToPlaylist } from '../../../stores/useAddToPlaylistStore';
import { getSongArtistLabel, getSongCoverUrl } from '../../../services/onlineMusic/songMetadata';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import { groupPlaysByDay, type HistoryDay } from './historyDays';
import { scratchpadSourceLabel, type ScratchpadAction } from './scratchpadModel';
import { historyScopes, useScratchpadHistory } from './useScratchpadHistory';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';
import { PRIMARY_MODIFIER_LABEL } from '../../../utils/platform';
import ScratchpadCanvas, { type CanvasGroup } from './ScratchpadCanvas';
import type { CanvasEntry } from './ScratchpadCard';
import { TIMELINE_SPACING } from './canvasLayout';
import type { ScratchpadPlayback } from './ScratchpadHost';

// src/components/app/scratchpad/ScratchpadHistory.tsx
// 速记簿的第二页：播放历史。最近七天在这台设备上放过的歌（Folia 自己的播放记录 recentPlays：在线平台、本地、
// Navidrome 合在一起），新的在前，按天分段；每一行写歌手 · 来源 · 几点几分，悬停出四颗：插进队列播放、加入队列、
// 加入速记簿（已经在里面时打勾、点不了）、收藏到歌单。
// 展开后是和速记簿一样的卡片画布（ScratchpadCanvas）：一天一组，一条时间轴穿过每天的卡片，每张卡前面的节点上写几点放的；框选、Ctrl / Shift
// 点选，浮动菜单里加入队列、加入速记簿、收藏到歌单、从播放历史删除（Delete 也是删除）。播放历史按时间排，不能拖动排序。

type ScratchpadHistoryProps = {
    playback: ScratchpadPlayback;
    expanded: boolean;
    /** 画布里没有选择时按 Esc：收回窄的列表。 */
    onCollapse: () => void;
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

const ScratchpadHistory: React.FC<ScratchpadHistoryProps> = ({ playback, expanded, onCollapse }) => {
    const { t, i18n } = useTranslation();
    const plays = useScratchpadHistory();
    const entries = useScratchpadStore(state => state.entries);
    const collectedKeys = useMemo(() => new Set(entries.map(entry => entry.key)), [entries]);
    // 分段按读的那一刻算「今天」：抽屉开着跨过零点，下一首播放时就重分。
    const days = useMemo(() => groupPlaysByDay(plays, Date.now()), [plays]);
    const formats = useMemo(() => ({
        time: new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }),
        day: new Intl.DateTimeFormat(i18n.language, { month: 'long', day: 'numeric', weekday: 'short' }),
        // 时间轴节点上的时间：一律 24 小时制，牌子窄，放不下「下午」「PM」。
        node: new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
    }), [i18n.language]);
    const dayLabel = useCallback((day: HistoryDay) => (
        day.kind === 'today' ? t('scratchpad.today') : day.kind === 'yesterday' ? t('scratchpad.yesterday') : formats.day.format(day.start)
    ), [formats, t]);

    // 展开时的画布：一天一组，卡片第二行写歌手与几点放的；一条时间轴穿过每天的卡片（新的在前）。
    const canvasGroups = useMemo<CanvasGroup[]>(() => (expanded ? days.map(day => {
        // 几点放的写在时间轴的节点上，卡片上只写歌手。
        const dayEntries = day.plays.map((play): CanvasEntry => ({
            key: getPlaybackSongKey(play.song),
            song: play.song,
        }));
        return {
            key: String(day.start),
            label: dayLabel(day),
            entries: dayEntries,
            buttons: [{
                id: 'enqueue-group',
                label: t('scratchpad.enqueueGroup'),
                icon: ListPlus,
                run: () => latest.current.playback.enqueueAll(dayEntries.map(entry => entry.song)),
            }],
            thread: { kind: 'timeline', labels: day.plays.map(play => formats.node.format(play.at)) },
        };
    }) : []), [dayLabel, days, expanded, formats, t]);
    // 菜单与键盘在事件里读这一刻的值。
    const latest = useRef({ playback, t });
    latest.current = { playback, t };
    const collect = useCallback((songs: SongResult[]) => {
        collectToScratchpad(songs, { label: latest.current.t('scratchpad.originHistory') });
    }, []);
    const play = useCallback((entry: CanvasEntry) => latest.current.playback.playNow(entry.song), []);
    // 从播放历史里删掉：只删此刻读的这几份记录里的（换了账户的那份不动），探索页的「最近播放」跟着少。
    const forget = useCallback((selected: CanvasEntry[]) => {
        const count = forgetPlays(historyScopes(), selected.map(entry => entry.key));
        console.info('[Scratchpad] forget history', { requested: selected.length, count });
        if (count > 0) {
            setStatusMessage({
                type: 'success',
                text: latest.current.t('scratchpad.historyDeleted', { count: selected.length }),
                nonce: Date.now(),
                durationMs: 1600,
            });
        }
    }, []);
    const selectionActions = useCallback((selected: CanvasEntry[]): ScratchpadAction[] => {
        const { playback: port, t: translate } = latest.current;
        const songs = selected.map(entry => entry.song);
        const sameSource = new Set(songs.map(scratchpadGroupKey)).size === 1;
        return [
            { id: 'enqueue', label: translate('scratchpad.enqueue'), icon: ListPlus, run: () => port.enqueueAll(songs) },
            { id: 'collect', label: translate('scratchpad.collect'), icon: NotebookPen, run: () => collect(songs) },
            {
                id: 'save-to-playlist',
                label: translate('scratchpad.addToPlaylist'),
                title: sameSource ? undefined : translate('scratchpad.mixedSourcesHint'),
                icon: Star,
                run: () => openAddSongsToPlaylist(songs),
                disabled: !sameSource || !songs.every(canOpenPlaylistPickerFor),
            },
            { id: 'delete-from-history', label: translate('scratchpad.deleteFromHistory'), icon: Trash2, run: () => forget(selected) },
        ];
    }, [collect, forget]);

    if (plays.length === 0) {
        return (
            <div className="scratchpad-empty" data-testid="scratchpad-history-empty">
                <History aria-hidden="true" />
                <p>{t('scratchpad.historyEmpty')}</p>
            </div>
        );
    }

    if (expanded) {
        return (
            <ScratchpadCanvas
                groups={canvasGroups}
                hint={t('scratchpad.historyCanvasHint', { mod: PRIMARY_MODIFIER_LABEL })}
                ariaLabel={t('scratchpad.history')}
                testId="scratchpad-history"
                playLabel={t('scratchpad.play')}
                onPlay={play}
                onDelete={forget}
                selectionActions={selectionActions}
                onEscape={onCollapse}
                spacing={TIMELINE_SPACING}
            />
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
