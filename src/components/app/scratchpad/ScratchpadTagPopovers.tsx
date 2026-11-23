import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, Plus, Trash2, X } from 'lucide-react';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import { useAllSongNotes } from '../../song-notes/useSongNotesStore';
import { deleteTag, moveTag, renameTag, tagSongsReported, untagSongsReported } from '../../song-notes/songNoteActions';
import { normalizeTagName, tagKeyOf } from '../../song-notes/songNotesModel';
import { closeTagPopover, useSongNoteTagPopoverStore, type SongNoteTagPopover } from './songNoteTagPopoverStore';

// src/components/app/scratchpad/ScratchpadTagPopovers.tsx
// 速记簿里的两块标签小浮层（开着哪块在 songNoteTagPopoverStore）。贴着打开它的按钮画（视口坐标，fixed），
// 放不下就翻到按钮上面、往左收；墨色底、米白字，同展开整页的浮动菜单。点浮层外面、按 Esc 收起（Esc 不再往外传，
// 不会顺手收掉画布的选择或整页）。
// - 整理标签：改名（改成另一个已有的标签时先问「合并过去？」）、往前 / 往后挪一位、删除（连点两下，评论不动）；
// - 批量打标签：输入一个标签 Enter 打上，或点一个已有的标签；下面列出这批歌上已有的标签，点了从这批歌上去掉。

/** 已有的标签最多列几个（输入时按输入过滤）。 */
const MAX_TAG_CHIPS = 24;
const EDGE = 12;
const GAP = 6;
/** 删除要在这么久之内点第二下。 */
const DELETE_CONFIRM_MS = 3000;

/**
 * 贴着按钮放：先放下面，放不下放上面；左右不出视口。每次渲染后都量一次（浮层第一次渲染时数据可能还没读到、先不画，
 * 只在挂上那一次量会量空；内容变高变矮也要重放）。只读写这一个元素的尺寸与位置，浮层很小。
 */
const usePlacement = (anchor: DOMRect) => {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return;
        const { offsetWidth: width, offsetHeight: height } = element;
        const below = anchor.bottom + GAP;
        const top = below + height <= window.innerHeight - EDGE ? below : Math.max(EDGE, anchor.top - GAP - height);
        const left = Math.min(Math.max(EDGE, anchor.left + anchor.width / 2 - width / 2), Math.max(EDGE, window.innerWidth - width - EDGE));
        element.style.top = `${top}px`;
        element.style.left = `${left}px`;
        element.style.visibility = 'visible';
    });
    return ref;
};

/** 点外面收起；Esc 收起（不往外传）。 */
const useDismiss = (ref: React.RefObject<HTMLDivElement | null>) => {
    useEffect(() => {
        const onPointerDown = (event: PointerEvent) => {
            if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) closeTagPopover();
        };
        window.addEventListener('pointerdown', onPointerDown, true);
        return () => window.removeEventListener('pointerdown', onPointerDown, true);
    }, [ref]);
};

/** 浮层里归它自己的键：移动光标、删字、在按钮间走（不让抽屉、画布、墙接走）。带修饰键的快捷键照常冒出去。 */
const OWN_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Home', 'End', 'PageUp', 'PageDown', 'Delete', 'Backspace', 'Tab']);

const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
        if (event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        closeTagPopover();
        return;
    }
    if (OWN_KEYS.has(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) event.stopPropagation();
};

