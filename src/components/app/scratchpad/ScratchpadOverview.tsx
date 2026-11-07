import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { ListPlus, NotebookPen, Star, Trash2, X } from 'lucide-react';
import type { SongResult } from '../../../types';
import { collectToScratchpad, groupScratchpadEntries, scratchpadGroupKey, useScratchpadStore, type ScratchpadTab } from '../../../stores/useScratchpadStore';
import { selectDisplaySong, usePlaybackStore } from '../../../stores/usePlaybackStore';
import { canOpenPlaylistPickerFor, openAddSongsToPlaylist } from '../../../stores/useAddToPlaylistStore';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import { getSongArtistLabel } from '../../../services/onlineMusic/songMetadata';
import { forgetPlays } from '../home/explore/recentPlays';
import ScratchpadCard, { type CanvasEntry, type CardMotion, type CardVariant } from './ScratchpadCard';
import ScratchpadShape from './ScratchpadShape';
import { historyScopes, useScratchpadHistory } from './useScratchpadHistory';
import { FILM_ROW_SPACING, NOTE_ROW_SPACING, PHOTO_ROW_SPACING, cardSize, overviewBottomInset, overviewRowTops, rectFromPoints, rectsIntersect, type Point, type Rect, type Spacing } from './canvasLayout';
import { SCRATCHPAD_TABS, SCRATCHPAD_TAB_SHAPES } from './scratchpadLook';
import { clientToLocal } from './scratchpadTilt';
import type { ScratchpadPlayback, ScratchpadQueuePort } from './ScratchpadHost';

// src/components/app/scratchpad/ScratchpadOverview.tsx
// 三行总览（设计稿 F 的 Rows）里的三行卡：三条信息条（ScratchpadSheet 画，进出总览时挪动、长高）每条下面一行这一页的头几张卡（速记簿的头几首、最近放的几首、
// 正在播的那首起的几格胶片），行尾一块「还有几首 · 展开整页 ›」。在空白处拖出框选（跟着纸斜的矩形，可以跨行），Ctrl 点加选；
// 选中后在卡片下面浮出一块墨色的板：加入队列、加入歌单（同一来源时）、加入速记簿（选了历史或队列里的歌时）、移除
// （速记簿里的移出、历史里的删记录；队列里的歌要到播放队列那一页移出）。双击播放。不能在这里拖动重排（各页展开整页里拖）。
// 纸的倾斜由 ScratchpadSheet 给；坐标换算与展开整页的画布同一套（scratchpadTilt）。

/** 纸比窗口上边多出来的那一截：行的顶边（窗口坐标，overviewRowTops）加上它才是纸上的位置。 */
const SHEET_BLEED_Y = 130;
/** 一行里卡片的左边、相对信息条顶边往下多少，右边留给跳到栏的宽度。 */
const CARDS_LEFT = 196;
const CARDS_BELOW_BAND = 84;
const RIGHT_ROOM = 184 + 170;

const ROW_SPACING: Record<ScratchpadTab, Spacing> = { notes: NOTE_ROW_SPACING, history: PHOTO_ROW_SPACING, queue: FILM_ROW_SPACING };
const ROW_VARIANT: Record<ScratchpadTab, CardVariant> = { notes: 'note', history: 'photo', queue: 'film' };
/** 每行最多几张。 */
const ROW_CAP: Record<ScratchpadTab, number> = { notes: 10, history: 6, queue: 10 };

/** 一张卡：哪一行的，以及它在那一行的什么歌。 */
type OverviewEntry = CanvasEntry & { tab: ScratchpadTab; sourceKey: string };

const noopRegister = (_key: string, _motion: CardMotion | null) => undefined;

type ScratchpadOverviewProps = {
    playback: ScratchpadPlayback;
    queue: ScratchpadQueuePort;
    tilt: number;
    sheetWidth: number;
    /** 窗口的高度：三行按它排。 */
    viewHeight: number;
    onOpenPage: (tab: ScratchpadTab) => void;
    /** 没有选择时按 Esc：收回左缘的面板。 */
    onEscape: () => void;
};

