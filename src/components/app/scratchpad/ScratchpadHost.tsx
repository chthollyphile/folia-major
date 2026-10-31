import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { ListPlus, NotebookPen, Play, Trash2, X } from 'lucide-react';
import type { SongResult } from '../../../types';
import { useScratchpadStore, type ScratchpadEntry } from '../../../stores/useScratchpadStore';
import { openAddSongToPlaylist } from '../../../stores/useAddToPlaylistStore';
import { omni } from '../../../services/onlineMusic/omni';
import { getPlaybackSourceRef } from '../../../utils/appPlaybackGuards';
import ScratchpadRow, { type ScratchpadRowActions, type ScratchpadRowLabels } from './ScratchpadRow';
import './scratchpad.css';

// src/components/app/scratchpad/ScratchpadHost.tsx
// 速记簿的界面：左缘的把手和从左边滑出的抽屉（设计稿 plan/scratchpad-spec.md）。抽屉非模态——不加遮罩、不抢焦点，
// 开着时背后照常能逛、能往里收。内容与开合在 useScratchpadStore；播放动作由 App 交进来（和资料库同一个播放端口），
// 这里只决定什么按钮做什么：单条的「播放」插进当前队列，不换队列；唯一会换掉队列的是底部明写了的「替换队列播放」。

/** App 交给速记簿的播放动作。 */
export type ScratchpadPlayback = {
    /** 插进当前队列并播放（已在队列里就直接跳过去），不换队列。 */
    playNow: (song: SongResult) => void;
    /** 按应用的入队规则加一首（本地 / Navidrome / 在线各走各的入队路径）。 */
    enqueue: (song: SongResult) => void;
    enqueueAll: (songs: SongResult[]) => void;
    /** 换掉队列，从第一首播起。 */
    replaceQueue: (songs: SongResult[]) => void;
};

type ScratchpadHostProps = {
    isDaylight: boolean;
    playback: ScratchpadPlayback;
};

/** 清空的第二下要在这么久之内点，过了就复原。 */
const CLEAR_CONFIRM_MS = 3000;

/** 这首能不能进某个歌单（选择器自己还会再判断有没有可选的歌单）。 */
const canAddToPlaylist = (song: SongResult): boolean => {
    const source = getPlaybackSourceRef(song);
    if (source.kind === 'local' || source.kind === 'navidrome') return true;
    return source.kind === 'online' && omni.canAddSongToPlaylist(song);
};