const TagEditor: React.FC<{ open: Extract<SongNoteTagPopover, { kind: 'editor' }> }> = ({ open }) => {
    const { t } = useTranslation();
    const { tags, rows } = useAllSongNotes();
    const index = tags.findIndex(tag => tag.key === open.tagKey);
    const tag = index >= 0 ? tags[index] : null;
    const count = useMemo(() => rows.filter(row => row.tags.includes(open.tagKey)).length, [open.tagKey, rows]);
    const [draft, setDraft] = useState(tag?.name ?? '');
    const [conflict, setConflict] = useState<string | null>(null);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [busy, setBusy] = useState(false);
    const ref = usePlacement(open.anchor);
    useDismiss(ref);
    useEffect(() => {
        if (!confirmingDelete) return;
        const timer = window.setTimeout(() => setConfirmingDelete(false), DELETE_CONFIRM_MS);
        return () => window.clearTimeout(timer);
    }, [confirmingDelete]);
    // 标签被别处删掉了（别的窗口、刚合并走）：收起。
    useEffect(() => {
        if (tags.length > 0 && !tag) closeTagPopover();
    }, [tag, tags.length]);
    if (!tag) return null;

    const submit = async (merge: boolean) => {
        const name = normalizeTagName(draft);
        if (!name || busy) return;
        if (name === tag.name) {
            closeTagPopover();
            return;
        }
        setBusy(true);
        const result = await renameTag(tag.key, name, merge);
        setBusy(false);
        if (result.ok) closeTagPopover();
        else if (result.error === 'conflict') setConflict(tags.find(other => other.key === tagKeyOf(name))?.name ?? name);
    };
    const remove = async () => {
        if (!confirmingDelete) {
            setConfirmingDelete(true);
            return;
        }
        setBusy(true);
        await deleteTag(tag.key, tag.name);
        closeTagPopover();
    };

    return (
        <div
            ref={ref}
            className="scratchpad-tag-popover"
            role="dialog"
            aria-label={t('songNotes.tagEditorTitle', { tag: tag.name })}
            onKeyDown={handleKeyDown}
            data-testid="scratchpad-tag-editor"
        >
            <p className="scratchpad-tag-popover-title">
                <span>#{tag.name}</span>
                <span className="scratchpad-tag-popover-count">{t('scratchpad.count', { count })}</span>
            </p>
            <form
                className="scratchpad-tag-popover-field"
                onSubmit={event => {
                    event.preventDefault();
                    void submit(false);
                }}
            >
                <input
                    // 打开就能直接改名。
                    autoFocus
                    value={draft}
                    aria-label={t('songNotes.renameTag')}
                    placeholder={t('songNotes.renameTag')}
                    onChange={event => {
                        setDraft(event.target.value);
                        setConflict(null);
                    }}
                />
                <button type="submit" className="scratchpad-tag-popover-button" disabled={busy || !normalizeTagName(draft)}>
                    {t('songNotes.renameTag')}
                </button>
            </form>
            {conflict && (
                <div className="scratchpad-tag-popover-ask" role="alert">
                    <span>{t('songNotes.mergeAsk', { tag: conflict })}</span>
                    <button type="button" className="scratchpad-tag-popover-button is-mark" disabled={busy} onClick={() => void submit(true)}>
                        {t('songNotes.merge')}
                    </button>
                    <button type="button" className="scratchpad-tag-popover-button" onClick={() => setConflict(null)}>
                        {t('songNotes.cancel')}
                    </button>
                </div>
            )}
            <div className="scratchpad-tag-popover-row">
                <button type="button" className="scratchpad-tag-popover-button" disabled={busy || index === 0} onClick={() => void moveTag(tag.key, -1)}>
                    <ArrowLeft aria-hidden="true" />
                    {t('songNotes.moveTagEarlier')}
                </button>
                <button type="button" className="scratchpad-tag-popover-button" disabled={busy || index === tags.length - 1} onClick={() => void moveTag(tag.key, 1)}>
                    <ArrowRight aria-hidden="true" />
                    {t('songNotes.moveTagLater')}
                </button>
                <span className="scratchpad-tag-popover-spacer" />
                <button
                    type="button"
                    className={`scratchpad-tag-popover-button${confirmingDelete ? ' is-danger' : ''}`}
                    disabled={busy}
                    onClick={() => void remove()}
                >
                    <Trash2 aria-hidden="true" />
                    {confirmingDelete ? t('songNotes.confirmDeleteTag') : t('songNotes.deleteTag')}
                </button>
            </div>
        </div>
    );
};

