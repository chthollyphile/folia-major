import { useCallback, useRef, type RefObject } from 'react';
import { formatWorldTransform, type WallView, type WallViewCenter } from '../../../components/wall/wallView';
import { computeBravaisFrame, posterSafeArea, seamTiltInsets, seamTransforms, wallHintRowSpan, wallHintSpan, withTilt } from './bravaisFrame';

// src/library/suites/bravais/useBravaisFrame.ts
// stage 每帧要写的那几样（相机、缝的锚点与动画中的开口、缝内容的排版宽度、是否折叠）放在一个可变的 ref 里，
// 相机与缝的动画只改它再调 renderFrame：直接写两个世界层的 transform、缝的位置与宽度、缝内容的透明度、
// 边缘标签的显隐与侧别、空墙说明的区间，不经过 React（frontend-runtime-guardrails：拖动、补间期间没有逐帧 setState）。
// 横向的缝（anchorY）写的是缝的 translateY 与高度，另记横条是否张开落定（data-bravais-seam-settled，落定时不裁内容）
// 与它在视口的上半还是下半（data-bravais-seam-half，菜单往另一边弹）。
// 这一页要倾斜时（tiltTargetDeg 不是 0，竖的缝）缝上挂 data-bravais-seam-tilted：缝上下多出一截出血、盖住转过去之后露出来的角
// （bravais.css），内容上下缩进到转过去之后仍在视口里（seamTiltInsets，写成 --bravais-seam-tilt-top / -bottom）。两样都按
// 要转到的角度给，角度一换就一次写到位，补间中不逐帧改（内容不逐帧重排）；回正时（目标是 0）立刻撤掉。海报有自己常驻的
// 出血与安全区（bravaisPoster.css、posterSafeArea），不看这两样。

export type BravaisFrameState = {
    view: WallView | null;
    center: WallViewCenter;
    anchorX: number | null;
    /** 横向的缝的锚点（块行边界的世界 y）；与 anchorX 至多一个不是 null（useBravaisSeam 的 setAnchor）。 */
    anchorY: number | null;
    openWidth: number;
    /** 开口正在补间去的宽度（不补间时等于 openWidth）：开口张开途中给聚焦卡的相机让位按张开后的缝算。 */
    targetOpenWidth: number;
    contentWidth: number;
    hidden: boolean;
    /** 歌手海报：开口贴着视口边也不收窄（bravaisFrame 的 poster）。 */
    poster: boolean;
    /** 整层此刻的倾斜角（度；补间中逐帧变）。 */
    tiltDeg: number;
    /** 倾斜正在补间去的角度（不补间时等于 tiltDeg）：聚焦卡的相机让位、缝的出血与内容缩进都按转到位之后的样子给。 */
    tiltTargetDeg: number;
    /** 倾斜没在补间：缝的旋转画进轨道那一层（字清楚），补间中整块交给合成器转（bravaisFrame 的 seamTransforms）。 */
    tiltSettled: boolean;
};

export type BravaisFrameRefs = {
    left: RefObject<HTMLDivElement | null>;
    right: RefObject<HTMLDivElement | null>;
    seam: RefObject<HTMLDivElement | null>;
    /** 缝外面的轨道（BravaisSeam）：缝的平移写在它上面，它自己成合成层。 */
    seamTrack: RefObject<HTMLDivElement | null>;
    seamContent: RefObject<HTMLDivElement | null>;
    tab: RefObject<HTMLButtonElement | null>;
    /** 空墙说明（BravaisWallHint）：只在它显示着时写（data-bravais-wall-hint="shown"）。 */
    hint: RefObject<HTMLDivElement | null>;
};

