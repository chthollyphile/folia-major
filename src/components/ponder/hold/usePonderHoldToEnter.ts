import { useEffect, useRef, type RefObject } from 'react';
import { usePonderStore } from '../../../stores/usePonderStore';
import type { PonderTargetId } from '../../../types/ponder';
import { effectiveKeyCode, hasBlockingWindow, isTextEntryTarget } from '../../../utils/keyboardTargets';
import type { PonderHoldProgressRefs } from './ponderHoldProgress';
import { usePonderHold } from './usePonderHold';
import { useTextEntryFocus } from './useTextEntryFocus';

// src/components/ponder/hold/usePonderHoldToEnter.ts
// 组件级入口：悬停某个组件后长按 G。
//
// 计时、取消、吃键和进度反馈在 usePonderHold 里，和 Ctrl+G 那条页面级入口共用同一份 ——
// 两条路看起来必须完全一样。这里只说这条入口自己的事。
//
// 返回「此刻按住 G 会不会打开悬停着的那一课」，提示胶囊照它出现：胶囊不许诺一个按了没用的键。
//
// @note 长按 G 只属于非文本控件。输入框（包括命令面板搜索框）必须继续正常输入 g；
// 页面级入口由 Ctrl+G 承担，因此这里不需要再从文本输入中抢走可打印字符。

const BLOCKING_WINDOW_SELECTOR = '[data-folia-keyboard-window="true"]';

type PonderHoldRefs = PonderHoldProgressRefs & {
    hoveredElementRef: RefObject<Element | null>;
};

export const usePonderHoldToEnter = ({
    hoveredElementRef,
    wipeRef,
    labelRef,
    holdLabelRef,
    cellRef,
}: PonderHoldRefs): boolean => {
    const hoveredTargetId = usePonderStore(state => state.hoveredTargetId);
    const heldTargetRef = useRef<PonderTargetId | null>(null);
    const isTyping = useTextEntryFocus();

    useEffect(() => {
        if (hoveredTargetId) {
            // 提示一出现就把教程层那个 chunk 预热，400ms 按满时通常已经就绪。
            void import('../PonderStage');
        }
    }, [hoveredTargetId]);

    usePonderHold({
        enabled: Boolean(hoveredTargetId),
        resetKey: hoveredTargetId,
        accepts: event => {
            if (effectiveKeyCode(event) !== 'KeyG' || event.isComposing) {
                return false;
            }
            if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
                return false;
            }
            // 可教学性看「悬停到的元素」，是否在打字看「焦点元素」，两者分开判断。焦点在接收文字的
            // 东西上时（命令面板开着时它的搜索框一直如此）这个键是它的；下面返回的 !isTyping 让胶囊
            // 这时也不出现。
            if (isTextEntryTarget(event.target)) {
                return false;
            }
            const insideBlocking = Boolean(hoveredElementRef.current?.closest(BLOCKING_WINDOW_SELECTOR));
            return insideBlocking || !hasBlockingWindow();
        },
        releasedBy: event => effectiveKeyCode(event) === 'KeyG',
        onPress: () => {
            heldTargetRef.current = hoveredTargetId;
        },
        onFull: () => {
            const heldTargetId = heldTargetRef.current;
            // 按满的这一刻再确认一次：这 400ms 里指针可能已经移开了。
            if (heldTargetId && usePonderStore.getState().hoveredTargetId === heldTargetId) {
                usePonderStore.getState().openPonder(heldTargetId);
            }
        },
        refs: { wipeRef, labelRef, holdLabelRef, cellRef },
    });

    return Boolean(hoveredTargetId) && !isTyping;
};

export default usePonderHoldToEnter;
