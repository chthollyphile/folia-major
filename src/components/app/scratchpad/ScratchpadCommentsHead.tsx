import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Music2, Plus, X } from 'lucide-react';
import type { SongResult } from '../../../types';
import { currentTime } from '../../../stores/motionSignals';
import { getSongArtistLabel } from '../../../services/onlineMusic/songMetadata';
import { formatNoteAt, normalizeTagName, timelineMarks, type SongNoteComment, type SongNoteTag } from '../../song-notes/songNotesModel';
import { tagSong, untagSong } from '../../song-notes/songNoteActions';
import { scratchpadCoverUrl } from './scratchpadCover';
import { tagLabel } from './commentCards';

// src/components/app/scratchpad/ScratchpadCommentsHead.tsx
// 「评论」页收起面板的上半截（设计稿 G 组 Comments）：歌曲头（「正在播放」或「在看」的小标签、放大的歌名、一道点缀色短杠、歌手、封面），
// 一排标签纸片（点 × 去掉，「+ 标签」就地输入，Enter 加上、Esc 放弃），一条小时间轴（点缀色刻痕是挂着时刻的评论，
// 看的是正在播的那首时还有一颗菱形跟着播放位置走，点刻痕跳过去）。
// 菱形的位置不进 React state：订阅 currentTime，位置变过千分之一才写一次 transform（frontend-runtime-guardrails）。

type ScratchpadCommentsHeadProps = {
    song: SongResult;
    songKey: string;
    /** 看的就是正在播的那首。 */
    isPlaying: boolean;
    tags: readonly string[];
    tagNames: ReadonlyMap<string, SongNoteTag>;
    comments: readonly SongNoteComment[];
    /** 歌长（秒）：刻痕按它摆。 */
    duration: number;
    onSeek: (at: number) => void;
    /** 在看另一首时：回到正在播放。 */
    onBackToPlaying?: () => void;
};

const PlayingDiamond: React.FC<{ duration: number }> = ({ duration }) => {
    const ref = useRef<HTMLSpanElement>(null);
    useLayoutEffect(() => {
        let last = -1;
        const place = (value: number) => {
            const ratio = duration > 0 ? Math.max(0, Math.min(1, value / duration)) : 0;
            const permille = Math.round(ratio * 1000);
            if (permille === last || !ref.current) return;
            last = permille;
            ref.current.style.transform = `translateX(${(permille / 10).toFixed(1)}%)`;
        };
        place(currentTime.get());
        return currentTime.on('change', place);
    }, [duration]);
    return (
        <span ref={ref} className="scratchpad-comments-timeline-carrier" aria-hidden="true">
            <span className="scratchpad-comments-timeline-now" />
        </span>
    );
};

const ScratchpadCommentsHead: React.FC<ScratchpadCommentsHeadProps> = ({
    song, songKey, isPlaying, tags, tagNames, comments, duration, onSeek, onBackToPlaying,
}) => {
    const { t } = useTranslation();
    const [adding, setAdding] = useState(false);
    const [tagDraft, setTagDraft] = useState('');
    const [coverFailed, setCoverFailed] = useState(false);
    const coverUrl = scratchpadCoverUrl(song, 64);
    const marks = useMemo(() => timelineMarks(comments, duration), [comments, duration]);

    const commitTag = () => {
        const name = normalizeTagName(tagDraft);
        setTagDraft('');
        setAdding(false);
        if (name) void tagSong(song, name);
    };
    const handleTagKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') {
            event.preventDefault();
            commitTag();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            setTagDraft('');
            setAdding(false);
        }
    };

    return (
        <div className="scratchpad-comments-head">
            <div className="scratchpad-comments-song">
                <div className="scratchpad-comments-song-text">
                    <span className="scratchpad-comments-label">
                        {isPlaying ? t('scratchpad.nowPlaying') : t('songNotes.viewing')}
                        {onBackToPlaying && (
                            <button type="button" className="scratchpad-band-link scratchpad-comments-back" onClick={onBackToPlaying}>
                                {t('songNotes.backToPlaying')} ›
                            </button>
                        )}
                    </span>
                    <h3 className="scratchpad-comments-title" title={song.name}>{song.name}</h3>
                    <span className="scratchpad-intro-rule" aria-hidden="true" />
                    <span className="scratchpad-comments-artist">{getSongArtistLabel(song)}</span>
                </div>
                <span className="scratchpad-comments-cover" aria-hidden="true">
                    {coverUrl && !coverFailed
                        ? <img src={coverUrl} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setCoverFailed(true)} />
                        : <Music2 />}
                </span>
            </div>

            <ul className="scratchpad-comments-tags" aria-label={t('songNotes.tags')}>
                {tags.map(key => (
                    <li key={key} className="scratchpad-comments-tag">
                        <span>#{tagLabel(key, tagNames)}</span>
                        <button
                            type="button"
                            title={t('songNotes.removeTag', { tag: tagLabel(key, tagNames) })}
                            aria-label={t('songNotes.removeTag', { tag: tagLabel(key, tagNames) })}
                            onClick={() => void untagSong(songKey, key)}
                        >
                            <X aria-hidden="true" />
                        </button>
                    </li>
                ))}
                <li>
                    {adding ? (
                        <input
                            // 点「+ 标签」之后接着就打字。
                            autoFocus
                            className="scratchpad-comments-tag-input"
                            value={tagDraft}
                            maxLength={80}
                            placeholder={t('songNotes.tagPlaceholder')}
                            aria-label={t('songNotes.addTag')}
                            list="scratchpad-comments-tag-options"
                            onChange={event => setTagDraft(event.target.value)}
                            onKeyDown={handleTagKeyDown}
                            onBlur={commitTag}
                        />
                    ) : (
                        <button type="button" className="scratchpad-comments-tag-add" onClick={() => setAdding(true)}>
                            <Plus aria-hidden="true" />
                            <span>{t('songNotes.addTag')}</span>
                        </button>
                    )}
                </li>
            </ul>
            {adding && (
                <datalist id="scratchpad-comments-tag-options">
                    {[...tagNames.values()].filter(tag => !tags.includes(tag.key)).map(tag => <option key={tag.key} value={tag.name} />)}
                </datalist>
            )}

            {duration > 0 && (marks.length > 0 || isPlaying) && (
                <div className="scratchpad-comments-timeline" role="group" aria-label={t('songNotes.timeline')}>
                    <span className="scratchpad-comments-timeline-track" aria-hidden="true" />
                    {marks.map(mark => (
                        <button
                            key={mark.id}
                            type="button"
                            className="scratchpad-comments-timeline-mark"
                            style={{ left: `${(mark.ratio * 100).toFixed(2)}%` }}
                            disabled={!isPlaying}
                            title={`${formatNoteAt(mark.at)}${mark.text ? ` · ${mark.text}` : ''}`}
                            aria-label={t('songNotes.seekTo', { at: formatNoteAt(mark.at) })}
                            onClick={() => onSeek(mark.at)}
                        />
                    ))}
                    {isPlaying && <PlayingDiamond duration={duration} />}
                </div>
            )}
        </div>
    );
};

export default ScratchpadCommentsHead;