const ScratchpadHost: React.FC<ScratchpadHostProps> = ({ isDaylight, playback }) => {
    const { t } = useTranslation();
    const { entries, isOpen, addNonce, setOpen, toggleOpen, clear } = useScratchpadStore(useShallow(state => ({
        entries: state.entries,
        isOpen: state.isOpen,
        addNonce: state.addNonce,
        setOpen: state.setOpen,
        toggleOpen: state.toggleOpen,
        clear: state.clear,
    })));
    const listRef = useRef<HTMLUListElement>(null);
    const [confirmingClear, setConfirmingClear] = useState(false);

    // 新收进来的行：和上一批条目比出来，闪一下底色；抽屉开着时滚到第一条新行。
    const seenKeysRef = useRef<Set<string>>(new Set(entries.map(entry => entry.key)));
    const [freshKeys, setFreshKeys] = useState<ReadonlySet<string>>(() => new Set());
    useEffect(() => {
        const seen = seenKeysRef.current;
        const fresh = new Set(entries.filter(entry => !seen.has(entry.key)).map(entry => entry.key));
        seenKeysRef.current = new Set(entries.map(entry => entry.key));
        if (fresh.size === 0) return;
        setFreshKeys(fresh);
        const timer = window.setTimeout(() => setFreshKeys(new Set()), 1400);
        return () => window.clearTimeout(timer);
    }, [entries]);
    useEffect(() => {
        if (!isOpen || freshKeys.size === 0) return;
        const first = entries.find(entry => freshKeys.has(entry.key));
        if (!first) return;
        listRef.current?.querySelector(`[data-scratchpad-key="${CSS.escape(first.key)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [entries, freshKeys, isOpen]);

    // 把手闪一下：每收进一批（addNonce 变了）都闪，开着的抽屉不需要。
    const [pulsing, setPulsing] = useState(false);
    useEffect(() => {
        if (addNonce === 0) return;
        setPulsing(true);
        const timer = window.setTimeout(() => setPulsing(false), 900);
        return () => window.clearTimeout(timer);
    }, [addNonce]);

    useEffect(() => {
        if (!confirmingClear) return;
        const timer = window.setTimeout(() => setConfirmingClear(false), CLEAR_CONFIRM_MS);
        return () => window.clearTimeout(timer);
    }, [confirmingClear]);
    useEffect(() => {
        if (!isOpen) setConfirmingClear(false);
    }, [isOpen]);

    const latest = useRef(playback);
    latest.current = playback;
    const rowActions = useMemo<ScratchpadRowActions>(() => ({
        play: entry => latest.current.playNow(entry.song),
        enqueue: entry => latest.current.enqueue(entry.song),
        addToPlaylist: entry => openAddSongToPlaylist(entry.song),
        remove: entry => useScratchpadStore.getState().remove([entry.key]),
    }), []);
    const rowLabels = useMemo<ScratchpadRowLabels>(() => ({
        play: t('scratchpad.play'),
        enqueue: t('scratchpad.enqueue'),
        addToPlaylist: t('scratchpad.addToPlaylist'),
        remove: t('scratchpad.remove'),
    }), [t]);
    const sourceLabelOf = useCallback((entry: ScratchpadEntry) => {
        const source = getPlaybackSourceRef(entry.song);
        if (source.kind === 'online') return omni.getProviderLabel(source.providerId);
        if (source.kind === 'navidrome') return 'Navidrome';
        return t('scratchpad.sourceLocal');
    }, [t]);

    const songs = useMemo(() => entries.map(entry => entry.song), [entries]);
    const handleClear = () => {
        if (!confirmingClear) {
            setConfirmingClear(true);
            return;
        }
        setConfirmingClear(false);
        clear();
    };

    // Esc 收起：只管焦点在抽屉里的时候（抽屉非模态，别的地方的 Esc 是别人的）。焦点交还给把手，别掉到 body 上。
    const focusHandleRef = useRef(false);
    const handleKeyDown = (event: React.KeyboardEvent) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        focusHandleRef.current = true;
        setOpen(false);
    };
    const handleRef = useCallback((node: HTMLButtonElement | null) => {
        if (!node || !focusHandleRef.current) return;
        focusHandleRef.current = false;
        node.focus();
    }, []);

    const handleLabel = isOpen ? t('scratchpad.close') : t('scratchpad.open');

    return (
        <div className={`scratchpad-root${isDaylight ? ' is-daylight' : ''}`}>
            {!isOpen && (
                <div className={`scratchpad-edge${entries.length > 0 ? ' has-entries' : ''}`}>
                    <button
                        ref={handleRef}
                        type="button"
                        className={`scratchpad-handle${pulsing ? ' is-pulsing' : ''}`}
                        data-testid="scratchpad-handle"
                        title={handleLabel}
                        aria-label={handleLabel}
                        aria-expanded={false}
                        onClick={toggleOpen}
                    >
                        <NotebookPen aria-hidden="true" />
                        {entries.length > 0 && <span className="scratchpad-handle-count">{entries.length}</span>}
                    </button>
                </div>
            )}

            <AnimatePresence>
                {isOpen && (
                    <motion.aside
                        key="scratchpad-drawer"
                        className="scratchpad-drawer"
                        data-testid="scratchpad-drawer"
                        aria-label={t('scratchpad.title')}
                        initial={{ x: -32, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: -32, opacity: 0 }}
                        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        onKeyDown={handleKeyDown}
                    >
                        <header className="scratchpad-header">
                            <div className="scratchpad-title">
                                <h2>{t('scratchpad.title')}</h2>
                                <span>{t('scratchpad.count', { count: entries.length })}</span>
                            </div>
                            <button
                                type="button"
                                className="scratchpad-icon-button"
                                title={t('scratchpad.close')}
                                aria-label={t('scratchpad.close')}
                                onClick={() => setOpen(false)}
                            >
                                <X aria-hidden="true" />
                            </button>
                        </header>
                        <p className="scratchpad-hint">{t('scratchpad.hint')}</p>

                        {entries.length === 0 ? (
                            <div className="scratchpad-empty">
                                <NotebookPen aria-hidden="true" />
                                <p>{t('scratchpad.empty')}</p>
                            </div>
                        ) : (
                            <ul ref={listRef} className="scratchpad-list">
                                {entries.map(entry => (
                                    <ScratchpadRow
                                        key={entry.key}
                                        entry={entry}
                                        sourceLabel={sourceLabelOf(entry)}
                                        canAddToPlaylist={canAddToPlaylist(entry.song)}
                                        isFresh={freshKeys.has(entry.key)}
                                        actions={rowActions}
                                        labels={rowLabels}
                                    />
                                ))}
                            </ul>
                        )}

                        {entries.length > 0 && (
                            <footer className="scratchpad-footer">
                                <button type="button" className="scratchpad-pill" onClick={() => playback.enqueueAll(songs)}>
                                    <ListPlus aria-hidden="true" />
                                    <span>{t('scratchpad.enqueueAll')}</span>
                                </button>
                                <button type="button" className="scratchpad-pill" onClick={() => playback.replaceQueue(songs)}>
                                    <Play aria-hidden="true" />
                                    <span>{t('scratchpad.replaceQueue')}</span>
                                </button>
                                <button
                                    type="button"
                                    className={`scratchpad-pill${confirmingClear ? ' is-confirming' : ''}`}
                                    style={{ flex: confirmingClear ? '1.4 1 0' : '0 0 auto' }}
                                    title={t('scratchpad.clear')}
                                    onClick={handleClear}
                                >
                                    <Trash2 aria-hidden="true" />
                                    {confirmingClear && <span>{t('scratchpad.confirmClear')}</span>}
                                </button>
                            </footer>
                        )}
                    </motion.aside>
                )}
            </AnimatePresence>
        </div>
    );
};

export default ScratchpadHost;
