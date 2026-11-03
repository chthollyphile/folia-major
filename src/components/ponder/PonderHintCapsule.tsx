import React, { useLayoutEffect, useRef } from 'react';
import { motion, useIsPresent, useTransform } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useReducedMotionFor } from '../../hooks/useReducedMotionFor';
import { ponderPointerX, ponderPointerY } from '../../stores/motionSignals';
import type { Theme } from '../../types';
import { ponderTransition } from './ponderMotion';
import { ponderLayerTokens, ponderWindowTokens } from './ponderTheme';
import { PONDER_QUIET_CAP, PonderKeyCombo } from './PonderKeyCap';

// src/components/ponder/PonderHintCapsule.tsx
// 思索的提示胶囊：一行，画着键帽、「思索」和目标的名字。不可点击，不参与布局。
//
// 位置全程走 MotionValue → useTransform，一次 React 重渲染都不产生：光标坐标是每帧值，
// 写进 state 就等于让整棵树按指针频率重渲染（见 skills/frontend-runtime-guardrails）。
// 按住时的进度由 ponderHoldProgress 的 startPonderHoldProgress 用 WAAPI 直接驱动下面这四个
// ref（底色从左擦到右，两段文案交替，文案那一格变宽），同样不经过 React；悬停长按 G 和整页的
// Ctrl+G 两条路用的都是它。
//
// 「思索」换成「进入思索」时那一格要跟着变宽，名字才不会被压住，也不用平时就留着空位；
// 提前松手，宽度和文案一起收回。

/** 胶囊相对光标的偏移，px。 */
const CURSOR_OFFSET_PX = 12;

/** 贴边时留的余量，px。 */
const VIEWPORT_MARGIN_PX = 8;

type PonderHintCapsuleProps = {
    label: string;
    /**
     * 长按之后会打开的是哪个目标。
     *
     * 只写「思索」的话，用户在屏幕上同时压着好几个目标时（封面在面板里、标签页在
     * 标签排里）没法知道松手会讲哪一个 —— 而这正是按组件划分目标之后最容易踩空的地方。
     */
    targetName?: string;
    /**
     * 'cursor' 跟着指针走，给悬停某个组件那条路，键帽是 G；
     * 'page' 钉在屏幕底部中间，键帽是 Ctrl G —— 它是纯键盘触发，指针可能从没动过，
     * 跟随会把胶囊丢在视口左上角。
     */
    placement?: 'cursor' | 'page';
    theme?: Theme;
    isDaylight: boolean;
    wipeRef: React.RefObject<HTMLDivElement | null>;
    labelRef: React.RefObject<HTMLSpanElement | null>;
    holdLabelRef: React.RefObject<HTMLSpanElement | null>;
    /** 两段文案共用的那一格。 */
    cellRef: React.RefObject<HTMLSpanElement | null>;
};

