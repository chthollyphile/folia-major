import { useEffect, useRef, useState } from 'react';
import type { Transition } from 'framer-motion';
import type { ScratchpadTab } from '../../../stores/useScratchpadStore';

// src/components/app/scratchpad/scratchpadPaper.ts
// 三页各一条米白的纸：这一页是顶上的信息条，另外两页是底部的细纸带（展开整页的总览里三条都是一行）。左缘面板与展开整页都这么摆
// （用户要的，2026-11-07：面板不再有左边一列页签，好让展开 / 收起时三条纸各自从原位长过去、缩回来）。
// 这里是两边共用的：面板里三条纸的位置、一条纸这一次怎么动（直接挪过去，或绕一圈从下面上来）、纸里那一面怎么交叉淡入，
// 以及两条细纸带的上下次序。

/** 一条纸的框（px）：面板里是窗口坐标，展开整页里是纸上坐标。 */
export type PaperFrame = { top: number; left: number; width: number; height: number };

/** 一条纸这一次怎么动：直接挪到新的框，或绕一圈（先往上出去、再从下面上来）；里面那一面什么时候换。 */
export type PaperMotion = {
    key: string;
    animate: Record<string, number | string | (number | string | null)[]>;
    transition: Transition;
    faceIn: Transition;
    faceOut: Transition;
};

/** 挪动、长高的曲线（与抽屉滑出同一条）。 */
export const PAPER_EASE = [0.22, 1, 0.36, 1] as const;

/**
 * 绕一圈去底部：一共多久，离开视口用掉的那一段占多少（之后在视口外一下子跳到下面，再升上来）。
 * 从下面升回来的那一段起步快、收得干脆（用户嫌原来的 easeOut 拖），离开那一段是渐快的 easeIn。
 */
const WRAP_DURATION = 0.58;
const WRAP_LEAVE = 0.5;
const WRAP_RISE_EASE = [0.2, 0.8, 0.3, 1] as const;

/** 纸里那一面的淡入淡出，时机按这一次的动法（custom）。 */
export const PAPER_FACE_VARIANTS = {
    hidden: { opacity: 0 },
    shown: (motion: PaperMotion) => ({ opacity: 1, transition: motion.faceIn }),
    gone: (motion: PaperMotion) => ({ opacity: 0, transition: motion.faceOut }),
};

/** 展开整页里细纸带多高；面板里矮一些（用户要的，2026-11-07），展开时长到这么高。 */
export const SLIM_HEIGHT = 36;
const PANEL_SLIM_HEIGHT = 28;

/** 左缘面板：宽 min(368px, 窗口宽 − 24px)（与 scratchpad.css 的 --scratchpad-width 一致）。 */
export const panelWidthFor = (viewWidth: number) => Math.min(368, viewWidth - 24);
/** 面板顶上那条信息条：离窗口顶 40px（让开标题栏），64px 高；纸都比面板宽 36px，探出面板。 */
export const PANEL_BAND_TOP = 40;
export const PANEL_BAND_HEIGHT = 64;
const PANEL_PROTRUDE = 36;
/** 面板底部两格细纸带的上沿离窗口底边多远（上面一格、下面一格；隔 6px，下面一格离底边 16px）。 */
const PANEL_SLIM_FROM_BOTTOM = [78, 44] as const;
/** 面板下面那一页给两条细纸带让出来的高度（scratchpad.css 的 .scratchpad-sheet 底边距）。 */
export const PANEL_SLIM_ROOM = PANEL_SLIM_FROM_BOTTOM[0];
/**
 * 细纸带上的字从左边多远起：展开整页里是纸上 186px（纸左边多出来 160px，转过之后约在窗口左边 26px），
 * 面板里挪到 26px——差的这 160px 写在 --scratchpad-slim-shift 上（装饰与纹理跟着挪），展开、收起时跟着纸一起变，字不跑。
 */
export const PANEL_SLIM_SHIFT = 160;

/** 面板里一条纸的框（窗口坐标）：slot 是 'band'（顶上那条）或细纸带的第几格（0 上、1 下）。 */
export const panelPaperFrame = (slot: 'band' | number, viewWidth: number, viewHeight: number): PaperFrame => {
    const width = panelWidthFor(viewWidth) + PANEL_PROTRUDE;
    if (slot === 'band') return { top: PANEL_BAND_TOP, left: 0, width, height: PANEL_BAND_HEIGHT };
    return { top: viewHeight - PANEL_SLIM_FROM_BOTTOM[Math.max(0, Math.min(1, slot))], left: 0, width, height: PANEL_SLIM_HEIGHT };
};

