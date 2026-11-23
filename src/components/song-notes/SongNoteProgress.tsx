import React, { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { SongResult } from '../../types';
import { selectDisplaySong, usePlaybackStore } from '../../stores/usePlaybackStore';
import { getPlaybackSongKey, isStagePlaybackSong } from '../../utils/appPlaybackGuards';
import { formatNoteAt, timelineMarks } from './songNotesModel';
import { writeSongComment } from './songNoteActions';
import { useSongNote } from './useSongNotesStore';
import { useThemeSettingsStore } from '../../stores/useThemeSettingsStore';
import { capsuleGlassClass, capsuleGlassStyle } from '../floating-player/capsuleGlass';
import { closeSongNotePin, useSongNotePinStore } from './songNotePin';
import './songNotes.css';

// src/components/song-notes/SongNoteProgress.tsx
// 播放条上的歌曲评论（计划 plan/music-notes-integration-plan.md「播放条」）：
// - 小点（SongNoteMarks）：正在播的这首里挂着时刻的评论，画成进度条下方的一排小点，悬停出一张小纸条写评论，点了跳过去。
//   位置只随歌长和评论变（useMemo），不随播放进度重算（frontend-runtime-guardrails）。
// - 「记下这个时刻」的小框（SongNotePinHost）：按钮不在进度条上，是胶囊右侧可自定义槽位里的一个动作（songNotePin.ts）；
//   点了记下此刻的位置，在那个按钮上方弹出一个小输入框。Enter 保存；Esc 不写字，只留一道刻痕；× 或点空白处取消，什么都不留。
//   框挂在 App 上、全局一份，胶囊、电台墙的槽位都用它。
// 模组的 progressLayers 也挂在 ProgressBar 上；刻痕是本体直接画的，不走 mod registry。

/** 正在播的这首（舞台歌不算）。 */
const usePlayingSong = (): { song: SongResult; key: string } | null => {
    const song = usePlaybackStore(selectDisplaySong);
    return useMemo(() => (song && !isStagePlaybackSong(song) ? { song, key: getPlaybackSongKey(song) } : null), [song]);
};

type SongNoteMarksProps = {
    duration: number;
    onSeek: (time: number) => void;
    disabled?: boolean;
};

export const SongNoteMarks: React.FC<SongNoteMarksProps> = memo(({ duration, onSeek, disabled = false }) => {
    const { t } = useTranslation();
    const playing = usePlayingSong();
    const { comments } = useSongNote(playing?.key ?? null);
    const marks = useMemo(() => timelineMarks(comments, duration), [comments, duration]);
    // 悬停 / 聚焦的那个点：只在进出时变，不随播放进度变。小纸条挂在 body 上——胶囊裁掉溢出，贴在点上会被截掉。
    const [tip, setTip] = useState<{ id: string; rect: DOMRect } | null>(null);
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const tipMark = tip ? marks.find(mark => mark.id === tip.id) : undefined;
    if (marks.length === 0) return null;
    const show = (id: string) => (event: React.SyntheticEvent<HTMLButtonElement>) => setTip({ id, rect: event.currentTarget.getBoundingClientRect() });
    const hide = () => setTip(null);
    return (
        <div className="song-note-marks" aria-label={t('songNotes.timeline')} role="group">
            {marks.map(mark => (
                <button
                    key={mark.id}
                    type="button"
                    className="song-note-mark"
                    style={{ left: `${(mark.ratio * 100).toFixed(3)}%` }}
                    disabled={disabled}
                    aria-label={`${t('songNotes.seekTo', { at: formatNoteAt(mark.at) })}${mark.text ? ` · ${mark.text}` : ''}`}
                    onPointerEnter={show(mark.id)}
                    onPointerLeave={hide}
                    onFocus={show(mark.id)}
                    onBlur={hide}
                    // 卡在按下上：不让进度条下面那根拖动条接走这一下。
                    onPointerDown={event => event.stopPropagation()}
                    onClick={event => {
                        event.stopPropagation();
                        onSeek(mark.at);
                    }}
                />
            ))}
            {/* 进度条失效（定位模式等）时点收不到 pointerleave：不再画小签，免得留在屏幕上。换了歌 tipMark 就找不到了，也不画。 */}
            {tip && tipMark && !disabled && createPortal(
                <span
                    className={`song-note-mark-tip ${capsuleGlassClass(isDaylight)}`}
                    aria-hidden="true"
                    style={{
                        ...capsuleGlassStyle(isDaylight),
                        left: Math.max(132, Math.min(window.innerWidth - 132, tip.rect.left + tip.rect.width / 2)),
                        bottom: window.innerHeight - tip.rect.top + 12,
                    }}
                >
                    <b>{formatNoteAt(tipMark.at)}</b>
                    {tipMark.text && <span>{tipMark.text}</span>}
                </span>,
                document.body,
            )}
        </div>
    );
});
SongNoteMarks.displayName = 'SongNoteMarks';

/** 「记下这个时刻」的小框：挂在 body 上（胶囊会裁掉溢出的东西），钉在点下的那个按钮上方。 */
export const SongNotePinHost: React.FC = () => {
    const { t } = useTranslation();
    const pending = useSongNotePinStore(state => state.pending);
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const playing = usePlayingSong();
    const [text, setText] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    // 这一次已经收尾了（Enter、Esc、×）：输入框卸掉时再来的 blur 不再存一遍。
    const settledRef = useRef(false);

    useLayoutEffect(() => {
        if (!pending) return;
        settledRef.current = false;
        setText('');
        inputRef.current?.focus({ preventScroll: true });
    }, [pending]);

    const finish = (mode: 'save' | 'mark' | 'discard', byBlur = false) => {
        if (!pending || settledRef.current) return;
        settledRef.current = true;
        const { song, at } = pending;
        closeSongNotePin(byBlur);
        if (mode === 'discard') return;
        void writeSongComment(song, mode === 'mark' ? '' : text, at);
    };
    const finishRef = useRef(finish);
    finishRef.current = finish;

    // 换了歌、停了：记下的那一刻属于原来那首，照样存给它（不丢用户按下按钮的那一下），框收起来。
    const pendingKey = pending ? getPlaybackSongKey(pending.song) : null;
    const playingKey = playing?.key ?? null;
    useEffect(() => {
        if (pendingKey !== null && pendingKey !== playingKey) finishRef.current('save');
    }, [pendingKey, playingKey]);

    if (!pending) return null;

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.nativeEvent.isComposing) return;
        // 别让播放页的快捷键（空格暂停、方向键快进）接走输入框里的键。
        event.stopPropagation();
        if (event.key === 'Enter') {
            event.preventDefault();
            finish('save');
        } else if (event.key === 'Escape') {
            event.preventDefault();
            finish('mark');
        }
    };

    const label = t('songNotes.pinNow');
    return createPortal(
        <div
            className={`song-note-pin-popover ${capsuleGlassClass(isDaylight)}`}
            role="dialog"
            aria-label={label}
            style={{
                ...capsuleGlassStyle(isDaylight),
                left: Math.max(12, Math.min(window.innerWidth - 292, pending.anchor.left + pending.anchor.width / 2 - 140)),
                bottom: Math.max(12, window.innerHeight - pending.anchor.top + 10),
            }}
            onPointerDown={event => event.stopPropagation()}
            // 点框里别处（时刻、标题、内边距）不抢输入框的焦点：失焦就是取消，不能让点自己的框也算「点空白处」。
            onMouseDown={event => {
                if (event.target !== inputRef.current) event.preventDefault();
            }}
        >
            <div className="song-note-pin-popover-head">
                <span className="song-note-pin-popover-at">{formatNoteAt(pending.at)}</span>
                <span className="song-note-pin-popover-title">{label}</span>
                <button
                    type="button"
                    className="song-note-pin-popover-close"
                    title={t('songNotes.pinDiscard')}
                    aria-label={t('songNotes.pinDiscard')}
                    // 先于输入框的 blur：按下就算放弃。
                    onPointerDown={event => {
                        event.preventDefault();
                        finish('discard');
                    }}
                    onClick={() => finish('discard')}
                >
                    <X aria-hidden="true" />
                </button>
            </div>
            <input
                ref={inputRef}
                className="song-note-pin-popover-input"
                value={text}
                maxLength={10_000}
                placeholder={t('songNotes.pinPlaceholder')}
                aria-label={label}
                onChange={event => setText(event.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={() => {
                    // 切到别的窗口也会失焦：那不是点了空白处，框留着，回来接着写。
                    if (!document.hasFocus()) return;
                    finish('discard', true);
                }}
            />
            <span className="song-note-pin-popover-hint">{t('songNotes.pinKeys')}</span>
        </div>,
        document.body,
    );
};
