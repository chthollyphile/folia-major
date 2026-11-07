import React from 'react';
import type { ScratchpadHandleStyle } from '../../../stores/useScratchpadSettingsStore';
import ScratchpadHandleRest from './ScratchpadHandleRest';
import ScratchpadShape from './ScratchpadShape';

// src/components/app/scratchpad/ScratchpadEdge.tsx
// 左缘的热区：常驻时只露一点点（ScratchpadHandleRest，样式在设置里选，小而半透明，不打扰页面）；指针进来或键盘聚焦时，
// 完整的标签从左边滑出来——一条竖着的米白小信息条：红顶边、圆形记号、竖排「速记簿」、红色计数斜块、网点纹理，方正的长方形。
// 位置不变（左上 72px 起，沿用「悬浮标签高度」）。收进新歌时常驻的那一点闪一下。展开与否全由 CSS 的 :hover / :focus-within 管。

type ScratchpadEdgeProps = {
    handleStyle: ScratchpadHandleStyle;
    /** 0..1：设置里的「悬浮标签高度」。 */
    position: number;
    count: number;
    pulsing: boolean;
    title: string;
    label: string;
    /** 悬停提示（带开合的快捷键）。 */
    hint: string;
    onToggle: () => void;
    handleRef: React.Ref<HTMLButtonElement>;
};

const ScratchpadEdge: React.FC<ScratchpadEdgeProps> = ({ handleStyle, position, count, pulsing, title, label, hint, onToggle, handleRef }) => (
    <div
        className={`scratchpad-edge is-${handleStyle}${count > 0 ? ' has-entries' : ''}${pulsing ? ' is-pulsing' : ''}`}
        style={{ '--scratchpad-edge-position': position } as React.CSSProperties}
        data-ponder="scratchpad"
    >
        <span className="scratchpad-edge-rest" aria-hidden="true">
            <ScratchpadHandleRest handleStyle={handleStyle} />
        </span>
        <button
            ref={handleRef}
            type="button"
            className="scratchpad-handle"
            data-testid="scratchpad-handle"
            title={hint}
            aria-label={label}
            aria-expanded={false}
            onClick={onToggle}
        >
            <span className="scratchpad-handle-paper">
                <span className="scratchpad-handle-texture" aria-hidden="true" />
                <span className="scratchpad-handle-body">
                    <ScratchpadShape kind="circle" size={14} fill="var(--scratchpad-mark)" />
                    <span className="scratchpad-handle-title">{title}</span>
                    {count > 0 && <span className="scratchpad-handle-count"><span>{count}</span></span>}
                    <ScratchpadShape kind="circle" size={12} fill="none" stroke="var(--scratchpad-ink)" strokeWidth={2} />
                </span>
            </span>
        </button>
    </div>
);

export default ScratchpadEdge;