const ScratchpadOverview: React.FC<ScratchpadOverviewProps> = ({ playback, queue, tilt, sheetWidth, viewHeight, onOpenPage, onEscape }) => {
    const { t, i18n } = useTranslation();
    const notes = useScratchpadStore(state => state.entries);
    const plays = useScratchpadHistory();
    const { playQueue, displaySong } = usePlaybackStore(useShallow(state => ({ playQueue: state.playQueue, displaySong: selectDisplaySong(state) })));
    const rootRef = useRef<HTMLDivElement>(null);
    const rowRefs = useRef(new Map<ScratchpadTab, HTMLDivElement>());
    const marqueeRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ pointerId: number; start: Point; base: ReadonlySet<string>; moved: boolean; collapses: boolean } | null>(null);
    const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
    const [boxing, setBoxing] = useState(false);

    // 每行的卡：放得下几张就几张（不超过 ROW_CAP），剩下的写在行尾。
    const rows = useMemo(() => {
        const fit = (tab: ScratchpadTab) => {
            const { width } = cardSize(ROW_SPACING[tab]);
            const step = width + ROW_SPACING[tab].x;
            return Math.max(1, Math.min(ROW_CAP[tab], Math.floor((sheetWidth - CARDS_LEFT - RIGHT_ROOM) / step)));
        };
        const flatNotes = groupScratchpadEntries(notes).flatMap(group => group.entries);
        const displayKey = displaySong ? getPlaybackSongKey(displaySong) : null;
        const currentIndex = displayKey === null ? -1 : playQueue.findIndex(song => getPlaybackSongKey(song) === displayKey);
        const queueFrom = Math.max(0, currentIndex);
        const time = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
        const make = (tab: ScratchpadTab, sourceKey: string, song: SongResult, extra: Partial<CanvasEntry> = {}): OverviewEntry => ({
            key: `${tab}|${sourceKey}`, tab, sourceKey, song, ...extra,
        });
        const notesRow = flatNotes.slice(0, fit('notes')).map(entry => make('notes', entry.key, entry.song, {
            meta: [getSongArtistLabel(entry.song), entry.origin?.label].filter(Boolean).join(' · '),
        }));
        const historyRow = plays.slice(0, fit('history')).map(play => make('history', getPlaybackSongKey(play.song), play.song, { meta: time.format(play.at) }));
        const queueRow = playQueue.slice(queueFrom, queueFrom + fit('queue')).map((song, offset) => make('queue', `${getPlaybackSongKey(song)}#${queueFrom + offset}`, song, {
            position: queueFrom + offset + 1,
            isCurrent: queueFrom + offset === currentIndex,
        }));
        return {
            notes: { entries: notesRow, more: flatNotes.length - notesRow.length, total: flatNotes.length },
            history: { entries: historyRow, more: plays.length - historyRow.length, total: plays.length },
            queue: { entries: queueRow, more: playQueue.length - queueFrom - queueRow.length, total: playQueue.length },
        };
    }, [displaySong, i18n.language, notes, playQueue, plays, sheetWidth]);
    const all = useMemo(() => SCRATCHPAD_TABS.flatMap(tab => rows[tab].entries), [rows]);
    // 与信息条（ScratchpadSheet）同一套排法：纸斜着时行的右端低一截，底下让出来。
    const tops = useMemo(() => overviewRowTops(viewHeight, overviewBottomInset(sheetWidth, tilt)), [sheetWidth, tilt, viewHeight]);

    // 挂上时焦点不在任何地方（点的「‹ 三行总览」跟着信息条一起卸掉了）：接过焦点，Esc 与快捷键才归总览。
    useEffect(() => {
        const active = document.activeElement;
        if (!active || active === document.body || active.closest('.scratchpad-drawer.is-panel')) rootRef.current?.focus({ preventScroll: true });
    }, []);

    // 行里的卡换了（收进新歌、切了歌）时，选择里也去掉不在了的。
    useEffect(() => {
        const keys = new Set(all.map(entry => entry.key));
        setSelected(current => {
            const next = new Set([...current].filter(key => keys.has(key)));
            return next.size === current.size ? current : next;
        });
    }, [all]);

    /** 一行里第 index 张卡在总览坐标里的矩形（行的顶边量 offsetTop）。 */
    const cardBox = useCallback((tab: ScratchpadTab, index: number): Rect | null => {
        const row = rowRefs.current.get(tab);
        if (!row) return null;
        const spacing = ROW_SPACING[tab];
        const { width, height } = cardSize(spacing);
        const left = CARDS_LEFT + index * (width + spacing.x);
        const top = row.offsetTop;
        return { left, top, right: left + width, bottom: top + height };
    }, []);

    const selectedEntries = useMemo(() => all.filter(entry => selected.has(entry.key)), [all, selected]);

    // —— 选择 ——
    const handleCardDown = useCallback((entry: CanvasEntry, event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        rootRef.current?.focus({ preventScroll: true });
        const toggle = event.ctrlKey || event.metaKey || event.shiftKey;
        setSelected(current => {
            if (!toggle) return new Set([entry.key]);
            const next = new Set(current);
            if (next.has(entry.key)) next.delete(entry.key);
            else next.add(entry.key);
            return next;
        });
    }, []);

    const play = useCallback((entry: CanvasEntry) => {
        const item = entry as OverviewEntry;
        if (item.tab === 'queue') queue.playSong(item.song);
        else playback.playNow(item.song);
    }, [playback, queue]);

    // —— 空白处框选（总览坐标里的矩形，跟着纸斜，可以跨行）——
    const applyBox = (clientX: number, clientY: number) => {
        const root = rootRef.current;
        const drag = dragRef.current;
        if (!root || !drag) return;
        const point = clientToLocal(root, { x: clientX, y: clientY }, tilt);
        if (!drag.moved && Math.hypot(point.x - drag.start.x, point.y - drag.start.y) < 4) return;
        if (!drag.moved) setBoxing(true);
        drag.moved = true;
        const area = rectFromPoints(drag.start, point);
        const box = marqueeRef.current;
        if (box) {
            box.hidden = false;
            box.style.transform = `translate(${area.left}px, ${area.top}px)`;
            box.style.width = `${area.right - area.left}px`;
            box.style.height = `${area.bottom - area.top}px`;
        }
        const next = new Set(drag.base);
        for (const tab of SCRATCHPAD_TABS) {
            rows[tab].entries.forEach((entry, index) => {
                const rect = cardBox(tab, index);
                if (rect && rectsIntersect(area, rect)) next.add(entry.key);
            });
        }
        setSelected(current => (current.size === next.size && [...next].every(key => current.has(key)) ? current : next));
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || event.pointerType === 'touch' || !rootRef.current) return;
        if ((event.target as HTMLElement).closest('button, .scratchpad-card, .scratchpad-band, .scratchpad-selection-menu')) return;
        rootRef.current.focus({ preventScroll: true });
        const additive = event.shiftKey || event.ctrlKey || event.metaKey;
        dragRef.current = {
            pointerId: event.pointerId,
            start: clientToLocal(rootRef.current, { x: event.clientX, y: event.clientY }, tilt),
            base: additive ? selected : new Set(),
            moved: false,
            // 空着的地方点一下、又没有选中什么：收回左缘的面板（同 Esc，用户要的「点空白处退出」）。
            collapses: !additive && selected.size === 0,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (dragRef.current?.pointerId !== event.pointerId) return;
        applyBox(event.clientX, event.clientY);
    };

    const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        dragRef.current = null;
        setBoxing(false);
        if (marqueeRef.current) marqueeRef.current.hidden = true;
        if (drag.moved) return;
        if (drag.collapses) onEscape();
        else if (drag.base.size === 0) setSelected(new Set());
    };

    // —— 选中后的动作 ——
    const songs = selectedEntries.map(entry => entry.song);
    const sameSource = new Set(songs.map(scratchpadGroupKey)).size === 1;
    const fromQueue = selectedEntries.some(entry => entry.tab === 'queue');
    const collectable = selectedEntries.filter(entry => entry.tab !== 'notes');
    const remove = () => {
        if (fromQueue) return;
        const noteKeys = selectedEntries.filter(entry => entry.tab === 'notes').map(entry => entry.sourceKey);
        const historyKeys = selectedEntries.filter(entry => entry.tab === 'history').map(entry => entry.sourceKey);
        if (noteKeys.length > 0) useScratchpadStore.getState().remove(noteKeys);
        if (historyKeys.length > 0 && forgetPlays(historyScopes(), historyKeys) > 0) {
            setStatusMessage({ type: 'success', text: t('scratchpad.historyDeleted', { count: historyKeys.length }), nonce: Date.now(), durationMs: 1600 });
        }
        setSelected(new Set());
    };
    const collect = () => {
        const history = collectable.filter(entry => entry.tab === 'history').map(entry => entry.song);
        const queued = collectable.filter(entry => entry.tab === 'queue').map(entry => entry.song);
        if (history.length > 0) collectToScratchpad(history, { label: t('scratchpad.originHistory') });
        if (queued.length > 0) collectToScratchpad(queued, { label: t('scratchpad.originQueue') });
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (selected.size > 0) setSelected(new Set());
            else onEscape();
            return;
        }
        if ((event.key === 'Delete' || event.key === 'Backspace') && selected.size > 0) {
            event.preventDefault();
            event.stopPropagation();
            remove();
            return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
            event.preventDefault();
            event.stopPropagation();
            setSelected(new Set(all.map(entry => entry.key)));
        }
    };

    // 浮动的板：放在选中卡片的外框下面（最下面那一行时放到上面），跟着纸一起斜。
    let menuStyle: React.CSSProperties | null = null;
    if (selectedEntries.length > 0 && !boxing) {
        const boxes = selectedEntries.flatMap(entry => {
            const index = rows[entry.tab].entries.indexOf(entry);
            const rect = cardBox(entry.tab, index);
            return rect ? [rect] : [];
        });
        if (boxes.length > 0) {
            const left = Math.min(...boxes.map(box => box.left));
            const top = Math.min(...boxes.map(box => box.top));
            const bottom = Math.max(...boxes.map(box => box.bottom));
            const below = selectedEntries.every(entry => entry.tab !== 'queue');
            menuStyle = below ? { left, top: bottom + 14 } : { left, top: top - 14, transform: 'translateY(-100%)' };
        }
    }

    const moreLabel = (tab: ScratchpadTab, more: number) => (
        tab === 'queue' ? t('scratchpad.overviewQueueMore', { count: Math.max(0, more) }) : t('scratchpad.overviewMore', { count: Math.max(0, more) })
    );

    return (
        <div
            ref={rootRef}
            className={`scratchpad-overview${boxing ? ' is-box-selecting' : ''}${selected.size > 0 ? ' has-selection' : ''}`}
            data-testid="scratchpad-overview"
            role="listbox"
            aria-multiselectable="true"
            aria-label={t('scratchpad.overview')}
            tabIndex={-1}
            onKeyDown={handleKeyDown}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
        >
            {SCRATCHPAD_TABS.map((tab, order) => {
                const row = rows[tab];
                const spacing = ROW_SPACING[tab];
                const { width, height } = cardSize(spacing);
                const step = width + spacing.x;
                return (
                    <div
                        key={tab}
                        ref={element => {
                            if (element) rowRefs.current.set(tab, element);
                            else rowRefs.current.delete(tab);
                        }}
                        className="scratchpad-overview-row"
                        data-page={tab}
                        // 一行卡放在这一行信息条下面 84px（信息条本身由 ScratchpadSheet 画，挪动、长高都在那边）。
                        style={{ top: SHEET_BLEED_Y + tops[order] + CARDS_BELOW_BAND, height }}
                    >
                        <div className="scratchpad-overview-cards" style={{ height }}>
                            {row.entries.map((entry, index) => (
                                <ScratchpadCard
                                    key={entry.key}
                                    entry={entry}
                                    slotX={index * step}
                                    slotY={0}
                                    isMoving={false}
                                    isSelected={selected.has(entry.key)}
                                    isFresh={false}
                                    width={width}
                                    height={height}
                                    variant={ROW_VARIANT[tab]}
                                    currentLabel={t('scratchpad.nowPlaying')}
                                    playLabel={t(tab === 'queue' ? 'scratchpad.playFromQueue' : 'scratchpad.play')}
                                    register={noopRegister}
                                    onPointerDown={handleCardDown}
                                    onPlay={play}
                                />
                            ))}
                            <button
                                type="button"
                                className="scratchpad-overview-more"
                                style={{ left: row.entries.length * step + 10, height }}
                                onClick={() => onOpenPage(tab)}
                            >
                                <ScratchpadShape kind={SCRATCHPAD_TAB_SHAPES[tab]} size={18} fill="var(--scratchpad-mark-wall)" />
                                <span className="scratchpad-overview-more-count">{moreLabel(tab, row.more)}</span>
                                <span className="scratchpad-slim-open">{t('scratchpad.expandPage')} ›</span>
                            </button>
                        </div>
                    </div>
                );
            })}
            <div ref={marqueeRef} className="scratchpad-marquee" hidden />
            {menuStyle && (
                <div
                    className="scratchpad-selection-menu"
                    style={menuStyle}
                    role="toolbar"
                    aria-label={t('scratchpad.selectedCount', { count: selectedEntries.length })}
                    data-testid="scratchpad-selection-menu"
                    onPointerDown={event => event.stopPropagation()}
                >
                    <span className="scratchpad-selection-count">{t('scratchpad.selectedCount', { count: selectedEntries.length })}</span>
                    <button type="button" className="scratchpad-menu-button" onClick={() => playback.enqueueAll(songs)}>
                        <ListPlus aria-hidden="true" /><span>{t('scratchpad.enqueue')}</span>
                    </button>
                    <button
                        type="button"
                        className="scratchpad-menu-button"
                        title={sameSource ? undefined : t('scratchpad.mixedSourcesHint')}
                        disabled={!sameSource || !songs.every(canOpenPlaylistPickerFor)}
                        onClick={() => openAddSongsToPlaylist(songs)}
                    >
                        <Star aria-hidden="true" /><span>{t('scratchpad.addToPlaylist')}</span>
                    </button>
                    {collectable.length > 0 && (
                        <button type="button" className="scratchpad-menu-button" onClick={collect}>
                            <NotebookPen aria-hidden="true" /><span>{t('scratchpad.collect')}</span>
                        </button>
                    )}
                    <button
                        type="button"
                        className="scratchpad-menu-button"
                        title={fromQueue ? t('scratchpad.overviewRemoveQueueHint') : undefined}
                        disabled={fromQueue}
                        onClick={remove}
                    >
                        <Trash2 aria-hidden="true" /><span>{t('scratchpad.overviewRemove')}</span>
                    </button>
                    <button type="button" className="scratchpad-icon-button" title={t('scratchpad.clearSelection')} aria-label={t('scratchpad.clearSelection')} onClick={() => setSelected(new Set())}>
                        <X aria-hidden="true" />
                    </button>
                </div>
            )}
        </div>
    );
};

export default ScratchpadOverview;
