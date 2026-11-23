import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquareQuote } from 'lucide-react';
import type { SongResult } from '../../../types';
import { useRecentSongNotes } from '../../song-notes/useSongNotesStore';
import type { SongNoteTag } from '../../song-notes/songNotesModel';
import ScratchpadCard, { type CanvasEntry, type CardMotion } from './ScratchpadCard';
import { CATALOG_SPACING, cardSize, columnsFor, gridHeight, slotPosition } from './canvasLayout';
import { catalogCardFields } from './commentCards';
import type { ScratchpadPlayback } from './ScratchpadHost';

// src/components/app/scratchpad/ScratchpadCommentsSheet.tsx
// 「评论」页的展开整页，第一阶段：最近评论过的歌，一张一张图书馆目录卡（红顶线、横格、编号，设计稿 G 组 CommentsSheet），新的在前。
// 点一张卡收回面板、看那一首的评论；卡上的播放钮插进队列播放。按标签分组、组的动作、搜索在第二阶段（plan/music-notes-integration-plan.md）。

/** 第一阶段最多列这么多首。 */
const SHEET_LIMIT = 200;

const noopRegister: (key: string, motion: CardMotion | null) => void = () => undefined;
const noopDown = () => undefined;

type ScratchpadCommentsSheetProps = {
    playback: ScratchpadPlayback;
    tagNames: ReadonlyMap<string, SongNoteTag>;
    playingKey: string | null;
    onOpen: (song: SongResult) => void;
};

const ScratchpadCommentsSheet: React.FC<ScratchpadCommentsSheetProps> = ({ playback, tagNames, playingKey, onOpen }) => {
    const { t } = useTranslation();
    const { rows } = useRecentSongNotes(SHEET_LIMIT);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    const widthRef = useRef(0);
    // 先读出空的（库还没读完时也是空的）画的是空态，没有滚动层；有了歌、滚动层挂上之后才量得到宽。
    const hasRows = rows.length > 0;
    useLayoutEffect(() => {
        const element = scrollRef.current;
        if (!element || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(([entry]) => {
            const next = Math.round(entry.contentRect.width);
            if (next === widthRef.current) return;
            widthRef.current = next;
            setWidth(next);
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, [hasRows]);
    const { width: cardWidth, height: cardHeight } = cardSize(CATALOG_SPACING);
    const columns = columnsFor(Math.max(0, width - 20), CATALOG_SPACING);
    const entries = useMemo<CanvasEntry[]>(() => rows.map((row, index) => ({
        key: row.key,
        song: row.song,
        ...catalogCardFields(row, tagNames, t),
        catalogNumber: t('songNotes.catalogNumber', { number: String(index + 1).padStart(2, '0') }),
        isCurrent: row.key === playingKey,
    })), [playingKey, rows, t, tagNames]);
    const songs = useMemo(() => new Map(rows.map(row => [row.key, row.song])), [rows]);

    // 点卡片（不是卡上的播放钮）：收回面板，看这一首。
    const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement;
        if (target.closest('.scratchpad-card-play')) return;
        const key = target.closest<HTMLElement>('[data-scratchpad-key]')?.dataset.scratchpadKey;
        const song = key ? songs.get(key) : undefined;
        if (song) onOpen(song);
    };
    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Enter') return;
        // 卡上的播放钮自己处理 Enter（播放），不在这里收回面板。
        if ((event.target as HTMLElement).closest('.scratchpad-card-play')) return;
        const key = (event.target as HTMLElement).closest<HTMLElement>('[data-scratchpad-key]')?.dataset.scratchpadKey;
        const song = key ? songs.get(key) : undefined;
        if (song) onOpen(song);
    };

    if (rows.length === 0) {
        return (
            <div className="scratchpad-empty">
                <MessageSquareQuote aria-hidden="true" />
                <p>{t('songNotes.empty')}</p>
            </div>
        );
    }
    return (
        <div ref={scrollRef} className="scratchpad-comments-sheet" onClick={handleClick} onKeyDown={handleKeyDown}>
            <div
                className="scratchpad-comments-sheet-grid"
                role="listbox"
                aria-label={t('songNotes.recent')}
                style={{ height: gridHeight(entries.length, columns, CATALOG_SPACING) }}
            >
                {width > 0 && entries.map((entry, index) => {
                    const slot = slotPosition(index, columns, CATALOG_SPACING);
                    return (
                        <ScratchpadCard
                            key={entry.key}
                            entry={entry}
                            slotX={slot.x}
                            slotY={slot.y}
                            isMoving={false}
                            isSelected={false}
                            isFresh={false}
                            width={cardWidth}
                            height={cardHeight}
                            variant="catalog"
                            currentLabel={t('scratchpad.nowPlaying')}
                            playLabel={t('scratchpad.play')}
                            register={noopRegister}
                            onPointerDown={noopDown}
                            onPlay={item => playback.playNow(item.song)}
                        />
                    );
                })}
            </div>
        </div>
    );
};

export default ScratchpadCommentsSheet;
