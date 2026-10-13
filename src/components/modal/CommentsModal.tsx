import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, ThumbsUp, MapPin, MessageCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SongResult } from '../../types';
import type { ProviderComment } from '../../types/onlineMusic';
import type { MediaId } from '../../types/onlineMusic';
import { omni } from '../../services/onlineMusic/omni';
import { setStatusMessage } from '../../stores/useStatusMessageStore';

// src/components/modal/CommentsModal.tsx
//
// 当前这首歌的独立大评论界面：播放面板点「评论」tab 直接弹这里（面板内不再平铺小列表）。
// 壳照抄 LyricsTimelineModal 的官方词汇：同款毛玻璃遮罩、居中卡片、Esc 关闭、
// data-folia-keyboard-window 接管键盘；差别是走 portal 挂 body——UnifiedPanel 本体在
// 带 transform 的滑动容器里，fixed 遮罩放它内部会被父级变换挪位、盖不满视口。
// 数据只走 omni（铁律），列表四态与条目样式自旧 CommentsTab 原样迁入，语义零变化。

const PAGE_SIZE = 20;
const REPLY_PAGE_SIZE = 20;

interface CommentsModalProps {
    isOpen: boolean;
    onClose: () => void;
    song: SongResult;
    isDaylight?: boolean;
}

