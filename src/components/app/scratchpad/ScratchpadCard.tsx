import React, { memo, useEffect, useState } from 'react';
import { animate, motion, useMotionValue, type MotionValue } from 'framer-motion';
import { Music2, Play } from 'lucide-react';
import type { ScratchpadEntry } from '../../../stores/useScratchpadStore';
import { getSongArtistLabel, getSongCoverUrl } from '../../../services/onlineMusic/songMetadata';
import { CARD_HEIGHT, CARD_WIDTH } from './canvasLayout';

// src/components/app/scratchpad/ScratchpadCard.tsx
// 画布上的一张卡片。位置是两个 MotionValue（相对组网格原点）：平时弹簧动画到自己的格子；被拖的时候由画布在指针事件里
// 直接 set（不进 React state），松手后再弹回新格子——这就是「自由拖动、吸附到索引位置」。卡片把自己的 MotionValue
// 登记给画布（register），画布拖动时按 key 找到它们。

export type CardMotion = { x: MotionValue<number>; y: MotionValue<number> };

type ScratchpadCardProps = {
    entry: ScratchpadEntry;
    /** 该在的格子的左上角（拖动预览中是让位之后的格子）；拆成两个数，memo 才比得出没变。 */
    slotX: number;
    slotY: number;
    /** 正跟着指针走：不往格子上动画。 */
    isMoving: boolean;
    isSelected: boolean;
    isFresh: boolean;
    playLabel: string;
    register: (key: string, motion: CardMotion | null) => void;
    onPointerDown: (entry: ScratchpadEntry, event: React.PointerEvent<HTMLDivElement>) => void;
    onPlay: (entry: ScratchpadEntry) => void;
};

const SNAP = { type: 'spring', stiffness: 520, damping: 42, mass: 0.7 } as const;

const ScratchpadCard: React.FC<ScratchpadCardProps> = ({
    entry,
    slotX,
    slotY,
    isMoving,
    isSelected,
    isFresh,
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
            <span className="scratchpad-card-name">{entry.song.name}</span>
            <span className="scratchpad-card-meta">{getSongArtistLabel(entry.song)}</span>
        </motion.div>
    );
};

export default memo(ScratchpadCard);
