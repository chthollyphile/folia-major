import React, { memo, useEffect, useState } from 'react';
import { animate, motion, useMotionValue, type MotionValue } from 'framer-motion';
import { Check, Music2, Play } from 'lucide-react';
import type { SongResult } from '../../../types';
import { getSongArtistLabel } from '../../../services/onlineMusic/songMetadata';
import { useReducedMotionFor } from '../../../hooks/useReducedMotionFor';
import { scratchpadCoverUrl } from './scratchpadCover';
import { CARD_HEIGHT, CARD_WIDTH } from './canvasLayout';

/**
 * 展开整页（设计稿 F）里卡片的三种样子：速记簿是笔记本上的一条记录（封面在上，红页边线、斜体的来源），
 * 播放历史是一张回忆相片（泛黄、暗角、微微歪着，底下写几点放的），播放队列是一格电影胶片（上下齿孔，片边印序号）。
 * 缺省是原来的卡片。样子全在 scratchpad.css，这里只多画胶片片边那一行、给相片一个歪的角度。
 */
export type CardVariant = 'note' | 'photo' | 'film';

/** 相片歪的角度：按 key 固定挑一个（同一张相片每次都一样歪，挪动后也不变）。 */
const PHOTO_ROTATIONS = [-2.2, 1.4, -0.6, 2, -1.5, 0.8, -2.4, 1.7, -0.9, 1.1];
const photoRotation = (key: string) => {
    let hash = 0;
    for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) | 0;
    return PHOTO_ROTATIONS[Math.abs(hash) % PHOTO_ROTATIONS.length];
};

/** 歌的时长写成 m:ss（胶片片边）。 */
const durationLabel = (ms: number) => {
    if (!Number.isFinite(ms) || ms <= 0) return '';
    const seconds = Math.round(ms / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

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
    /** 在播放队列里是第几首（从 1 起）：队列的胶片在片边印这个号。 */
    position?: number;
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
    /** 卡片的宽高（缺省 CARD_WIDTH × CARD_HEIGHT）。 */
    width?: number;
    height?: number;
    variant?: CardVariant;
    /** 胶片里正在播的那一格片边印的字。 */
    currentLabel?: string;
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
    width = CARD_WIDTH,
    height = CARD_HEIGHT,
    variant,
    currentLabel = '',
    playLabel,
    register,
    onPointerDown,
    onPlay,
}) => {
    const x = useMotionValue(slotX);
    const y = useMotionValue(slotY);
    // 相片歪的角度也交给 framer：它把位移与旋转写进同一个 transform（先挪到格子、再绕自己的中心转）。用 CSS 的 rotate 属性的话，
    // 它绕卡片挪动之前的位置（网格原点）转，越靠右甩得越远——第六格歪 1.7° 就低出十几像素，悬停摆正时整张往上跳（用户看到的）。
    const photoTilt = variant === 'photo' ? photoRotation(entry.key) : 0;
    const rotate = useMotionValue(photoTilt);
    const calm = useReducedMotionFor('uiMicroMotion');
    // 悬停时摆正，离开时歪回去（降低动态效果时不动）。
    const straighten = (straight: boolean) => {
        if (variant !== 'photo' || calm) return;
        animate(rotate, straight ? 0 : photoTilt, { duration: 0.26, ease: [0.22, 1, 0.36, 1] });
    };
    const [coverFailed, setCoverFailed] = useState(false);
    const coverUrl = scratchpadCoverUrl(entry.song, width);

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
        variant ? `is-${variant}` : '',
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
            style={{
                x,
                y,
                width,
                height,
                ...(variant === 'photo' ? { rotate } : null),
            }}
            onPointerEnter={() => straighten(true)}
            onPointerLeave={() => straighten(false)}
            title={variant === 'film' ? `${entry.song.name} · ${getSongArtistLabel(entry.song)}` : undefined}
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
            {variant === 'film' ? (
                // 胶片的片边：左边印序号（正在播的那一格印「▶ 正在播放」），右边印时长。
                <span className="scratchpad-card-edge">
                    <span>{entry.isCurrent ? `▶ ${currentLabel}` : entry.position !== undefined ? `▸ ${entry.position}` : ''}</span>
                    <span>{durationLabel(entry.song.durationMs)}</span>
                </span>
            ) : (
                <span className="scratchpad-card-meta">{entry.meta ?? getSongArtistLabel(entry.song)}</span>
            )}
            {/* 选中时左上角那颗勾（只在展开整页里画，scratchpad.css）。 */}
            <span className="scratchpad-card-check" aria-hidden="true"><Check /></span>
        </motion.div>
    );
};

export default memo(ScratchpadCard);