export const useBravaisFrame = (refs: BravaisFrameRefs) => {
    const stateRef = useRef<BravaisFrameState>({
        view: null,
        center: { x: 0, y: 0 },
        anchorX: null,
        anchorY: null,
        openWidth: 0,
        targetOpenWidth: 0,
        contentWidth: 0,
        hidden: false,
        poster: false,
        tiltDeg: 0,
        tiltTargetDeg: 0,
        tiltSettled: true,
    });
    /** 上一次写给轨道与缝的 transform（连同写给的节点）：只在变了时写（读回的 style.transform 会被浏览器规范化，不能拿来比）。 */
    const writtenRef = useRef<{ trackNode: HTMLElement | null; track: string; seamNode: HTMLElement | null; seam: string; insetsNode: HTMLElement | null; insets: string }>({
        trackNode: null, track: '', seamNode: null, seam: '', insetsNode: null, insets: '',
    });

    const renderFrame = useCallback(() => {
        const state = stateRef.current;
        if (!state.view) return;
        const frame = computeBravaisFrame({
            center: state.center,
            view: state.view,
            anchorX: state.anchorX,
            anchorY: state.anchorY,
            openWidth: state.openWidth,
            contentWidth: state.contentWidth,
            hidden: state.hidden,
            poster: state.poster,
            tiltDeg: state.tiltDeg,
        });
        const { left, right, seam, seamTrack, seamContent, tab, hint } = refs;
        if (left.current) left.current.style.transform = withTilt(formatWorldTransform(frame.left.x, frame.left.y, frame.scale), frame.tilt);
        if (right.current) right.current.style.transform = withTilt(formatWorldTransform(frame.right.x, frame.right.y, frame.scale), frame.tilt);
        const seamElement = seam.current;
        if (seamElement) {
            // 另一个方向上的尺寸交还给样式表（竖的缝满高、横的满宽；样式按缝上的 data-bravais-seam-axis，见 BravaisSeam）。
            if (frame.seam.axis === 'y') {
                seamElement.style.height = `${frame.seam.width}px`;
                if (seamElement.style.width) seamElement.style.width = '';
                // 横条张开到排版高度（不在开合途中、没被视口边挤窄）时不裁内容，菜单可以伸出横条；菜单往视口宽的那边弹。
                const settled = frame.seam.visible && frame.seam.width >= state.contentWidth - 0.5;
                if (settled !== (seamElement.dataset.bravaisSeamSettled !== undefined)) {
                    if (settled) seamElement.dataset.bravaisSeamSettled = '';
                    else delete seamElement.dataset.bravaisSeamSettled;
                }
                const half = frame.seam.y < state.view.height / 2 ? 'top' : 'bottom';
                if (seamElement.dataset.bravaisSeamHalf !== half) seamElement.dataset.bravaisSeamHalf = half;
            } else {
                if (seamElement.dataset.bravaisSeamSettled !== undefined) delete seamElement.dataset.bravaisSeamSettled;
                if (seamElement.style.height) seamElement.style.height = '';
                seamElement.style.width = `${frame.seam.width}px`;
            }
            // 缝与两半墙同一层：倾斜时一起转（轨道与缝的 transform-origin 都对准屏幕原点，见 bravais.css）。平移写在轨道上，
            // 旋转落定后写在缝上（seamTransforms）；只在变了时写，拖动中缝的那段不变就不重画。
            const transforms = seamTransforms(frame, { tiltSettled: state.tiltSettled, devicePixelRatio: window.devicePixelRatio });
            const written = writtenRef.current;
            const track = seamTrack.current;
            if (track && (written.trackNode !== track || written.track !== transforms.track)) {
                track.style.transform = transforms.track;
                written.trackNode = track;
                written.track = transforms.track;
            }
            if (written.seamNode !== seamElement || written.seam !== transforms.seam) {
                seamElement.style.transform = transforms.seam;
                written.seamNode = seamElement;
                written.seam = transforms.seam;
            }
            const visibility = frame.seam.visible ? 'visible' : 'hidden';
            if (seamElement.style.visibility !== visibility) seamElement.style.visibility = visibility;
            // 要倾斜的竖缝上下多出一截出血（样式按这个属性给，海报除外：它的出血常驻）。
            const tilted = frame.seam.axis === 'x' && Math.abs(state.tiltTargetDeg) >= 0.001;
            if (tilted !== (seamElement.dataset.bravaisSeamTilted !== undefined)) {
                if (tilted) seamElement.dataset.bravaisSeamTilted = '';
                else delete seamElement.dataset.bravaisSeamTilted;
            }
        }
        const contentElement = seamContent.current;
        if (contentElement) {
            contentElement.style.opacity = String(frame.contentOpacity);
            // 海报跟着倾斜时四个角会转出屏幕：内容缩进安全区（posterSafeArea，按落定的海报宽度算，拖动时不变）。
            const safe = state.poster
                ? posterSafeArea({ width: state.targetOpenWidth, height: state.view.height, deg: frame.tilt.deg })
                : { scale: 1, offsetY: 0 };
            contentElement.style.setProperty('--bravais-poster-safe-scale', safe.scale.toFixed(4));
            contentElement.style.setProperty('--bravais-poster-safe-y', `${safe.offsetY.toFixed(1)}px`);
            // 倾斜的信息条 / 书脊 / 首页窄缝：内容上下缩进（按这套内容的排版宽度与要转到的角度算，拖动、补间中都不变；
            // 只在变了时写）。缝里画着海报时样式不读这两个变量（海报用上面的安全区）。
            const insets = frame.seam.axis === 'x'
                ? seamTiltInsets({ width: state.contentWidth, height: state.view.height, deg: state.tiltTargetDeg })
                : { top: 0, bottom: 0 };
            const insetsKey = `${insets.top.toFixed(1)}px ${insets.bottom.toFixed(1)}px`;
            const written = writtenRef.current;
            if (written.insetsNode !== contentElement || written.insets !== insetsKey) {
                contentElement.style.setProperty('--bravais-seam-tilt-top', `${insets.top.toFixed(1)}px`);
                contentElement.style.setProperty('--bravais-seam-tilt-bottom', `${insets.bottom.toFixed(1)}px`);
                written.insetsNode = contentElement;
                written.insets = insetsKey;
            }
        }
        const tabElement = tab.current;
        if (tabElement) {
            const display = frame.tab.visible ? '' : 'none';
            if (tabElement.style.display !== display) tabElement.style.display = display;
            if (tabElement.dataset.side !== frame.tab.side) tabElement.dataset.side = frame.tab.side;
        }
        const hintElement = hint.current;
        if (hintElement && hintElement.dataset.bravaisWallHint === 'shown') {
            // 取整到像素：拖动时文字只在区间真的变宽 / 变窄一像素时重排。
            const span = wallHintSpan(frame, state.view.width);
            const row = wallHintRowSpan(frame, state.view.height);
            const hintLeft = `${Math.round(span.left)}px`;
            const hintWidth = `${Math.round(span.width)}px`;
            const hintTop = `${Math.round(row.top)}px`;
            const hintHeight = `${Math.round(row.height)}px`;
            if (hintElement.style.left !== hintLeft) hintElement.style.left = hintLeft;
            if (hintElement.style.width !== hintWidth) hintElement.style.width = hintWidth;
            if (hintElement.style.top !== hintTop) hintElement.style.top = hintTop;
            if (hintElement.style.height !== hintHeight) hintElement.style.height = hintHeight;
        }
    }, [refs]);

    return { stateRef, renderFrame };
};