const CommentsModal: React.FC<CommentsModalProps> = ({ isOpen, onClose, song, isDaylight = false }) => {
    const { t, i18n } = useTranslation();
    // 赞数大数折叠（263327→26.3万/263K，随界面语言），不然长数字把评论区排版撑得难看。
    const formatCount = (value: number): string =>
        new Intl.NumberFormat(i18n.language || undefined, { notation: 'compact' }).format(value);
    const [comments, setComments] = useState<ProviderComment[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [error, setError] = useState(false);
    const offsetRef = useRef(0);
    // 换歌/关窗时丢弃上一首的在途结果，避免慢响应把旧歌的评论盖到新歌上。
    const requestSeqRef = useRef(0);
    const windowRef = useRef<HTMLDivElement>(null);

    // 盖楼状态，按主评论 id 索引：未展开不在表里；展开后 { replies, hasMore, offset, loading, error }。
    // 与主列表同生共死（换歌/关窗一起清），不单独建 store —— 只有这扇窗消费它。
    const [repliesById, setRepliesById] = useState<Record<string, {
        replies: ProviderComment[];
        hasMore: boolean;
        offset: number;
        loading: boolean;
        error: boolean;
    }>>({});
    // 手风琴式：同一时刻只展开一条楼中楼（大窗高度有限，全开会翻不到底）。
    const [expandedReplyId, setExpandedReplyId] = useState<string | null>(null);
    const replySeqRef = useRef(0);
    // 楼层能不能展开由 provider 能力位决定（酷狗匿名楼层拿不到内容，就不给这个按钮）。
    const canReplies = omni.canThreadCommentReplies(song);
    // 点赞同理按能力位渲染：QQ/酷狗当前没接通写通道 → canLike=false，连假按钮都不出现。
    const canLike = omni.canLikeComment(song);
    const [pendingLikes, setPendingLikes] = useState<Record<string, boolean>>({});

    const textPrimary = isDaylight ? 'text-black/80' : 'text-white/85';
    const textSecondary = isDaylight ? 'text-black/45' : 'text-white/45';
    const cardBg = isDaylight ? 'bg-black/[0.03]' : 'bg-white/[0.04]';
    const hotBg = isDaylight ? 'bg-amber-500/15 text-amber-700' : 'bg-amber-400/15 text-amber-300';
    const glassBg = isDaylight ? 'bg-white/70' : 'bg-black/40';
    const borderColor = isDaylight ? 'border-black/5' : 'border-white/10';
    const headerText = isDaylight ? 'text-zinc-800/90' : 'text-white/90';
    const closeIconColor = isDaylight ? 'text-zinc-800/70' : 'text-white/70';
    const closeBtnHover = isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/10';

    const fetchPage = useCallback(async (offset: number, replace: boolean) => {
        const seq = ++requestSeqRef.current;
        if (replace) { setLoading(true); setError(false); } else { setLoadingMore(true); }
        try {
            const page = await omni.getSongComments(song, { limit: PAGE_SIZE, offset });
            if (seq !== requestSeqRef.current) return;
            offsetRef.current = page.nextOffset;
            setHasMore(page.hasMore);
            setComments(prev => (replace ? page.items : [...prev, ...page.items]));
        } catch {
            if (seq !== requestSeqRef.current) return;
            if (replace) { setComments([]); setError(true); }
        } finally {
            if (seq === requestSeqRef.current) { setLoading(false); setLoadingMore(false); }
        }
    }, [song]);

    // 楼层回复：与主列表同一条 omni 路线；seq 按「最后一次发起」全局作废（换歌/关窗在
    // 复位 effect 里 bump），慢响应不会把旧楼的回贴进新楼。
    const loadReplies = useCallback(async (commentId: string, offset: number, replace: boolean) => {
        const seq = ++replySeqRef.current;
        setRepliesById(prev => ({
            ...prev,
            [commentId]: { replies: prev[commentId]?.replies ?? [], hasMore: false, offset, loading: true, error: false },
        }));
        try {
            const page = await omni.getSongCommentReplies(song, commentId, { limit: REPLY_PAGE_SIZE, offset });
            if (seq !== replySeqRef.current) return;
            setRepliesById(prev => ({
                ...prev,
                [commentId]: {
                    replies: replace ? page.items : [...(prev[commentId]?.replies ?? []), ...page.items],
                    hasMore: page.hasMore,
                    offset: page.nextOffset,
                    loading: false,
                    error: false,
                },
            }));
        } catch {
            if (seq !== replySeqRef.current) return;
            setRepliesById(prev => ({
                ...prev,
                [commentId]: { replies: prev[commentId]?.replies ?? [], hasMore: false, offset, loading: false, error: true },
            }));
        }
    }, [song]);

    const toggleReplies = useCallback((commentId: string) => {
        if (expandedReplyId === commentId) {
            setExpandedReplyId(null);
            return;
        }
        setExpandedReplyId(commentId);
        // 拉过的楼直接用缓存展开，收起再点开不重打接口。
        if (!repliesById[commentId]) void loadReplies(commentId, 0, true);
    }, [expandedReplyId, repliesById, loadReplies]);

    // 点赞：成功才改本地态（不搞先亮后回滚的乐观闪动）；失败态原样，走全局单通道提示。
    const toggleLike = useCallback(async (comment: ProviderComment) => {
        const key = String(comment.id);
        if (pendingLikes[key]) return;
        const nextLiked = !comment.liked;
        setPendingLikes(prev => ({ ...prev, [key]: true }));
        try {
            await omni.likeComment(song, comment.id, nextLiked);
            setComments(prev => prev.map(c => String(c.id) === key
                ? { ...c, liked: nextLiked, likedCount: typeof c.likedCount === 'number' ? Math.max(0, c.likedCount + (nextLiked ? 1 : -1)) : c.likedCount }
                : c));
        } catch {
            setStatusMessage({ type: 'error', text: t('panel.commentsLikeFailed') });
        } finally {
            setPendingLikes(prev => {
                const next = { ...prev };
                delete next[key];
                return next;
            });
        }
    }, [pendingLikes, song, t]);

    // 组件常驻在面板树里（供退出动画），所以拉取必须由「打开」而不是挂载触发。
    // 清缓存只跟歌走：关窗再打开同一首歌，评论与楼中楼照原样显示，不重新拉一遍
    // （用户常见路径就是看一眼评论、关窗、再打开确认）。
    const loadedSongIdRef = useRef<MediaId | null>(null);
    useEffect(() => {
        if (!isOpen) return;
        if (loadedSongIdRef.current === song.id) return;
        loadedSongIdRef.current = song.id;
        offsetRef.current = 0;
        setComments([]);
        setHasMore(false);
        setRepliesById({});
        setExpandedReplyId(null);
        replySeqRef.current += 1;
        void fetchPage(0, true);
    }, [isOpen, fetchPage, song.id]);

    // Esc 关闭：与 LyricsTimelineModal 同一套——命令面板盖在上面时，Esc 归它自己。
    useEffect(() => {
        if (!isOpen) return undefined;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.repeat) return;
            const target = event.target;
            if (target instanceof Element) {
                const owner = target.closest('[data-folia-keyboard-window="true"]');
                if (owner && owner !== windowRef.current) return;
            }
            event.preventDefault();
            event.stopPropagation();
            onClose();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    const body = loading ? (
        <div className="flex items-center justify-center gap-2 py-10">
            <Loader2 size={16} className="animate-spin opacity-60" />
            <span className={`text-sm ${textSecondary}`}>{t('panel.commentsLoading')}</span>
        </div>
    ) : error ? (
        <div className="flex flex-col items-center justify-center gap-3 py-10">
            <span className={`text-sm ${textSecondary}`}>{t('panel.commentsError')}</span>
            <button
                type="button"
                onClick={() => void fetchPage(0, true)}
                className={`rounded-full px-3 py-1 text-xs ${cardBg} ${textPrimary} transition-colors hover:opacity-80`}
            >
                {t('panel.commentsRetry')}
            </button>
        </div>
    ) : comments.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10">
            <MessageCircle size={20} className={textSecondary} />
            <span className={`text-sm ${textSecondary}`}>{t('panel.commentsEmpty')}</span>
        </div>
    ) : (
        <div className="flex flex-col gap-2">
            {comments.map((comment, index) => (
                <div
                    key={`${comment.id}-${index}`}
                    className={`rounded-xl p-3 ${cardBg}`}
                >
                    <div className="flex items-center gap-2 mb-1.5">
                        {comment.avatarUrl ? (
                            <img src={comment.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover shrink-0" loading="lazy" />
                        ) : (
                            <div className={`h-7 w-7 rounded-full ${cardBg} shrink-0`} />
                        )}
                        <span className={`text-xs font-medium truncate ${textPrimary}`}>{comment.userName}</span>
                        {comment.isHot && (
                            <span className={`rounded px-1.5 py-0.5 text-[10px] shrink-0 ${hotBg}`}>{t('panel.commentsHot')}</span>
                        )}
                    </div>
                    <p className={`text-sm leading-relaxed whitespace-pre-wrap break-words ${textPrimary}`}>{comment.content}</p>
                    <div className={`mt-1.5 flex items-center gap-3 text-[11px] ${textSecondary}`}>
                        {canLike ? (
                            <button
                                type="button"
                                aria-pressed={Boolean(comment.liked)}
                                disabled={Boolean(pendingLikes[String(comment.id)])}
                                onClick={() => void toggleLike(comment)}
                                className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 transition-colors disabled:opacity-50 ${
                                    comment.liked
                                        ? hotBg
                                        : `${textSecondary} hover:opacity-80`
                                }`}
                            >
                                <ThumbsUp size={11} fill={comment.liked ? 'currentColor' : 'none'} />
                                {typeof comment.likedCount === 'number' ? formatCount(comment.likedCount) : null}
                            </button>
                        ) : (typeof comment.likedCount === 'number' && (
                            // 不能点赞的 provider（QQ/酷狗）：纯文字展示，不带 ThumbsUp 图标——
                            // 图标会让它看起来像能点，用户点了没反应正来自这个误导。
                            <span>{t('panel.commentsLikeCount', { n: formatCount(comment.likedCount) })}</span>
                        ))}
                        {comment.timeStr && <span>{comment.timeStr}</span>}
                        {comment.ipLocation && <span className="flex items-center gap-0.5"><MapPin size={10} />{comment.ipLocation}</span>}
                    </div>
                    {canReplies && (() => {
                        const key = String(comment.id);
                        const entry = repliesById[key];
                        const expanded = expandedReplyId === key;
                        return (
                            <div className="mt-1.5">
                                <button
                                    type="button"
                                    onClick={() => toggleReplies(key)}
                                    className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${cardBg} ${textSecondary} transition-colors hover:opacity-80`}
                                >
                                    <MessageCircle size={11} />
                                    {expanded ? t('panel.commentsHideReplies') : t('panel.commentsViewReplies')}
                                </button>
                                {expanded && (
                                    <div className={`mt-2 space-y-2 rounded-lg p-2.5 ${isDaylight ? 'bg-black/[0.025]' : 'bg-white/[0.03]'}`}>
                                        {entry?.loading && !entry.replies.length && (
                                            <div className={`flex items-center gap-1.5 py-1 text-[11px] ${textSecondary}`}>
                                                <Loader2 size={12} className="animate-spin" />
                                                {t('panel.commentsRepliesLoading')}
                                            </div>
                                        )}
                                        {entry?.error && !entry.replies.length && (
                                            <button
                                                type="button"
                                                onClick={() => void loadReplies(key, 0, true)}
                                                className={`text-[11px] ${textSecondary} underline underline-offset-2`}
                                            >
                                                {t('panel.commentsRepliesError')}
                                            </button>
                                        )}
                                        {entry && !entry.loading && !entry.error && entry.replies.length === 0 && (
                                            <span className={`text-[11px] ${textSecondary}`}>{t('panel.commentsRepliesEmpty')}</span>
                                        )}
                                        {entry?.replies.map((reply, replyIndex) => (
                                            <div key={`${reply.id}-${replyIndex}`} className="flex items-start gap-2">
                                                {reply.avatarUrl ? (
                                                    <img src={reply.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover shrink-0" loading="lazy" />
                                                ) : (
                                                    <div className={`h-6 w-6 rounded-full ${cardBg} shrink-0`} />
                                                )}
                                                <div className="min-w-0 flex-1">
                                                    <span className={`text-xs font-medium ${textSecondary}`}>{reply.userName}</span>
                                                    <p className={`text-sm leading-relaxed whitespace-pre-wrap break-words ${textPrimary}`}>{reply.content}</p>
                                                    <div className={`mt-0.5 flex items-center gap-2 text-[11px] ${textSecondary}`}>
                                                        {typeof reply.likedCount === 'number' && (
                                                            <span>{t('panel.commentsLikeCount', { n: formatCount(reply.likedCount) })}</span>
                                                        )}
                                                        {reply.timeStr && <span>{reply.timeStr}</span>}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                        {entry?.hasMore && !entry.loading && (
                                            <button
                                                type="button"
                                                onClick={() => void loadReplies(key, entry.offset, false)}
                                                className={`text-[11px] ${textSecondary} underline underline-offset-2`}
                                            >
                                                {t('panel.commentsLoadMore')}
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })()}
                </div>
            ))}
            {hasMore && (
                <button
                    type="button"
                    disabled={loadingMore}
                    onClick={() => void fetchPage(offsetRef.current, false)}
                    className={`mx-auto my-1 flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs ${cardBg} ${textPrimary} transition-opacity disabled:opacity-50`}
                >
                    {loadingMore && <Loader2 size={12} className="animate-spin" />}
                    {t('panel.commentsLoadMore')}
                </button>
            )}
        </div>
    );

    return createPortal(
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    ref={windowRef}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    data-folia-keyboard-window="true"
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md"
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ scale: 0.92, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.92, opacity: 0 }}
                        className={`w-[92vw] max-w-xl h-[76vh] ${glassBg} border ${borderColor} rounded-2xl p-6 relative flex flex-col`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-center gap-4 mb-4 flex-shrink-0">
                            <div className="min-w-0">
                                <h2 className={`text-lg font-semibold truncate ${headerText}`}>{song.name}</h2>
                                <p className={`text-xs ${textSecondary}`}>{t('panel.comments')}</p>
                            </div>
                            <button
                                type="button"
                                onClick={onClose}
                                aria-label={t('ui.close')}
                                className={`p-2 rounded-full transition-colors ${closeBtnHover}`}
                            >
                                <X size={20} className={closeIconColor} />
                            </button>
                        </div>
                        <div
                            className="flex-1 overflow-y-auto overflow-x-hidden pr-1 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent"
                            style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.2) transparent' }}
                        >
                            {body}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>,
        document.body,
    );
};

export default CommentsModal;
