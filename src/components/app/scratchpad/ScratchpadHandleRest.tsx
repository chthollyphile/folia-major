import React from 'react';
import type { ScratchpadHandleStyle } from '../../../stores/useScratchpadSettingsStore';
import ScratchpadShape from './ScratchpadShape';
import { SCRATCHPAD_MARK_FALLBACK, SCRATCHPAD_MARK_WALL_FALLBACK, SCRATCHPAD_PAPER } from './scratchpadLook';

// src/components/app/scratchpad/ScratchpadHandleRest.tsx
// 悬浮标签常驻时（指针还没进左缘热区）露出来的那一点点：米白小条、细竖线、小圆点、几何体三颗。都贴着左缘、小而半透明。
// 左缘的热区（ScratchpadHost）和设置页「悬浮标签样式」的小图共用它；小图按 scale 缩小，形状一样。

// 颜色读速记簿根节点上的变量（日光主题下墙是浅的，记号换成墨色）；设置页的小图包在 .scratchpad-look 里读同一套点缀色，
// 纸色退回暗色墙上的配色。
const REST_INK = `var(--scratchpad-rest-ink, ${SCRATCHPAD_PAPER})`;
const MARK_ON_WALL = `var(--scratchpad-mark-wall, ${SCRATCHPAD_MARK_WALL_FALLBACK})`;
const MARK_ON_PAPER = `var(--scratchpad-mark, ${SCRATCHPAD_MARK_FALLBACK})`;

type ScratchpadHandleRestProps = {
    handleStyle: ScratchpadHandleStyle;
    /** 设置页的小图用 0.5 左右；左缘真实大小是 1。 */
    scale?: number;
    /** 设置页的小图里要看得清是哪一种：不按常驻时那么淡（左缘上的透明度在 scratchpad.css）。 */
    vivid?: boolean;
};

const ScratchpadHandleRest: React.FC<ScratchpadHandleRestProps> = ({ handleStyle, scale = 1, vivid = false }) => {
    const px = (value: number) => Math.round(value * scale * 10) / 10;
    const opacity = vivid ? 0.95 : undefined;
    if (handleStyle === 'line') {
        return <span className="scratchpad-rest-line" style={{ width: px(3), height: px(72), background: REST_INK, opacity }} />;
    }
    if (handleStyle === 'dot') {
        return <span className="scratchpad-rest-dot" style={{ width: px(14), height: px(14), marginLeft: -px(7), background: MARK_ON_WALL, opacity }} />;
    }
    if (handleStyle === 'shapes') {
        return (
            <span className="scratchpad-rest-shapes" style={{ gap: px(6), marginLeft: px(4), opacity }}>
                <ScratchpadShape kind="circle" size={px(8)} fill={MARK_ON_WALL} />
                <ScratchpadShape kind="tri" size={px(8)} fill={REST_INK} />
                <ScratchpadShape kind="chev" size={px(8)} fill={REST_INK} />
            </span>
        );
    }
    return (
        <span
            className="scratchpad-rest-strip"
            style={{ width: px(6), height: px(56), background: REST_INK, boxShadow: `inset 0 ${px(2)}px 0 ${MARK_ON_PAPER}`, opacity }}
        />
    );
};

export default ScratchpadHandleRest;