const BatchTagger: React.FC<{ open: Extract<SongNoteTagPopover, { kind: 'batch' }> }> = ({ open }) => {
    const { t } = useTranslation();
    const { tags, rows } = useAllSongNotes();
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const ref = usePlacement(open.anchor);
    useDismiss(ref);
    const songKeys = useMemo(() => new Set(open.songs.map(getPlaybackSongKey)), [open.songs]);
    // 这批歌上已有的标签（点了从这批歌上去掉）。
    const present = useMemo(() => {
        const used = new Set<string>();
        for (const row of rows) if (songKeys.has(row.key)) row.tags.forEach(key => used.add(key));
        return tags.filter(tag => used.has(tag.key));
    }, [rows, songKeys, tags]);
    const needle = draft.trim().replace(/^[#＃]/u, '').toLocaleLowerCase();
    const choices = tags.filter(tag => !needle || tag.key.includes(needle) || tag.name.toLocaleLowerCase().includes(needle)).slice(0, MAX_TAG_CHIPS);

    const apply = async (name: string) => {
        if (busy || !normalizeTagName(name)) return;
        setBusy(true);
        const result = await tagSongsReported(open.songs, name);
        setBusy(false);
        if (result.ok) closeTagPopover();
    };
    const strip = async (tagKey: string, name: string) => {
        if (busy) return;
        setBusy(true);
        await untagSongsReported([...songKeys], tagKey, name);
        setBusy(false);
    };

    return (
        <div
            ref={ref}
            className="scratchpad-tag-popover"
            role="dialog"
            aria-label={t('songNotes.batchTagTitle', { count: open.songs.length })}
            onKeyDown={handleKeyDown}
            data-testid="scratchpad-batch-tagger"
        >
            <p className="scratchpad-tag-popover-title">{t('songNotes.batchTagTitle', { count: open.songs.length })}</p>
            <form
                className="scratchpad-tag-popover-field"
                onSubmit={event => {
                    event.preventDefault();
                    void apply(draft);
                }}
            >
                <input
                    // 打开就能直接打字。
                    autoFocus
                    value={draft}
                    aria-label={t('songNotes.batchTagPlaceholder')}
                    placeholder={t('songNotes.batchTagPlaceholder')}
                    onChange={event => setDraft(event.target.value)}
                />
                <button type="submit" className="scratchpad-tag-popover-button is-mark" disabled={busy || !normalizeTagName(draft)}>
                    <Plus aria-hidden="true" />
                    {t('songNotes.batchTagApply')}
                </button>
            </form>
            {choices.length > 0 && (
                <div className="scratchpad-tag-popover-chips" role="group" aria-label={t('songNotes.batchTagExisting')}>
                    {choices.map(tag => (
                        <button key={tag.key} type="button" className="scratchpad-tag-chip" disabled={busy} onClick={() => void apply(tag.name)}>
                            #{tag.name}
                        </button>
                    ))}
                </div>
            )}
            {present.length > 0 && (
                <>
                    <p className="scratchpad-tag-popover-label">{t('songNotes.batchTagPresent')}</p>
                    <div className="scratchpad-tag-popover-chips" role="group" aria-label={t('songNotes.batchTagPresent')}>
                        {present.map(tag => (
                            <button
                                key={tag.key}
                                type="button"
                                className="scratchpad-tag-chip is-removable"
                                disabled={busy}
                                title={t('songNotes.removeTagFromSelection', { tag: tag.name })}
                                aria-label={t('songNotes.removeTagFromSelection', { tag: tag.name })}
                                onClick={() => void strip(tag.key, tag.name)}
                            >
                                #{tag.name}
                                <X aria-hidden="true" />
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

const ScratchpadTagPopovers: React.FC = () => {
    const open = useSongNoteTagPopoverStore(state => state.open);
    // 速记簿收起、换页时一起收起（宿主在这些时候把它卸掉）。
    useEffect(() => () => closeTagPopover(), []);
    // 浮层收起后焦点别掉到 body：交还给画布（Esc、Delete、方向键接着归画布与抽屉）。
    const wasOpen = useRef(false);
    useEffect(() => {
        if (open) {
            wasOpen.current = true;
            return;
        }
        if (!wasOpen.current) return;
        wasOpen.current = false;
        const active = document.activeElement;
        if (!active || active === document.body) {
            document.querySelector<HTMLElement>('.scratchpad-drawer .scratchpad-canvas')?.focus({ preventScroll: true });
        }
    }, [open]);
    if (!open) return null;
    // key：换了一个标签、换了一批歌就是另一块浮层（草稿、确认不带过去）。
    return open.kind === 'editor'
        ? <TagEditor key={`editor:${open.tagKey}`} open={open} />
        : <BatchTagger key={`batch:${open.songs.length}:${open.anchor.left}:${open.anchor.top}`} open={open} />;
};

export default ScratchpadTagPopovers;
