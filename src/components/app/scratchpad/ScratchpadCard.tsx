import React, { memo, useEffect, useState } from 'react';
import { animate, motion, useMotionValue, type MotionValue } from 'framer-motion';
import { Music2, Play } from 'lucide-react';
import type { SongResult } from '../../../types';
import { getSongArtistLabel, getSongCoverUrl } from '../../../services/onlineMusic/songMetadata';
import { CARD_HEIGHT, CARD_WIDTH } from './canvasLayout';

// src/components/app/scratchpad/ScratchpadCard.tsx
// 画布上的一张卡片。位置是两个 MotionValue（相对组网格原点）：平时弹簧动画到自己的格子；被拖的时候由画布在指针事件里
// 直接 set（不进 React state），松手后再弹回新格子——这就是「自由拖动、吸附到索引位置」。卡片把自己的 MotionValue
// 登记给画布（register），画布拖动时按 key 找到它们。
// 速记簿、播放历史、播放队列三页的画布都用它：卡片只要 key 与歌，第二行的小字（meta）与「正在播放」记号可选。

/** 画布上的一张卡要的东西（速记簿的条目、播放历史的一次播放、播放队列的一行都合这个样子）。 */
export type CanvasEntry = {
    /** 在这块画布里唯一，挪动之后不变。 */
    key: string;
    song: SongResult;
    /** 第二行的小字；缺省写歌手。 */
    meta?: string;
    /** 正在播放的那一首：画个记号。 */
    isCurrent?: boolean;
    /** 灰掉：封面去色、字变淡（播放队列画布里排在当前这首之前、已经放过的歌）。悬停、选中时复原。 */
    isDimmed?: boolean;
};

export type CardMotion = { x: MotionValue<number>; y: MotionValue<number> };

type ScratchpadCardProps = {
    entry: CanvasEntry;
    /** 该在的格子的左上角（拖动预览中是让位之后的格子）；拆成两个数，memo 才比得出没变。 */
    slotX: number;
    slotY: number;
    /** 正跟着指针走：不往格子上动画。 */
    isMoving: boolean;
    isSelected: boolean;
    isFresh: boolean;
    /** 拖着一摞卡时按下的那张：角标写一共挪几张（0 不写）。 */
    movingCount?: number;
    playLabel: string;
    register: (key: string, motion: CardMotion | null) => void;
    onPointerDown: (entry: CanvasEntry, event: React.PointerEvent<HTMLDivElement>) => void;
    onPlay: (entry: CanvasEntry) => void;
};

const SNAP = { type: 'spring', stiffness: 520, damping: 42, mass: 0.7 } as const;

const ScratchpadCard: React.FC<ScratchpadCardProps> = ({
    entry,
    slotX,
    slotY,
    isMoving,
    isSelected,
    isFresh,
    movingCount = 0,
    playLabel,
    register,
    onPointerDown,
    onPlay,
}) => {
    const x = useMotionValue(slotX);
    const y = useMotionValue(slotY);
    const [coverFailed, setCoverFailed] = useState(false);
    const coverUrl = getSongCoverUrl(entry.song);

    useEffect(() => {
        register(entry.key, { x, y });
        return () => register(entry.key, null);
    }, [entry.key, register, x, y]);

    // 不在被拖的时候，格子变了就弹过去（别的卡让位、松手吸附、窗口变宽换列数）。
    useEffect(() => {
        if (isMoving) return;
        const toX = animate(x, slotX, SNAP);
        const toY = animate(y, slotY, SNAP);
        return () => {
            toX.stop();
            toY.stop();
        };
    }, [isMoving, slotX, slotY, x, y]);

    const className = [
        'scratchpad-card',
        isSelected ? 'is-selected' : '',
        isMoving ? 'is-moving' : '',
        isFresh ? 'is-fresh' : '',
        entry.isCurrent ? 'is-current' : '',
        entry.isDimmed ? 'is-dimmed' : '',
    ].filter(Boolean).join(' ');

    return (
        <motion.div
            className={className}
            data-scratchpad-key={entry.key}
            aria-selected={isSelected}
            role="option"
            style={{ x, y, width: CARD_WIDTH, height: CARD_HEIGHT }}
            onPointerDown={event => onPointerDown(entry, event)}
            onDoubleClick={() => onPlay(entry)}
        >
            <span className="scratchpad-card-cover">
                {coverUrl && !coverFailed
                    ? <img src={coverUrl} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setCoverFailed(true)} />
                    : <span className="scratchpad-card-placeholder"><Music2 aria-hidden="true" /></span>}
                <button
                    type="button"
                    className="scratchpad-card-play"
                    title={playLabel}
                    aria-label={playLabel}
                    // 按下不交给卡片：这颗按钮不开始拖动，也不改选择。
                    onPointerDown={event => event.stopPropagation()}
                    onClick={() => onPlay(entry)}
                >
                    <Play aria-hidden="true" fill="currentColor" />
                </button>
            </span>
            {movingCount > 1 && <span className="scratchpad-card-count" aria-hidden="true">{movingCount}</span>}
            <span className="scratchpad-card-name">{entry.song.name}</span>
            <span className="scratchpad-card-meta">{entry.meta ?? getSongArtistLabel(entry.song)}</span>
        </motion.div>
    );
};

export default memo(ScratchpadCard);
