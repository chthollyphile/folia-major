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
import ScratchpadBand from './ScratchpadBand';
import ScratchpadCard, { type CanvasEntry, type CardMotion, type CardVariant } from './ScratchpadCard';
import ScratchpadShape from './ScratchpadShape';
import { historyScopes, useScratchpadHistory } from './useScratchpadHistory';
import { FILM_SPACING, NOTE_SPACING, PHOTO_SPACING, cardSize, polygonsIntersect, rectCorners, rectFromPoints, type Point, type Rect, type Spacing } from './canvasLayout';
import { SCRATCHPAD_TABS, SCRATCHPAD_TAB_SHAPES } from './scratchpadLook';
import { clientToLocal, localToClient } from './scratchpadTilt';
import type { ScratchpadPlayback, ScratchpadQueuePort } from './ScratchpadHost';

// src/components/app/scratchpad/ScratchpadOverview.tsx
// 三行总览（设计稿 F 的 Rows）：三条信息条横贯整张纸，每条下面一行这一页的头几张卡（速记簿的头几首、最近放的几首、
// 正在播的那首起的几格胶片），行尾一块「还有几首 · 展开整页 ›」。在空白处拖出屏幕方向的框选（可以跨行），Ctrl 点加选；
// 选中后在卡片下面浮出一块墨色的板：加入队列、加入歌单（同一来源时）、加入速记簿（选了历史或队列里的歌时）、移除
// （速记簿里的移出、历史里的删记录；队列里的歌要到播放队列那一页移出）。双击播放。不能在这里拖动重排（各页展开整页里拖）。
// 纸的倾斜由 ScratchpadSheet 给；坐标换算与展开整页的画布同一套（scratchpadTilt）。

/** 每一行在纸上的高度位置（窗口高度的比例，加上纸上下多出来的 130px）：照设计稿 1440 × 900 时的 246 / 482 / 722。 */
const ROW_TOPS = [0.129, 0.391, 0.658];
/** 一行至少占多高（信息条 72 + 下面 12 + 最高的卡 136，再留 16）：窗口矮时按它往下排，上一行的卡不压到下一条信息条上。 */
const ROW_MIN_STEP = 236;

/** 第 order 行的顶边：按比例的位置，和「上面每一行都至少占 ROW_MIN_STEP」两者取大（CSS 的 max，跟着窗口高度变）。 */
const rowTop = (order: number) => {
    const terms = ROW_TOPS.slice(0, order + 1).map((ratio, index) => `(100% - 260px) * ${ratio} + ${(order - index) * ROW_MIN_STEP}px`);
    return `calc(130px + max(${terms.join(', ')}))`;
};
/** 一行里卡片的左边、相对信息条顶边往下多少，右边留给跳到栏的宽度。 */
const CARDS_LEFT = 196;
const CARDS_BELOW_BAND = 84;
const RIGHT_ROOM = 184 + 170;

const ROW_SPACING: Record<ScratchpadTab, Spacing> = { notes: NOTE_SPACING, history: PHOTO_SPACING, queue: FILM_SPACING };
const ROW_VARIANT: Record<ScratchpadTab, CardVariant> = { notes: 'note', history: 'photo', queue: 'film' };
/** 每行最多几张。 */
const ROW_CAP: Record<ScratchpadTab, number> = { notes: 10, history: 6, queue: 10 };
const TITLE_KEYS: Record<ScratchpadTab, string> = { notes: 'scratchpad.title', history: 'scratchpad.history', queue: 'scratchpad.queue' };
const META_KEYS: Record<ScratchpadTab, string> = { notes: 'scratchpad.hint', history: 'scratchpad.historyHint', queue: 'scratchpad.queueHint' };

/** 一张卡：哪一行的，以及它在那一行的什么歌。 */
type OverviewEntry = CanvasEntry & { tab: ScratchpadTab; sourceKey: string };

const noopRegister = (_key: string, _motion: CardMotion | null) => undefined;

type ScratchpadOverviewProps = {
    playback: ScratchpadPlayback;
    queue: ScratchpadQueuePort;
    tilt: number;
    sheetWidth: number;
    onOpenPage: (tab: ScratchpadTab) => void;
    /** 没有选择时按 Esc：收回左缘的面板。 */
    onEscape: () => void;
};

const ScratchpadOverview: React.FC<ScratchpadOverviewProps> = ({ playback, queue, tilt, sheetWidth, onOpenPage, onEscape }) => {
    const { t, i18n } = useTranslation();
    const notes = useScratchpadStore(state => state.entries);
    const plays = useScratchpadHistory();
    const { playQueue, displaySong } = usePlaybackStore(useShallow(state => ({ playQueue: state.playQueue, displaySong: selectDisplaySong(state) })));
    const rootRef = useRef<HTMLDivElement>(null);
    const rowRefs = useRef(new Map<ScratchpadTab, HTMLDivElement>());
    const marqueeRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ pointerId: number; start: Point; base: ReadonlySet<string>; moved: boolean } | null>(null);
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

    // 挂上时焦点不在任何地方（点的「‹ 三行总览」跟着信息条一起卸掉了）：接过焦点，Esc 与快捷键才归总览。
    useEffect(() => {
        const active = document.activeElement;
        if (!active || active === document.body) rootRef.current?.focus({ preventScroll: true });
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
        const top = row.offsetTop + CARDS_BELOW_BAND;
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

    // —— 空白处框选（屏幕方向的框，可以跨行）——
    const applyBox = (clientX: number, clientY: number) => {
        const root = rootRef.current;
        const drag = dragRef.current;
        if (!root || !drag) return;
        const startClient = localToClient(root, drag.start, tilt);
        if (!drag.moved && Math.hypot(clientX - startClient.x, clientY - startClient.y) < 4) return;
        if (!drag.moved) setBoxing(true);
        drag.moved = true;
        const screen = rectFromPoints(startClient, { x: clientX, y: clientY });
        const corners = rectCorners(screen).map(corner => clientToLocal(root, corner, tilt));
        const box = marqueeRef.current;
        if (box) {
            box.hidden = false;
            box.style.transform = `translate(${corners[0].x}px, ${corners[0].y}px) rotate(${-tilt}deg)`;
            box.style.width = `${screen.right - screen.left}px`;
            box.style.height = `${screen.bottom - screen.top}px`;
        }
        const next = new Set(drag.base);
        for (const tab of SCRATCHPAD_TABS) {
            rows[tab].entries.forEach((entry, index) => {
                const rect = cardBox(tab, index);
                if (rect && polygonsIntersect(corners, rectCorners(rect))) next.add(entry.key);
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
        if (!drag.moved && drag.base.size === 0) setSelected(new Set());
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
            className={`scratchpad-overview${boxing ? ' is-box-selecting' : ''}`}
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
                        style={{ top: rowTop(order) }}
                    >
                        <ScratchpadBand
                            variant="row"
                            tab={tab}
                            index={String(order + 1).padStart(2, '0')}
                            title={t(TITLE_KEYS[tab])}
                            meta={t(META_KEYS[tab])}
                            count={row.total}
                            width={sheetWidth}
                            link={{ label: `${t('scratchpad.expandPage')} ›`, onClick: () => onOpenPage(tab) }}
                        />
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