const PonderHintCapsule: React.FC<PonderHintCapsuleProps> = ({
    label,
    targetName,
    placement = 'cursor',
    theme,
    isDaylight,
    wipeRef,
    labelRef,
    holdLabelRef,
    cellRef,
}) => {
    const { t } = useTranslation();
    const calm = useReducedMotionFor('uiMicroMotion');
    const rootRef = useRef<HTMLDivElement | null>(null);
    // 自身尺寸量一次存 ref。贴边钳位每帧都要用它，但它只在挂载和语言切换时变 ——
    // 每帧去量会是一次强制重排。量的是布局尺寸，不受入场那一下缩放影响。
    const sizeRef = useRef({ width: 160, height: 32 });
    // 胶囊自己的四个节点。长按进度写的是上面传下来的那组共用 ref，由在场的胶囊把自己的节点交上去。
    const ownWipeRef = useRef<HTMLDivElement | null>(null);
    const ownLabelRef = useRef<HTMLSpanElement | null>(null);
    const ownHoldLabelRef = useRef<HTMLSpanElement | null>(null);
    const ownCellRef = useRef<HTMLSpanElement | null>(null);
    const isPresent = useIsPresent();

    // 换胶囊时会有两个同时在页面里：一个在退场，一个在场（新挂上的，或者退到一半又被叫回来的）。
    // 两个拿的是同一组共用 ref，所以不能把它直接挂在节点上 —— 后卸载的那个会把它清成 null，
    // 下一次长按就没有进度可看。在场的那个交上去；让位时只在共用的还指着自己时才清掉。
    useLayoutEffect(() => {
        if (!isPresent) {
            return undefined;
        }
        const wipe = ownWipeRef.current;
        wipeRef.current = wipe;
        labelRef.current = ownLabelRef.current;
        holdLabelRef.current = ownHoldLabelRef.current;
        cellRef.current = ownCellRef.current;
        return () => {
            if (wipeRef.current !== wipe) {
                return;
            }
            wipeRef.current = null;
            labelRef.current = null;
            holdLabelRef.current = null;
            cellRef.current = null;
        };
    }, [isPresent, wipeRef, labelRef, holdLabelRef, cellRef]);

    useLayoutEffect(() => {
        const node = rootRef.current;
        const cell = ownCellRef.current;
        const rest = ownLabelRef.current?.offsetWidth ?? 0;
        const hold = ownHoldLabelRef.current?.offsetWidth ?? 0;
        // 那一格平时是静止文案那么宽。
        if (cell && rest > 0) {
            cell.style.width = `${rest}px`;
        }
        if (node && node.offsetWidth > 0) {
            // 按住时会变宽的那一点也算进去，贴着右边缘时才不会长出视口。
            sizeRef.current = { width: node.offsetWidth + Math.max(0, hold - rest), height: node.offsetHeight };
        }
    }, [label, targetName]);

    const x = useTransform(ponderPointerX, value => {
        const max = window.innerWidth - sizeRef.current.width - VIEWPORT_MARGIN_PX;
        return Math.max(VIEWPORT_MARGIN_PX, Math.min(max, value + CURSOR_OFFSET_PX));
    });
    const y = useTransform(ponderPointerY, value => {
        const max = window.innerHeight - sizeRef.current.height - VIEWPORT_MARGIN_PX;
        return Math.max(VIEWPORT_MARGIN_PX, Math.min(max, value + CURSOR_OFFSET_PX));
    });

    const isPinned = placement === 'page';
    const transition = ponderTransition('base', calm);
    const small = calm ? 1 : 0.94;

    return (
        <motion.div
            ref={rootRef}
            style={{ ...(isPinned ? {} : { x, y }), ...ponderLayerTokens(isDaylight, theme) }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition}
            // z-[205]：要压过思索的教程索引（195）和帮助对话框（200），否则在这些页面内
            // 悬停目标时，已经命中的提示会被页面本身遮住。它仍低于教程层（220）。
            className={`pointer-events-none fixed z-[205] select-none ${
                isPinned ? 'inset-x-0 bottom-24 flex justify-center' : 'left-0 top-0'
            }`}
            data-testid="ponder-hint-capsule"
            data-ponder-hint-placement={placement}
            aria-hidden="true"
        >
            {/* 从指针那个角长出来；钉在底部的那个从自己的底边长出来。 */}
            <motion.div
                initial={{ scale: small }}
                animate={{ scale: 1 }}
                exit={{ scale: small }}
                transition={transition}
                className="relative flex h-8 items-center gap-2 overflow-hidden rounded-[10px] bg-[var(--st-menu)] pl-1.5 pr-3 text-[13px] text-[color:var(--st-t1)] shadow-[0_10px_28px_rgba(0,0,0,0.32),0_0_0_1px_var(--st-line2)]"
                style={{
                    ...ponderWindowTokens(isDaylight, theme, calm),
                    originX: isPinned ? 0.5 : 0,
                    originY: isPinned ? 1 : 0,
                }}
            >
                {/* 长按进度：由 WAAPI 把 scaleX 从 0 推到 1，不是 React 状态。 */}
                <div
                    ref={ownWipeRef}
                    className="absolute inset-0 origin-left bg-[var(--st-accent)] opacity-[0.18]"
                    style={{ transform: 'scaleX(0)' }}
                />
                <span className="relative flex">
                    <PonderKeyCombo combo={isPinned ? 'Ctrl G' : 'G'} {...PONDER_QUIET_CAP} />
                </span>
                {/* 两段文案叠在同一格里交替；这一格平时是「思索」那么宽。两段都靠右：
                    「进入思索」的后两个字正好压在「思索」上，变宽时露出来的只是前面的「进入」。 */}
                <span ref={ownCellRef} className="relative grid grid-cols-[minmax(0,1fr)] overflow-hidden whitespace-nowrap text-[color:var(--st-t2)]">
                    <span ref={ownLabelRef} className="w-max justify-self-end [grid-area:1/1]">{label}</span>
                    <span ref={ownHoldLabelRef} className="w-max justify-self-end [grid-area:1/1]" style={{ opacity: 0 }}>
                        {t('ponder.hintCapsuleHold')}
                    </span>
                </span>
                {/* 目标名不跟着交替：按住的全程都要看得见讲的是哪一个。 */}
                {targetName ? <b className="relative whitespace-nowrap font-medium">{targetName}</b> : null}
            </motion.div>
        </motion.div>
    );
};

export default PonderHintCapsule;
