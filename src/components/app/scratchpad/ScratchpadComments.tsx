import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquareQuote } from 'lucide-react';
import { selectDisplayDuration, selectDisplaySong, usePlaybackStore } from '../../../stores/usePlaybackStore';
import { getPlaybackSongKey, isStagePlaybackSong } from '../../../utils/appPlaybackGuards';
import { getSongArtistLabel } from '../../../services/onlineMusic/songMetadata';
import { useRecentSongNotes, useSongNote, useSongNoteTags, useSongNotesStore } from '../../song-notes/useSongNotesStore';
import { markMusicNotesModHintDone, useMusicNotesModHint } from '../../song-notes/songNotesModHint';
import { openSettings } from '../../../stores/useSettingsModalStore';
import { formatNoteAt } from '../../song-notes/songNotesModel';
import ScratchpadGreeting from './ScratchpadGreeting';
import ScratchpadCommentsHead from './ScratchpadCommentsHead';
import ScratchpadCommentList from './ScratchpadCommentList';
import ScratchpadCommentComposer from './ScratchpadCommentComposer';
import ScratchpadCommentsSheet from './ScratchpadCommentsSheet';
import { commentCountsLabel } from './commentCards';
import type { ScratchpadPlayback } from './ScratchpadHost';

// src/components/app/scratchpad/ScratchpadComments.tsx
// 速记簿第四页「评论」：歌曲的本地评论（标签 + 评论 + 时间轴注释，数据在 src/components/song-notes/，单独长期存）。
// 收起的面板（设计稿 G 组 Comments）默认看正在播的那首：上半截歌曲头、标签、小时间轴（ScratchpadCommentsHead），中间评论列表
// （按写的时间 / 按时间轴两种排法），底下输入框（ScratchpadCommentComposer）。从最近评论、展开整页的卡点进来的是那一首，
// 顶上出「回到正在播放」。没有歌在播、也没在看哪一首时，写问候和最近评论过的几首。
// 展开整页按标签分组（ScratchpadCommentsSheet）：整组动作、整理标签、批量打标签、搜索。

const RECENT_IN_PANEL = 12;

/** 这台设备上有「音乐笔记」模组的库时提示一次：去设置 · 存储与备份「备份与导入」导入，或者不再提示。 */
const ModImportHint: React.FC<{ count: number }> = ({ count }) => {
    const { t } = useTranslation();
    return (
        <div className="scratchpad-comments-modhint" role="note">
            <p>{t('songNotes.modHint', { count })}</p>
            <div className="scratchpad-comments-modhint-actions">
                <button
                    type="button"
                    className="scratchpad-comments-modhint-go"
                    onClick={() => {
                        markMusicNotesModHintDone();
                        openSettings('options', 'storage', null, 'importExportTitle', 'songNotesTransfer');
                    }}
                >
                    {t('songNotes.modHintImport')}
                </button>
                <button type="button" className="scratchpad-comments-modhint-dismiss" onClick={markMusicNotesModHintDone}>
                    {t('songNotes.modHintDismiss')}
                </button>
            </div>
        </div>
    );
};

type ScratchpadCommentsProps = {
    playback: ScratchpadPlayback;
    expanded: boolean;
    /** 展开整页里点了一张卡：收回面板去看那一首。 */
    onCollapse: () => void;
};

