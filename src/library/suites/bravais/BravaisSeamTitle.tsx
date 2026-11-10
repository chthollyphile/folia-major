import React, { useCallback, useId, useRef } from 'react';
import { shouldToggleSeamFromTitle } from './bravaisSeamTitleClick';

// src/library/suites/bravais/BravaisSeamTitle.tsx
// 缝里可点的竖排标题（设计稿 §5「开口等级」）：完整信息条的标题区域（上下一对引号 + 竖排大标题）点一下收成书脊，
// 书脊上的竖排标题点一下展开回完整信息条——取代原来面包屑行右侧的「收起」按钮，让面包屑拿到整行宽度。
// 两者都是原生 <button>：Enter / Space 激活、进缝里的方向键序列（fb8a），读屏名是「收起信息条」/「展开信息条」，
// 标题文字经 aria-describedby 仍读得到。拖了一段再松手（像是想拖选文字）不算点击（bravaisSeamTitleClick）。
// 两者都挂 data-bravais-seam-toggle：键盘切换时缝整条翻，转完焦点交给新内容里的那一个（useBravaisSeam）。

/** 点标题的指针处理：记下按下的位置，click 时按 shouldToggleSeamFromTitle 决定要不要切换。 */
export const useBravaisSeamTitleClick = (onToggle: () => void) => {
    const downRef = useRef<{ x: number; y: number } | null>(null);
    const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
        downRef.current = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
    }, []);
    const onClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
        const node = event.currentTarget;
        const selection = window.getSelection();
        const hasSelection = Boolean(selection && !selection.isCollapsed && selection.toString().trim() !== '' && selection.containsNode(node, true));
        const down = downRef.current;
        downRef.current = null;
        if (shouldToggleSeamFromTitle({ detail: event.detail, down, at: { x: event.clientX, y: event.clientY }, hasSelection })) onToggle();
    }, [onToggle]);
    return { onPointerDown, onClick };
};

type BravaisSeamTitleAreaProps = {
    title: string;
    fontSize: number;
    /** 「收起信息条」（读屏名与悬停提示）。 */
    label: string;
    onCollapse: () => void;
    /** 横的信息条（BravaisSeamRow）：标题横排，引号按横排的方向——前面「“」、后面「”」（竖排时是右上「”」、左下「“」）。 */
    row?: boolean;
};

/** 完整信息条的标题区域：引号 + 竖排大标题整块是一个按钮，点它收成书脊。 */
export const BravaisSeamTitleArea: React.FC<BravaisSeamTitleAreaProps> = ({ title, fontSize, label, onCollapse, row = false }) => {
    const titleId = useId();
    const handlers = useBravaisSeamTitleClick(onCollapse);
    return (
        <button
            type="button"
            className="bravais-seam-title-area"
            data-bravais-seam-action="spine"
            data-bravais-seam-toggle=""
            aria-label={label}
            aria-describedby={titleId}
            title={label}
            {...handlers}
        >
            <span className="bravais-seam-quote" aria-hidden>{row ? '“' : '”'}</span>
            <span className="bravais-seam-vtitle-wrap">
                <span id={titleId} className="bravais-seam-vtitle" data-bravais-seam-title style={{ fontSize }}>{title}</span>
            </span>
            <span className="bravais-seam-quote is-closing" aria-hidden>{row ? '”' : '“'}</span>
        </button>
    );
};

type BravaisSeamSpineTitleProps = {
    title: string;
    fontSize: number;
    /** 「展开信息条」（读屏名与悬停提示）。 */
    label: string;
    onExpand: () => void;
};

/** 书脊上的竖排标题：点它展开回完整信息条。 */
export const BravaisSeamSpineTitle: React.FC<BravaisSeamSpineTitleProps> = ({ title, fontSize, label, onExpand }) => {
    const titleId = useId();
    const handlers = useBravaisSeamTitleClick(onExpand);
    return (
        <button
            type="button"
            className="bravais-seam-vtitle is-button"
            data-bravais-seam-action="expand"
            data-bravais-seam-title
            data-bravais-seam-toggle=""
            style={{ fontSize }}
            aria-label={label}
            aria-describedby={titleId}
            title={label}
            {...handlers}
        >
            <span id={titleId}>{title}</span>
        </button>
    );
};
