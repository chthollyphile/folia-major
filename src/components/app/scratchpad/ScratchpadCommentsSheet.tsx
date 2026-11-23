import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListPlus, MessageSquareQuote, NotebookPen, Play, Search, Star, Tag, Tags, X } from 'lucide-react';
import type { SongResult } from '../../../types';
import { collectToScratchpad } from '../../../stores/useScratchpadStore';
import { canOpenPlaylistPickerFor, openAddSongsToPlaylist } from '../../../stores/useAddToPlaylistStore';
import { PRIMARY_MODIFIER_LABEL } from '../../../utils/platform';
import { useReducedMotionFor } from '../../../hooks/useReducedMotionFor';
import { useAllSongNotes, useSongNotesStore } from '../../song-notes/useSongNotesStore';
import { searchSongNoteKeys } from '../../song-notes/songNotesService';
import { untagSongsReported } from '../../song-notes/songNoteActions';
import type { SongNoteTag } from '../../song-notes/songNotesModel';
import type { CanvasEntry } from './ScratchpadCard';
import ScratchpadCanvas, { type CanvasGroup, type CanvasSide } from './ScratchpadCanvas';
import { ScratchpadBandActions } from './ScratchpadSheet';
import { CATALOG_SPACING } from './canvasLayout';
import { buildSongNoteTagGroups, catalogCardFields } from './commentCards';
import { scratchpadTips, type ScratchpadAction } from './scratchpadModel';
import { SCRATCHPAD_TILT_DEG } from './scratchpadTilt';
import { openBatchTagger, openTagEditor } from './songNoteTagPopoverStore';
import type { ScratchpadPlayback } from './ScratchpadHost';

// src/components/app/scratchpad/ScratchpadCommentsSheet.tsx
// 「时刻」页的展开整页（第二阶段）：按标签分组的图书馆目录卡（红顶线、横格、编号，设计稿 G 组），一个标签一组，按标签的先后；
// 组里的歌按打上这个标签的先后（用户定，不能手动排）；一首歌有几个标签就出现在几组里，没打标签的在最后一组「未加标签」。
// 画布与另外三页共用（ScratchpadCanvas）：框选、Ctrl 单击多选；单击一张卡是在面板里看这一首（onActivate），卡上的播放钮插进队列播放。
// 组头：播放这一组（换掉队列）、加入队列、收进速记簿、加入歌单，标签组再多一颗「整理标签」（改名 / 合并、挪先后、删除，ScratchpadTagPopovers）。
// 多选的浮动菜单：入队、加入歌单、收进速记簿、打标签（批量）、移出这个标签。
// 信息条右端是搜索框（用户定：「不做过滤」的例外，只这一页有）：搜歌名、歌手、专辑、标签、评论的字，打字停下来才搜。
// 命令 #标签、首页的标签卡经 useSongNotesStore 的 tagFocus 要滚到某一组：整页接过这个要求就把它清掉（只滚这一次，以后再展开
// 不会又滚回去），清空搜索（免得那一组正被搜索藏着），画布重挂一次，focusKey 落在那组第一张。

/** 打字停这么久才搜。 */
const SEARCH_DELAY_MS = 220;
/** 搜索框里归它自己的键（同抽屉拦下的那几个，ScratchpadHost 的 DRAWER_KEYS，加上 Tab：在框里不换页）。 */
const TEXT_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Home', 'End', 'PageUp', 'PageDown', 'Delete', 'Backspace', 'Tab']);

type CommentEntry = CanvasEntry & { songKey: string; tagKey: string | null };

type ScratchpadCommentsSheetProps = {
    playback: ScratchpadPlayback;
    tagNames: ReadonlyMap<string, SongNoteTag>;
    playingKey: string | null;
    /** 单击一张卡：收回面板、看这一首。 */
    onOpen: (song: SongResult) => void;
    /** 没有选择时按 Esc：收回面板。 */
    onEscape: () => void;
};

const songsOf = (entries: readonly CommentEntry[]): SongResult[] => {
    const seen = new Set<string>();
    return entries.flatMap(entry => {
        if (seen.has(entry.songKey)) return [];
        seen.add(entry.songKey);
        return [entry.song];
    });
};