const ScratchpadComments: React.FC<ScratchpadCommentsProps> = ({ playback, expanded, onCollapse }) => {
    const { t } = useTranslation();
    const displaySong = usePlaybackStore(selectDisplaySong);
    const playing = displaySong && !isStagePlaybackSong(displaySong) ? displaySong : null;
    const playingKey = playing ? getPlaybackSongKey(playing) : null;
    // 播放器量出来的歌长（换歌时变一次）：不少来源的 durationMs 是空的。
    const playingDuration = usePlaybackStore(selectDisplayDuration);
    const viewing = useSongNotesStore(state => state.viewing);
    const view = useSongNotesStore(state => state.view);
    const sort = useSongNotesStore(state => state.sort);
    const setSort = useSongNotesStore(state => state.setSort);
    const target = viewing ?? (playing && playingKey ? { key: playingKey, song: playing } : null);
    const isPlaying = target !== null && target.key === playingKey;
    const detail = useSongNote(expanded ? null : target?.key ?? null);
    const tagNames = useSongNoteTags();
    const recent = useRecentSongNotes(RECENT_IN_PANEL, !expanded && target === null);
    const [lastWritten, setLastWritten] = useState<string | null>(null);
    const modSongs = useMusicNotesModHint(!expanded);
    const modHint = modSongs > 0 ? <ModImportHint count={modSongs} /> : null;

    const seek = useCallback((at: number) => playback.seek(at), [playback]);
    const openSong = useCallback((song: Parameters<typeof view>[0]) => {
        view(song);
        if (expanded) onCollapse();
    }, [expanded, onCollapse, view]);

    if (expanded) {
        return <ScratchpadCommentsSheet playback={playback} tagNames={tagNames} playingKey={playingKey} onOpen={openSong} onEscape={onCollapse} />;
    }

    if (!target) {
        return (
            <div className="scratchpad-comments is-idle">
                <ScratchpadGreeting long={false} headline />
                <p className="scratchpad-hint">{t('songNotes.idleHint')}</p>
                {modHint}
                {recent.rows.length > 0 ? (
                    <ul className="scratchpad-comments-recent" aria-label={t('songNotes.recent')}>
                        {recent.rows.map(row => (
                            <li key={row.key}>
                                <button type="button" className="scratchpad-comments-recent-item" onClick={() => openSong(row.song)}>
                                    <span className="scratchpad-comments-recent-title">{row.song.name}</span>
                                    <span className="scratchpad-comments-recent-meta">
                                        {getSongArtistLabel(row.song)} · {row.commentCount > 0 ? commentCountsLabel(row, t) : t('songNotes.tagsOnly', { count: row.tags.length })}
                                    </span>
                                    {row.latestComment && (
                                        <span className="scratchpad-comments-recent-quote">
                                            {row.latestComment.text || t('songNotes.markOnly', { at: formatNoteAt(row.latestComment.at ?? 0) })}
                                        </span>
                                    )}
                                </button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="scratchpad-empty">
                        <MessageSquareQuote aria-hidden="true" />
                        <p>{t('songNotes.empty')}</p>
                    </div>
                )}
            </div>
        );
    }

    const listedDuration = target.song.durationMs > 0 ? target.song.durationMs / 1000 : 0;
    const duration = isPlaying && playingDuration > 0 ? playingDuration : listedDuration;
    return (
        <div className="scratchpad-comments">
            {modHint}
            <ScratchpadCommentsHead
                song={target.song}
                songKey={target.key}
                isPlaying={isPlaying}
                tags={detail.row?.tags ?? []}
                tagNames={tagNames}
                comments={detail.comments}
                duration={duration}
                onSeek={seek}
                onBackToPlaying={viewing && playingKey && viewing.key !== playingKey ? () => view(null) : undefined}
            />
            <div className="scratchpad-comments-sort" role="radiogroup" aria-label={t('songNotes.sortLabel')}>
                {(['written', 'timeline'] as const).map(option => (
                    <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={sort === option}
                        className={`scratchpad-comments-sort-option${sort === option ? ' is-active' : ''}`}
                        onClick={() => setSort(option)}
                    >
                        {t(option === 'written' ? 'songNotes.sortWritten' : 'songNotes.sortTimeline')}
                    </button>
                ))}
                <span className="scratchpad-comments-sort-count">
                    {detail.row ? commentCountsLabel(detail.row, t) : t('songNotes.commentCount', { count: 0 })}
                </span>
            </div>
            {detail.loaded && (
                <ScratchpadCommentList comments={detail.comments} sort={sort} canSeek={isPlaying} onSeek={seek} scrollToId={lastWritten} />
            )}
            <ScratchpadCommentComposer song={target.song} songKey={target.key} canPin={isPlaying} onWritten={setLastWritten} />
        </div>
    );
};

export default ScratchpadComments;
