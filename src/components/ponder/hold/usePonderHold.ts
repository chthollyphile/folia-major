import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PONDER_HOLD_DURATION_MS, startPonderHoldProgress, type PonderHoldProgressRefs } from './ponderHoldProgress';

// src/components/ponder/hold/usePonderHold.ts
// 「按住，等擦除走满，进入思索」。两条入口共用这一份：悬停某个组件后长按 G
// （usePonderHoldToEnter），和任意页面上长按 Ctrl+G（usePagePonderShortcut）。
//
// 两条入口各自只说三件事：哪一下 keydown 归它、哪个键松开算放弃、按满了开什么。
// 怎么计时、怎么取消、怎么吃掉按键、进度什么时候开始画，都在这里，两边一样。

/**
 * 一次长按的计时规则，不碰 DOM：按下起算，按满 durationMs 报一次，中途松开这一次作废。
 * 已经按着的时候再按（键盘的自动重复）不重新计时。
 */
export const createPonderHold = (durationMs: number, onFull: () => void) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return {
        /** 开始了返回 true；已经按着返回 false。 */
        press: (): boolean => {
            if (timer !== null) {
                return false;
            }
            timer = setTimeout(() => {
                timer = null;
                onFull();
            }, durationMs);
            return true;
        },
        /** 作废了返回 true；本来就没按着返回 false。 */
        release: (): boolean => {
            if (timer === null) {
                return false;
            }
            clearTimeout(timer);
            timer = null;
            return true;
        },
    };
};

type PonderHoldOptions = {
    /** false = 这条入口此刻不听键盘。 */
    enabled: boolean;
    /** 它一变，正在进行的那一次长按作废（悬停换了一个组件）。 */
    resetKey?: unknown;
    /** 这一下 keydown 归不归这条入口：哪个键、带不带修饰键、焦点在哪。 */
    accepts: (event: KeyboardEvent) => boolean;
    /** 哪个键松开算放弃。 */
    releasedBy: (event: KeyboardEvent) => boolean;
    /** 长按开始的那一下。 */
    onPress?: () => void;
    /** 按满了。 */
    onFull: () => void;
    /** 进度往这几个节点上写。 */
    refs: PonderHoldProgressRefs;
};

/** 听键盘、计时、画进度。返回此刻是不是正按着。 */
export const usePonderHold = ({ enabled, resetKey, accepts, releasedBy, onPress, onFull, refs }: PonderHoldOptions): boolean => {
    const [isHolding, setIsHolding] = useState(false);
    const { wipeRef, labelRef, holdLabelRef, cellRef } = refs;
    const animationsRef = useRef<Animation[]>([]);
    // 监听不跟着每次渲染重挂（重挂会把正在进行的长按取消）；入口此刻的说法每次渲染换进来。
    const entryRef = useRef({ accepts, releasedBy, onPress, onFull });
    useLayoutEffect(() => {
        entryRef.current = { accepts, releasedBy, onPress, onFull };
    });

    useEffect(() => {
        if (!enabled) {
            return;
        }

        const hold = createPonderHold(PONDER_HOLD_DURATION_MS, () => {
            // 按满：胶囊马上要退场，擦除留在走满的样子，不收回去。
            animationsRef.current = [];
            setIsHolding(false);
            entryRef.current.onFull();
        });

        const release = () => {
            if (!hold.release()) {
                return;
            }
            animationsRef.current.forEach(animation => animation.cancel());
            animationsRef.current = [];
            setIsHolding(false);
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (!entryRef.current.accepts(event)) {
                return;
            }
            // 这个键归我们了。自动重复的那几下也吃掉：按住的这 400ms 里它一旦开始，
            // 一串 g 就会落到底下的输入框或者别的快捷键上。
            event.preventDefault();
            event.stopPropagation();

            if (event.repeat || !hold.press()) {
                return;
            }
            entryRef.current.onPress?.();
            setIsHolding(true);
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (entryRef.current.releasedBy(event)) {
                release();
            }
        };

        const handleVisibilityChange = () => {
            if (document.hidden) release();
        };

        window.addEventListener('keydown', handleKeyDown, { capture: true });
        window.addEventListener('keyup', handleKeyUp, { capture: true });
        window.addEventListener('blur', release);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            window.removeEventListener('keydown', handleKeyDown, { capture: true });
            window.removeEventListener('keyup', handleKeyUp, { capture: true });
            window.removeEventListener('blur', release);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            release();
        };
    }, [enabled, resetKey]);

    // 进度在这里开始画而不是 keydown 里：页面级那颗胶囊是 isHolding 变 true 之后才渲染的，
    // 在 keydown 当场去拿那几个 ref 只会拿到 null。
    useLayoutEffect(() => {
        if (isHolding) {
            animationsRef.current = startPonderHoldProgress({ wipeRef, labelRef, holdLabelRef, cellRef });
        }
    }, [isHolding, wipeRef, labelRef, holdLabelRef, cellRef]);

    return isHolding;
};
