import React from 'react';
import { anchorPointToPx } from '../../utils/ponder/resolvePonderAnchors';
import type { PonderStageScreen } from '../../utils/ponder/ponderStageLayout';
import type { PonderAnchorSource, PonderRect, PonderTimelinePlan } from '../../types/ponder';
import type { PonderStageNodes } from './ponderStageNodes';
import PonderFocusFrame from './PonderFocusFrame';
import { PonderKeyCombo } from './PonderKeyCap';

// src/components/ponder/PonderActors.tsx
// 画面上会动的那几个：聚焦框、光标、按下时的扩散圈、按键胶片。
//
// 全部预渲染在 opacity 0 并登记进节点表，由时间线按绝对时间点亮 —— 组件本身不随播放
// 重渲染一次。胶片一个步骤一个节点，这样时间线能按 step.id 精确找到演员。
// 字幕不在这里：它固定在画面下方那一块，见 PonderCaptionBlock。

/** 写了 at: 'bottom' 的按键胶片，离画面底边这么远。 */
const BOTTOM_KEYS_INSET_PX = 98;

type PonderActorsProps = {
    plan: PonderTimelinePlan;
    rects: Record<string, PonderRect>;
    anchors: Record<string, PonderAnchorSource>;
    nodes: PonderStageNodes;
    /** 骨架画在上面的那块屏。 */
    screen: PonderStageScreen;
};

const PonderActors: React.FC<PonderActorsProps> = ({ plan, rects, anchors, nodes, screen }) => {
    const keypressSteps = plan.entries.filter(entry => entry.step.kind === 'keypress');

    return (
        // z-40：压在骨架之上。整层 pointer-events-none，不挡任何点击。
        <div className="pointer-events-none absolute inset-0 z-40" aria-hidden="true">
            <PonderFocusFrame plan={plan} rects={rects} anchors={anchors} nodes={nodes} screen={screen} />

            {keypressSteps.map(({ step }) => {
                if (step.kind !== 'keypress') return null;
                const point = step.at === 'bottom'
                    ? { x: screen.left + screen.width / 2, y: screen.top + screen.height - BOTTOM_KEYS_INSET_PX }
                    : anchorPointToPx(step.at, rects);
                return (
                    <div
                        key={step.id}
                        ref={node => {
                            if (node) nodes.keyChips.set(step.id, node);
                            else nodes.keyChips.delete(step.id);
                        }}
                        className="absolute flex -translate-x-1/2 gap-1"
                        style={point ? { left: point.x, top: point.y, opacity: 0 } : { opacity: 0 }}
                    >
                        {step.keys.map(key => (
                            <PonderKeyCombo key={key} combo={key} accent="var(--st-accent)" surface="var(--st-card)" text="var(--st-t1)" />
                        ))}
                    </div>
                );
            })}

            {/* 光标。transform 由时间线写，这里只给初始形态。 */}
            <div
                ref={node => { nodes.cursor = node; }}
                className="absolute left-0 top-0"
                style={{ transform: 'translate(-100px, -100px)' }}
            >
                <div
                    ref={node => { nodes.cursorRing = node; }}
                    className="absolute -left-4 -top-4 h-8 w-8 rounded-full border-2 border-[var(--st-accent)]"
                    style={{ opacity: 0 }}
                />
                <svg width="20" height="20" viewBox="0 0 20 20" className="relative -left-1 -top-1 drop-shadow">
                    <path d="M3 2 L3 15 L7 11.5 L9.5 17 L12 16 L9.5 10.5 L14.5 10.5 Z" fill="var(--st-accent)" stroke="var(--st-pv)" strokeWidth="1" />
                </svg>
            </div>
        </div>
    );
};

export default PonderActors;
