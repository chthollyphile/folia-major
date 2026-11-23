import React, { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2 } from 'lucide-react';
import { formatNoteAt, sortComments, type SongNoteComment, type SongNoteSort } from '../../song-notes/songNotesModel';
import { eraseSongComment, rewriteSongComment } from '../../song-notes/songNoteActions';

// src/components/app/scratchpad/ScratchpadCommentList.tsx
// 「评论」页收起面板里的评论列表（设计稿 G 组 Comments）：挂着时刻的评论前面一块点缀色的时间块（点了跳过去，只在看的是正在播的那首时能点），
// 普通评论前面一个「记号。悬停出现编辑、删除；编辑就地换成输入框（Enter 保存、Shift + Enter 换行、Esc 放弃），
// 删除点两下（第二下前写明）。按时间轴排时，没挂时刻的单列一段，组头「没挂时刻的」。

const DELETE_CONFIRM_MS = 3000;

type ItemProps = {
    comment: SongNoteComment;
    /** 时间块能不能点（看的是正在播的那首）。 */
    canSeek: boolean;
    onSeek: (at: number) => void;
};

const CommentItem: React.FC<ItemProps> = memo(({ comment, canSeek, onSeek }) => {
    const { t, i18n } = useTranslation();
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(comment.text);
    const [confirming, setConfirming] = useState(false);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    // Esc 放弃之后输入框卸掉时可能还会来一下 blur：那一下不存。
    const cancelledRef = useRef(false);

    useEffect(() => {
        if (!confirming) return;
        const timer = window.setTimeout(() => setConfirming(false), DELETE_CONFIRM_MS);
        return () => window.clearTimeout(timer);
    }, [confirming]);
    useEffect(() => {
        if (!editing) return;
        const input = inputRef.current;
        input?.focus();
        input?.setSelectionRange(input.value.length, input.value.length);
    }, [editing]);

    const startEdit = () => {
        cancelledRef.current = false;
        setDraft(comment.text);
        setEditing(true);
    };
    const save = () => {
        if (cancelledRef.current) return;
        cancelledRef.current = true;
        setEditing(false);
        const next = draft.trim();
        // 把一条没挂时刻的评论改空：当作放弃这次修改，不悄悄删掉整条（删要走两下确认的删除钮）。
        if (!next && comment.at === undefined) return;
        if (next !== comment.text) void rewriteSongComment(comment.id, draft);
    };
    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            save();
        } else if (event.key === 'Escape') {
            // 只放弃这次修改，不收起抽屉。
            event.preventDefault();
            cancelledRef.current = true;
            setEditing(false);
        }
    };
    const handleDelete = () => {
        if (!confirming) {
            setConfirming(true);
            return;
        }
        setConfirming(false);
        void eraseSongComment(comment.id);
    };

    const written = new Intl.DateTimeFormat(i18n.language, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .format(comment.createdAt);
    const at = comment.at;
    return (
        <li className={`scratchpad-comment${at !== undefined ? ' is-timed' : ''}${editing ? ' is-editing' : ''}`} data-comment-id={comment.id}>
            {at !== undefined ? (
                canSeek ? (
                    <button type="button" className="scratchpad-comment-at" title={t('songNotes.seekTo', { at: formatNoteAt(at) })} onClick={() => onSeek(at)}>
                        {formatNoteAt(at)}
                    </button>
                ) : (
                    <span className="scratchpad-comment-at">{formatNoteAt(at)}</span>
                )
            ) : (
                <span className="scratchpad-comment-quote" aria-hidden="true">「</span>
            )}
            <div className="scratchpad-comment-body">
                {editing ? (
                    <textarea
                        ref={inputRef}
                        className="scratchpad-comment-edit"
                        value={draft}
                        rows={Math.min(6, Math.max(2, draft.split('\n').length))}
                        aria-label={t('songNotes.edit')}
                        onChange={event => setDraft(event.target.value)}
                        onKeyDown={handleKeyDown}
                        onBlur={save}
                    />
                ) : (
                    <p className={`scratchpad-comment-text${comment.text ? '' : ' is-empty'}`}>
                        {comment.text || t('songNotes.markOnlyShort')}
                    </p>
                )}
                <span className="scratchpad-comment-when">
                    {written}
                    {comment.editedAt !== undefined && ` · ${t('songNotes.edited')}`}
                </span>
            </div>
            {!editing && (
                <span className="scratchpad-comment-actions">
                    <button type="button" className="scratchpad-icon-button" title={t('songNotes.edit')} aria-label={t('songNotes.edit')} onClick={startEdit}>
                        <Pencil aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        className={`scratchpad-icon-button${confirming ? ' is-confirming' : ''}`}
                        title={confirming ? t('songNotes.confirmDelete') : t('songNotes.delete')}
                        aria-label={confirming ? t('songNotes.confirmDelete') : t('songNotes.delete')}
                        onClick={handleDelete}
                    >
                        <Trash2 aria-hidden="true" />
                        {confirming && <span>{t('songNotes.confirmDelete')}</span>}
                    </button>
                </span>
            )}
        </li>
    );
});
CommentItem.displayName = 'CommentItem';

type ScratchpadCommentListProps = {
    comments: readonly SongNoteComment[];
    sort: SongNoteSort;
    canSeek: boolean;
    onSeek: (at: number) => void;
    /** 新写的那一条：滚过去。 */
    scrollToId: string | null;
};

const ScratchpadCommentList: React.FC<ScratchpadCommentListProps> = ({ comments, sort, canSeek, onSeek, scrollToId }) => {
    const { t } = useTranslation();
    const listRef = useRef<HTMLDivElement>(null);
    const sorted = sortComments(comments, sort);
    const firstUntimed = sort === 'timeline' ? sorted.findIndex(comment => comment.at === undefined) : -1;
    const hasTimed = sorted.some(comment => comment.at !== undefined);

    // 刚写的那条滚到眼前，只滚一次：之后库里别的变动（打标签、改旧评论、别的窗口写入）重读列表，不再把用户拉回去。
    const scrolledRef = useRef<string | null>(null);
    useEffect(() => {
        if (!scrollToId || scrolledRef.current === scrollToId) return;
        const item = listRef.current?.querySelector(`[data-comment-id="${CSS.escape(scrollToId)}"]`);
        if (!item) return;
        scrolledRef.current = scrollToId;
        item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [scrollToId, comments]);

    if (comments.length === 0) {
        return <p className="scratchpad-comments-none">{t('songNotes.noComments')}</p>;
    }
    return (
        <div ref={listRef} className="scratchpad-comment-scroll">
            <ul className="scratchpad-comment-list" aria-label={t('songNotes.listLabel')}>
                {sorted.map((comment, index) => (
                    <React.Fragment key={comment.id}>
                        {index === firstUntimed && hasTimed && (
                            <li className="scratchpad-comment-divider" aria-hidden="true">{t('songNotes.untimedGroup')}</li>
                        )}
                        <CommentItem comment={comment} canSeek={canSeek} onSeek={onSeek} />
                    </React.Fragment>
                ))}
            </ul>
        </div>
    );
};

export default ScratchpadCommentList;
