import React, { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pin } from 'lucide-react';
import type { SongResult } from '../../../types';
import { currentTime } from '../../../stores/motionSignals';
import { formatNoteAt } from '../../song-notes/songNotesModel';
import { writeSongComment } from '../../song-notes/songNoteActions';
import { useSongNotesStore } from '../../song-notes/useSongNotesStore';

// src/components/app/scratchpad/ScratchpadCommentComposer.tsx
// 「评论」页底部的输入框（设计稿 G 组 Comments）：Enter 记下、Shift + Enter 换行；旁边一颗「挂在 01:47」的开关
// （只在看的是正在播的那首时能开，开着时这条评论挂在按下 Enter 那一刻的位置）。没发出去的字是这首歌的草稿（useSongNotesStore.drafts），
// 换歌时留在原来那首上。开关上的时间直接写进按钮的字（订阅 currentTime，秒数变了才写），不进 React state。

type ScratchpadCommentComposerProps = {
    song: SongResult;
    songKey: string;
    /** 看的就是正在播的那首：能挂时刻。 */
    canPin: boolean;
    /** 记下了一条（列表滚过去）。 */
    onWritten: (id: string) => void;
};

const PinTime: React.FC = () => {
    const ref = useRef<HTMLSpanElement>(null);
    useLayoutEffect(() => {
        let last = -1;
        const write = (value: number) => {
            const second = Math.floor(Math.max(0, value));
            if (second === last || !ref.current) return;
            last = second;
            ref.current.textContent = formatNoteAt(second);
        };
        write(currentTime.get());
        return currentTime.on('change', write);
    }, []);
    return <span ref={ref} className="scratchpad-composer-pin-time" />;
};

const ScratchpadCommentComposer: React.FC<ScratchpadCommentComposerProps> = ({ song, songKey, canPin, onWritten }) => {
    const { t } = useTranslation();
    const draft = useSongNotesStore(state => state.drafts[songKey] ?? '');
    const setDraft = useSongNotesStore(state => state.setDraft);
    const composeNonce = useSongNotesStore(state => state.composeNonce);
    const [pinned, setPinned] = useState(false);
    const [busy, setBusy] = useState(false);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const pinActive = pinned && canPin;

    // 命令「写评论」：输入框接焦点（输入框挂上之前就要的，挂上时接）。
    // 布局阶段就接：输入框已经挂上了，不用等下一帧（等一帧要在清理里取消，StrictMode 跑两遍时要求已被第一遍领走，第二遍就没人接了）。
    useLayoutEffect(() => {
        if (!useSongNotesStore.getState().takeCompose()) return;
        inputRef.current?.focus({ preventScroll: true });
    }, [composeNonce]);

    const submit = async () => {
        if (busy) return;
        const text = draft.trim();
        const at = pinActive ? currentTime.get() : null;
        if (!text && at === null) return;
        setBusy(true);
        const result = await writeSongComment(song, text, at);
        setBusy(false);
        if (!result.ok) return;
        // 草稿按歌记：写完时用户可能已经换了一首，清的是写进去的那首。
        useSongNotesStore.getState().setDraft(songKey, '');
        setPinned(false);
        onWritten(result.value.id);
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void submit();
        } else if (event.key === 'Escape' && draft) {
            // 有字时 Esc 只是离开输入框（字留作草稿），不收起抽屉；空着时照常收起。
            event.preventDefault();
            inputRef.current?.blur();
        }
    };

    return (
        <form
            className="scratchpad-composer"
            onSubmit={event => {
                event.preventDefault();
                void submit();
            }}
        >
            <textarea
                ref={inputRef}
                className="scratchpad-composer-input"
                value={draft}
                // 存的那一下（几毫秒）不收新字：存完会清空草稿，这期间打的字会跟着丢。
                readOnly={busy}
                rows={Math.min(5, Math.max(2, draft.split('\n').length))}
                maxLength={10_000}
                placeholder={t('songNotes.composerPlaceholder')}
                aria-label={t('songNotes.composerLabel')}
                onChange={event => setDraft(songKey, event.target.value)}
                onKeyDown={handleKeyDown}
            />
            <div className="scratchpad-composer-row">
                <button
                    type="button"
                    className={`scratchpad-composer-pin${pinActive ? ' is-on' : ''}`}
                    aria-pressed={pinActive}
                    disabled={!canPin}
                    title={canPin ? t('songNotes.pinHint') : t('songNotes.pinUnavailable')}
                    onClick={() => setPinned(value => !value)}
                >
                    <Pin aria-hidden="true" />
                    <span>{t('songNotes.pinAt')}</span>
                    {canPin && <PinTime />}
                </button>
                <span className="scratchpad-composer-hint">{t('songNotes.composerHint')}</span>
                <button type="submit" className="scratchpad-pill is-solid" disabled={busy || (!draft.trim() && !pinActive)}>
                    {t('songNotes.submit')}
                </button>
            </div>
        </form>
    );
};

export default ScratchpadCommentComposer;
