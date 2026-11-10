import React from 'react';
import { Check, Heart, ListMusic, Loader2, Music2, Plus, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ThemedDialog from './ThemedDialog';
import { SheetButton } from './Sheet';

// src/components/shared/PlaylistSelectionDialog.tsx
// 「收藏到歌单」的选择器（播放页星标、速记簿、资料库卡片上的悬浮按钮共用；网格的 Navidrome 集合也用它）。
// 从上到下：要放进去的歌（封面叠放 + 标题 / 歌手或首数），歌单多时的搜索框，一张列表卡——「我喜欢」排在最前
// （红心图标，已经喜欢时写一句），其余歌单带封面缩略图与首数，点了就放、这一行转圈、放好关掉；列表下面是新建歌单：
// 给了 onCreateNamed 就在这里展开输入框直接建，只给 onCreate 时交给调用方自己的对话框。

export interface PlaylistSelectionDialogItem {
    id: string | number;
    name: string;
    description?: string;
    /** 歌单封面（缩略图）；没有就画占位图标。 */
    coverUrl?: string;
    /** 「我喜欢」：红心图标、排在最前、不参与搜索。 */
    kind?: 'liked';
    /** 行尾的一句状态（「我喜欢」已经喜欢时）。 */
    note?: string;
}

/** 要放进歌单的歌：标题、副标题（歌手 · 来源，或首数）与最多三张封面。 */
export interface PlaylistSelectionSubject {
    title: string;
    subtitle?: string;
    coverUrls?: readonly string[];
}

interface PlaylistSelectionDialogProps {
    isOpen: boolean;
    title: string;
    description?: string;
    subject?: PlaylistSelectionSubject;
    playlists: readonly PlaylistSelectionDialogItem[];
    isDaylight?: boolean;
    onClose: () => void;
    onSelect: (playlistId: string | number) => Promise<void> | void;
    /** 调用方自己的「新建歌单」对话框。 */
    onCreate?: () => void;
    /** 就地新建：输入名字后建好并放进去；给了它就不用 onCreate。 */
    onCreateNamed?: (name: string) => Promise<void>;
    createLabel?: string;
}

/** 歌单超过这么多个才出搜索框。 */
const SEARCH_THRESHOLD = 6;

const Thumb: React.FC<{ url?: string; className: string; fallback: React.ReactNode }> = ({ url, className, fallback }) => {
    const [failed, setFailed] = React.useState(false);
    return (
        <span className={`${className} grid shrink-0 place-items-center overflow-hidden bg-[var(--st-fill2)] text-[color:var(--st-t3)]`}>
            {url && !failed
                ? <img src={url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" onError={() => setFailed(true)} />
                : fallback}
        </span>
    );
};

const PlaylistSelectionDialog: React.FC<PlaylistSelectionDialogProps> = ({
    isOpen,
    title,
    description,
    subject,
    playlists,
    isDaylight = false,
    onClose,
    onSelect,
    onCreate,
    onCreateNamed,
    createLabel,
}) => {
    const { t } = useTranslation();
    const [submittingId, setSubmittingId] = React.useState<string | number | null>(null);
    const [query, setQuery] = React.useState('');
    // 就地新建：null 是收着；字符串是正在输入的名字。
    const [draftName, setDraftName] = React.useState<string | null>(null);
    const [isCreating, setIsCreating] = React.useState(false);
    // 每次打开记一代：一个慢请求结束时只关它自己那一次打开的选择器，不关之后又打开的那个。
    const openRunRef = React.useRef(0);
    if (isOpen && openRunRef.current % 2 === 0) openRunRef.current += 1;
    if (!isOpen && openRunRef.current % 2 === 1) openRunRef.current += 1;

    React.useEffect(() => {
        if (!isOpen) {
            setSubmittingId(null);
            setQuery('');
            setDraftName(null);
            setIsCreating(false);
        }
    }, [isOpen]);

    const liked = playlists.filter(item => item.kind === 'liked');
    const regular = playlists.filter(item => item.kind !== 'liked');
    const needle = query.trim().toLocaleLowerCase();
    const shownRegular = needle ? regular.filter(item => item.name.toLocaleLowerCase().includes(needle)) : regular;
    const shown = needle ? shownRegular : [...liked, ...shownRegular];
    const busy = submittingId !== null || isCreating;
    const canCreate = Boolean(onCreateNamed || onCreate);
    const label = createLabel || t('localMusic.createPlaylist');

    const pick = async (id: string | number) => {
        const run = openRunRef.current;
        try {
            setSubmittingId(id);
            await onSelect(id);
            if (openRunRef.current === run) onClose();
        } finally {
            setSubmittingId(null);
        }
    };

    const confirmCreate = async () => {
        const name = draftName?.trim();
        if (!onCreateNamed || !name || busy) return;
        const run = openRunRef.current;
        try {
            setIsCreating(true);
            await onCreateNamed(name);
            if (openRunRef.current === run) onClose();
        } finally {
            setIsCreating(false);
        }
    };

    const covers = subject?.coverUrls?.slice(0, 3) ?? [];

    return (
        <ThemedDialog
            isOpen={isOpen}
            onClose={onClose}
            isDaylight={isDaylight}
            title={title}
            description={subject ? undefined : description}
            size="m"
            fill
            // 放进去的请求还在走（一组逐首点红心可能要好几秒）：先不让关，关了也停不下它。
            closeDisabled={busy}
            closeDisabledTitle={t('playlist.saving')}
        >
            {subject && (
                <div className="mb-3.5 flex shrink-0 items-center gap-3" data-playlist-picker-subject="">
                    <span className="relative h-12 shrink-0" style={{ width: 48 + Math.max(0, covers.length - 1) * 10 }}>
                        {(covers.length > 0 ? covers : [undefined]).map((url, index, all) => (
                            <span
                                key={index}
                                className="absolute top-0 h-12 w-12 overflow-hidden rounded-lg shadow-[0_0_0_1px_var(--st-line),0_2px_8px_rgb(0_0_0/18%)]"
                                style={{ left: index * 10, zIndex: all.length - index }}
                            >
                                <Thumb url={url} className="h-full w-full" fallback={<Music2 size={18} />} />
                            </span>
                        ))}
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold leading-5 text-[color:var(--st-t1)]">{subject.title}</span>
                        {subject.subtitle && (
                            <span className="block truncate text-xs leading-[18px] text-[color:var(--st-t2)]">{subject.subtitle}</span>
                        )}
                    </span>
                </div>
            )}

            {regular.length > SEARCH_THRESHOLD && (
                <label className="st-t-fast mb-2.5 flex h-9 shrink-0 items-center gap-2 rounded-lg border border-transparent bg-[var(--st-fill)] px-3 transition-colors focus-within:border-[var(--st-accent)]">
                    <Search size={14} className="shrink-0 text-[color:var(--st-t3)]" />
                    <input
                        data-autofocus
                        type="search"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={t('playlist.searchPlaylists')}
                        aria-label={t('playlist.searchPlaylists')}
                        className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-[color:var(--st-t1)] outline-none placeholder:text-[color:var(--st-t3)]"
                    />
                </label>
            )}

            {shown.length > 0 ? (
                // The list scrolls; the lines above and below it stay.
                <div className="st-card st-scroll min-h-0 overflow-y-auto rounded-xl bg-[var(--st-card)] shadow-[0_0_0_1px_var(--st-line)]" role="list">
                    {shown.map((playlist) => {
                        const isLiked = playlist.kind === 'liked';
                        const isSubmitting = submittingId === playlist.id;
                        return (
                            <button
                                key={`${playlist.kind ?? 'playlist'}:${playlist.id}`}
                                type="button"
                                role="listitem"
                                data-playlist-picker-item={isLiked ? 'liked' : 'playlist'}
                                onClick={() => void pick(playlist.id)}
                                disabled={busy}
                                className="group st-row st-focus-inside st-t-fast relative flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left transition-colors enabled:hover:bg-[var(--st-fill)] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {isLiked ? (
                                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--st-accent)_18%,transparent)] text-[color:var(--st-accent)]">
                                        <Heart size={18} fill="currentColor" />
                                    </span>
                                ) : (
                                    <Thumb url={playlist.coverUrl} className="h-10 w-10 rounded-lg" fallback={<ListMusic size={18} />} />
                                )}
                                <span className="min-w-0 flex-1">
                                    <span className={`block truncate text-sm leading-5 ${isLiked ? 'font-semibold' : ''}`}>{playlist.name}</span>
                                    {playlist.description && (
                                        <span className="block truncate text-xs leading-[18px] text-[color:var(--st-t2)]">{playlist.description}</span>
                                    )}
                                </span>
                                {playlist.note && !isSubmitting && (
                                    <span className="flex shrink-0 items-center gap-1 text-xs text-[color:var(--st-t2)]">
                                        <Check size={13} />
                                        {playlist.note}
                                    </span>
                                )}
                                {isSubmitting
                                    ? <Loader2 size={16} className="shrink-0 animate-spin text-[color:var(--st-t2)]" />
                                    : !playlist.note && (
                                        <Plus size={16} className="shrink-0 text-[color:var(--st-t3)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                                    )}
                            </button>
                        );
                    })}
                </div>
            ) : (
                <div className="py-8 text-center text-[13px] text-[color:var(--st-t3)]">
                    {needle ? t('playlist.noMatchingPlaylists') : (t('localMusic.noPlaylistsFound') || 'No playlists yet')}
                </div>
            )}

            {canCreate && (
                draftName !== null && onCreateNamed ? (
                    <div className="mt-3 flex shrink-0 items-center gap-2" data-playlist-picker-create="">
                        <input
                            autoFocus
                            type="text"
                            value={draftName}
                            onChange={(event) => setDraftName(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    void confirmCreate();
                                } else if (event.key === 'Escape') {
                                    // 只收起输入框，不关整个选择器（Sheet 认 defaultPrevented 为「已经有人处理了」）。
                                    event.preventDefault();
                                    setDraftName(null);
                                }
                            }}
                            placeholder={t('localMusic.enterPlaylistName')}
                            aria-label={t('localMusic.enterPlaylistName')}
                            disabled={isCreating}
                            className="st-t-fast h-9 min-w-0 flex-1 rounded-lg border border-transparent bg-[var(--st-fill)] px-3 text-[13px] text-[color:var(--st-t1)] outline-none transition-colors placeholder:text-[color:var(--st-t3)] focus:border-[var(--st-accent)]"
                        />
                        <SheetButton variant="primary" onClick={() => void confirmCreate()} disabled={isCreating || !draftName.trim()}>
                            {isCreating ? <Loader2 size={14} className="animate-spin" /> : t('playlist.createAndAdd')}
                        </SheetButton>
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={() => (onCreateNamed ? setDraftName('') : onCreate?.())}
                        disabled={busy}
                        data-playlist-picker-create=""
                        className="st-t-fast mt-3 flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--st-line)] text-[13px] text-[color:var(--st-t2)] transition-colors enabled:hover:bg-[var(--st-fill)] enabled:hover:text-[color:var(--st-t1)] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <Plus size={16} />
                        {label}
                    </button>
                )
            )}
        </ThemedDialog>
    );
};

export default PlaylistSelectionDialog;