const ScratchpadCommentsSheet: React.FC<ScratchpadCommentsSheetProps> = ({ playback, tagNames, playingKey, onOpen, onEscape }) => {
    const { t } = useTranslation();
    const { rows, tags, loaded } = useAllSongNotes();
    const requestedFocus = useSongNotesStore(state => state.tagFocus);
    const [tagFocus, setTagFocus] = useState<{ key: string; nonce: number } | null>(null);
    const tilt = useReducedMotionFor('uiMicroMotion') ? 0 : SCRATCHPAD_TILT_DEG;

    // 搜索：打字停下来才搜；库里变了（rows 换了）也重搜一遍。搜到的是歌的 key，null 是没在搜。
    const [query, setQuery] = useState('');
    const [matches, setMatches] = useState<ReadonlySet<string> | null>(null);
    useEffect(() => {
        if (!requestedFocus) return;
        setTagFocus(requestedFocus);
        setQuery('');
        useSongNotesStore.getState().clearTagFocus();
    }, [requestedFocus]);
    useEffect(() => {
        const text = query.trim();
        if (!text) {
            setMatches(null);
            return;
        }
        let alive = true;
        const timer = window.setTimeout(() => {
            void searchSongNoteKeys(text).then(found => {
                if (alive) setMatches(found);
            });
        }, SEARCH_DELAY_MS);
        return () => {
            alive = false;
            window.clearTimeout(timer);
        };
    }, [query, rows]);

    const latest = useRef({ playback, t, onOpen });
    latest.current = { playback, t, onOpen };

    const groups = useMemo(
        () => buildSongNoteTagGroups(rows, tags, matches, t('songNotes.untagged')),
        [matches, rows, t, tags],
    );
    const canvasGroups = useMemo<CanvasGroup<CommentEntry>[]>(() => groups.map(group => {
        const entries: CommentEntry[] = group.rows.map((row, index) => ({
            // 一首歌可以在好几组里：条目的 key 带上组。
            key: `${group.key}\u0001${row.key}`,
            songKey: row.key,
            tagKey: group.tagKey,
            song: row.song,
            ...catalogCardFields(row, tagNames, t),
            catalogNumber: t('songNotes.catalogNumber', { number: String(index + 1).padStart(2, '0') }),
            isCurrent: row.key === playingKey,
        }));
        const songs = group.rows.map(row => row.song);
        const name = group.tagKey ? `#${group.name}` : group.name;
        const buttons: ScratchpadAction[] = [
            { id: 'play-group', label: t('songNotes.playGroup'), icon: Play, run: () => latest.current.playback.replaceQueue(songs) },
            { id: 'enqueue-group', label: t('scratchpad.enqueueGroup'), icon: ListPlus, run: () => latest.current.playback.enqueueAll(songs) },
            { id: 'collect-group', label: t('songNotes.collectGroup'), icon: NotebookPen, run: () => collectToScratchpad(songs, { label: name }) },
            {
                id: 'save-group',
                label: t('scratchpad.addToPlaylist'),
                icon: Star,
                run: () => openAddSongsToPlaylist(songs),
                disabled: !songs.every(canOpenPlaylistPickerFor),
            },
            ...(group.tagKey ? [{
                id: 'manage-tag',
                label: t('songNotes.manageTag'),
                icon: Tags,
                run: () => openTagEditor(group.tagKey as string, group.key),
            }] : []),
        ];
        return { key: group.key, label: name, jumpLabel: name, mark: 'bracket', entries, buttons };
    }), [groups, playingKey, t, tagNames]);

    // 要滚到的那一组：它的第一张卡。画布按 nonce 重挂，同一个标签再点一次也滚过去。
    const focusKey = useMemo(() => {
        if (!tagFocus) return undefined;
        return canvasGroups.find(group => group.key === tagFocus.key)?.entries[0]?.key;
    }, [canvasGroups, tagFocus]);

    const side = useMemo<CanvasSide>(() => ({
        jumpLabel: t('scratchpad.jumpTo'),
        tipsLabel: t('scratchpad.tipsTitle'),
        mark: 'bracket',
        tips: scratchpadTips('comments', t, PRIMARY_MODIFIER_LABEL),
    }), [t]);

    const play = useCallback((entry: CommentEntry) => latest.current.playback.playNow(entry.song), []);
    const activate = useCallback((entry: CommentEntry) => latest.current.onOpen(entry.song), []);
    const selectionActions = useCallback((selected: CommentEntry[]): ScratchpadAction[] => {
        const { playback: port, t: translate } = latest.current;
        const songs = songsOf(selected);
        // 选中的卡在哪几个标签组里：「移出这个标签」按组去掉各自那个标签（未加标签组里的不算）。
        const byTag = new Map<string, string[]>();
        for (const entry of selected) {
            if (!entry.tagKey) continue;
            const list = byTag.get(entry.tagKey);
            if (list) list.push(entry.songKey);
            else byTag.set(entry.tagKey, [entry.songKey]);
        }
        return [
            { id: 'enqueue', label: translate('scratchpad.enqueue'), icon: ListPlus, run: () => port.enqueueAll(songs) },
            {
                id: 'add-to-playlist',
                label: translate('scratchpad.addToPlaylist'),
                icon: Star,
                run: () => openAddSongsToPlaylist(songs),
                disabled: !songs.every(canOpenPlaylistPickerFor),
            },
            { id: 'collect', label: translate('scratchpad.collect'), icon: NotebookPen, run: () => collectToScratchpad(songs) },
            { id: 'tag', label: translate('songNotes.batchTag'), icon: Tag, run: () => openBatchTagger(songs) },
            ...(byTag.size > 0 ? [{
                id: 'untag',
                label: translate('songNotes.removeFromTag'),
                icon: X,
                run: () => {
                    for (const [tagKey, keys] of byTag) void untagSongsReported(keys, tagKey, tagNames.get(tagKey)?.name ?? tagKey);
                },
            }] : []),
        ];
    }, [tagNames]);

    const search = (
        <ScratchpadBandActions>
            <label className="scratchpad-comments-search">
                <Search aria-hidden="true" />
                <input
                    type="search"
                    value={query}
                    placeholder={t('songNotes.searchPlaceholder')}
                    aria-label={t('songNotes.searchPlaceholder')}
                    data-testid="scratchpad-comments-search"
                    onChange={event => setQuery(event.target.value)}
                    // 搜索框里移动光标、删字的键是它自己的（不让抽屉、墙接走）；有字时 Esc 先清空，空的时候 Esc 照常收回整页。
                    // 带修饰键的快捷键（Ctrl / ⌘ + J 等）照常冒出去。
                    onKeyDown={event => {
                        if (event.key === 'Escape') {
                            if (!query) return;
                            event.preventDefault();
                            event.stopPropagation();
                            setQuery('');
                            return;
                        }
                        if (TEXT_KEYS.has(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) event.stopPropagation();
                    }}
                />
                {matches && <span className="scratchpad-comments-search-count">{t('scratchpad.count', { count: matches.size })}</span>}
            </label>
        </ScratchpadBandActions>
    );

    // 还没读到（冷启动第一次读库）：先什么都不画，不闪一下「还没有评论」。
    if (!loaded) return search;
    if (rows.length === 0) {
        return (
            <div className="scratchpad-empty">
                <MessageSquareQuote aria-hidden="true" />
                <p>{t('songNotes.empty')}</p>
            </div>
        );
    }
    return (
        <>
            {search}
            {canvasGroups.length === 0 ? (
                <div className="scratchpad-empty">
                    <Search aria-hidden="true" />
                    <p>{t('songNotes.searchEmpty')}</p>
                </div>
            ) : (
                <ScratchpadCanvas<CommentEntry>
                    key={`focus-${tagFocus?.nonce ?? 0}`}
                    groups={canvasGroups}
                    variant="catalog"
                    spacing={CATALOG_SPACING}
                    tilt={tilt}
                    side={side}
                    focusKey={focusKey}
                    ariaLabel={t('songNotes.title')}
                    testId="scratchpad-comments-sheet"
                    playLabel={t('scratchpad.play')}
                    currentLabel={t('scratchpad.nowPlaying')}
                    onPlay={play}
                    onActivate={activate}
                    selectionActions={selectionActions}
                    onEscape={onEscape}
                />
            )}
        </>
    );
};

export default ScratchpadCommentsSheet;