/** 窗口的宽高（跟着窗口变）。 */
export const useViewSize = () => {
    const [size, setSize] = useState(() => (typeof window === 'undefined'
        ? { width: 1440, height: 900 }
        : { width: window.innerWidth, height: window.innerHeight }));
    useEffect(() => {
        const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    return size;
};

/**
 * 两条细纸带的上下次序像一条传送带（用户定，2026-11-06）：新收下来的那条（从下面上来）落在下面一格，
 * 原来在下面的往上挪一格让位，已经在上面的不动；谁也不从下面穿过另一条。面板与展开整页共用同一个次序，
 * 展开、收起时每条细纸带落在对面同一格。
 */
export const useSlimOrder = (tabs: readonly ScratchpadTab[], tab: ScratchpadTab): ScratchpadTab[] => {
    const orderRef = useRef<ScratchpadTab[]>([]);
    const slim = tabs.filter(id => id !== tab);
    const kept = orderRef.current.filter(id => slim.includes(id));
    const next = [...kept, ...slim.filter(id => !kept.includes(id))];
    if (next.length !== orderRef.current.length || next.some((id, index) => id !== orderRef.current[index])) orderRef.current = next;
    return orderRef.current;
};

type PaperMotionOptions = {
    calm: boolean;
    /** 绕一圈时离开视口要到哪（纸的上沿，再减去纸自己的高）、从哪回来（纸的上沿）。 */
    above: number;
    below: number;
    /**
     * 每一次都带上的值（展开整页里细纸带的 --scratchpad-slim-shift 是 0）。绕一圈那一下也得写：animate 里少了哪个值，
     * framer 会把它退回 initial（展开起点的 160px），从下面升上来的细纸带字就往左挪出了纸（用户看到的）。
     */
    settle?: Record<string, string>;
};

/**
 * 每一条纸这一次怎么动。框或样子变了才重算，之后（动画途中别的状态变了、重渲染）原样复用同一个对象：
 * 换一个 animate 对象 framer 就会从半路直接改道去终点，绕一圈的那一下会被截断。
 * 所有的条都朝上走（用户定，2026-11-06）：要去当细纸带的条（从顶上那条、从总览的一行）先从上方离开视口，
 * 再从下面升回到底部（在视口外的那一下换高度、换样子）；往上去的条直接挪；两条细纸带之间对调直接挪。
 */
export const usePaperMotions = <Mode extends string>(slimMode: Mode) => {
    const motionsRef = useRef<Partial<Record<ScratchpadTab, PaperMotion & { mode: Mode; frame: PaperFrame }>>>({});
    return (id: ScratchpadTab, mode: Mode, frame: PaperFrame, { calm, above, below, settle }: PaperMotionOptions): PaperMotion => {
        const key = `${mode}|${frame.top}|${frame.left}|${frame.width}|${frame.height}|${calm ? 1 : 0}`;
        const previous = motionsRef.current[id];
        if (previous?.key === key) return previous;
        const toBottom = !calm && previous !== undefined && previous.mode !== slimMode && mode === slimMode;
        const next: PaperMotion = toBottom
            ? {
                key,
                // null：从此刻的位置（可能还在半路）起；离开视口、在视口外跳到下面、升到细纸带的位置。
                // 高、宽、左边也在视口外的那一下对齐。
                animate: {
                    top: [null, above - previous.frame.height, below, frame.top],
                    height: [previous.frame.height, previous.frame.height, frame.height, frame.height],
                    left: [previous.frame.left, previous.frame.left, frame.left, frame.left],
                    width: [previous.frame.width, previous.frame.width, frame.width, frame.width],
                    ...Object.fromEntries(Object.entries(settle ?? {}).map(([name, value]) => [name, [value, value, value, value]])),
                },
                transition: {
                    duration: WRAP_DURATION,
                    times: [0, WRAP_LEAVE, WRAP_LEAVE + 0.0005, 1],
                    ease: ['easeIn', 'linear', WRAP_RISE_EASE],
                },
                // 样子在视口外换：离开途中仍是原来的样子，回来时已经是细纸带。
                faceIn: { duration: 0.01, delay: WRAP_DURATION * WRAP_LEAVE },
                faceOut: { duration: 0.01, delay: WRAP_DURATION * WRAP_LEAVE },
            }
            : {
                key,
                animate: { ...frame, ...settle },
                transition: calm ? { duration: 0 } : { duration: 0.52, ease: PAPER_EASE },
                faceIn: { duration: calm ? 0.12 : 0.22, delay: calm ? 0 : 0.14 },
                faceOut: { duration: calm ? 0.08 : 0.14 },
            };
        motionsRef.current[id] = { ...next, mode, frame };
        return next;
    };
};
