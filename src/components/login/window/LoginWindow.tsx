import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { OnlineProviderId } from '../../../types/onlineMusic';
import { KIT_EASE, KIT_MOTION, useKitReducedMotion } from '../../modal/settings/kit/motion';
import Sheet from '../../shared/Sheet';
import type { LoginOrigin } from '../loginWindowStore';
import { PlatformMark, platformMarkOf } from '../PlatformMark';
import '../login.css';

// src/components/login/window/LoginWindow.tsx
// 登录窗口的框和版面：772 宽、至少 420 高，左边是平台的那一列，右边上面是标题，下面是那一块画和它
// 旁边的话。框是共用的 Sheet（背后的遮罩、焦点留在窗口里、关闭按钮、Esc、点遮罩关闭都是它的）。
// 窗口带一点正在看的那个平台的颜色；等待时从那一块画往外走的圈也画在窗口的底上。
// 应用的窗口比它窄的时候，那一列横到上面成一排，那一块画站到话的上面。
// 窗口从按下去的那个东西的那一边出来，平台的记号从那里走进标题。

const WIDTH = 772;
/** Sheet 在窗口四周留的边。 */
const MARGIN = 16;
const REST_HEIGHT = 420;
/** 宽版面里那一块画的中心在窗口里的位置：圈从这里往外走。 */
const TILE_CENTER = { x: 212 + 24 + 100, y: 130 + 100 };
/** 标题前面那个记号的大小。 */
const LEAD = 24;

const useNarrow = (): boolean => {
    const query = `(max-width: ${WIDTH + 2 * MARGIN - 1}px)`;
    const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
    useEffect(() => {
        const media = window.matchMedia(query);
        const read = () => setNarrow(media.matches);
        media.addEventListener('change', read);
        return () => media.removeEventListener('change', read);
    }, [query]);
    return narrow;
};

/**
 * 平台的记号从按下去的地方走进标题（480 毫秒，两头慢，缩到标题里那个记号的大小），走的时候标题里的
 * 那一个先不显。只在窗口开在一个平台上的那一次走，换了平台就不走了。
 * 回的是要画的那个在路上的记号，和标题里那个记号要用的 ref。
 */
const useMarkArrival = (isOpen: boolean, origin: LoginOrigin | null, providerId: OnlineProviderId | null, label: string) => {
    const leadRef = useRef<HTMLSpanElement>(null);
    const flyRef = useRef<HTMLSpanElement>(null);
    // 这一次打开还欠着一次走：窗口刚开，标题里的记号还没有出现过。
    const [owed, setOwed] = useState(false);
    useLayoutEffect(() => setOwed(isOpen && Boolean(origin?.providerId)), [isOpen, origin]);
    const onTheWay = owed && providerId !== null && providerId === origin?.providerId;
    useLayoutEffect(() => {
        if (!owed || providerId === null) return undefined;
        const lead = leadRef.current;
        const fly = flyRef.current;
        const panel = lead?.closest<HTMLElement>('[role="dialog"]');
        if (!onTheWay || !origin || !lead || !fly || !panel) {
            setOwed(false);
            return undefined;
        }
        // 标题里那个记号落定之后的位置：窗口这时还在进场的路上，所以从版面算，不从屏幕上量。
        let x = (window.innerWidth - panel.offsetWidth) / 2;
        let y = Math.max(MARGIN, window.innerHeight / 2 - REST_HEIGHT / 2);
        for (let at: HTMLElement | null = lead; at && at !== panel; at = at.offsetParent as HTMLElement | null) {
            x += at.offsetLeft;
            y += at.offsetTop;
        }
        const half = origin.size / 2;
        const flight = fly.animate([
            { transform: `translate(${origin.x - half}px, ${origin.y - half}px)` },
            { transform: `translate(${x + LEAD / 2 - half}px, ${y + LEAD / 2 - half}px) scale(${LEAD / origin.size})` },
        ], { duration: KIT_MOTION.show * 1000, easing: `cubic-bezier(${KIT_EASE.inOut.join(', ')})`, fill: 'forwards' });
        flight.onfinish = () => setOwed(false);
        return () => flight.cancel();
        // 跟着「欠不欠」和选中的平台走；origin 在一次打开里不变。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [owed, providerId]);
    const flying = onTheWay && origin && providerId ? createPortal(
        <span ref={flyRef} className="pointer-events-none fixed left-0 top-0 z-[300] inline-flex">
            <PlatformMark providerId={providerId} label={label} size={origin.size} />
        </span>,
        document.body,
    ) : null;
    return { leadRef, flying, onTheWay };
};

type LoginWindowProps = {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    closeTip: string;
    /** 正在看的平台：标题前是它的记号，窗口带它的颜色。没有选就是 null。 */
    providerId: OnlineProviderId | null;
    providerLabel: string;
    /** 正在等：圈从那一块画往外走。 */
    rings: boolean;
    column: (lie: 'column' | 'row') => React.ReactNode;
    tile: React.ReactNode;
    message: React.ReactNode;
    /** 那一块画和话的下面：展开的详情。只有它让窗口变高，往下长。 */
    below?: React.ReactNode;
    /** 按下去打开窗口的那个东西在哪：窗口从那一边出来。 */
    origin?: LoginOrigin | null;
    /** 铺在窗口上面的东西（登录成功的那一面颜色）；`narrow` 是窄版面。 */
    overlay?: (narrow: boolean) => React.ReactNode;
    /** 窗口原来说的（标题、那一列、那一行话）淡掉，只留那一块画和关闭按钮：上面要铺东西了。 */
    quiet?: boolean;
    /** 窗口放大着淡出，而不是往下收。 */
    leavesThrough?: boolean;
};

export const LoginWindow: React.FC<LoginWindowProps> = ({
    isOpen, onClose, title, closeTip, providerId, providerLabel, rings, column, tile, message, below, origin = null, overlay, quiet = false, leavesThrough = false,
}) => {
    const narrow = useNarrow();
    const still = useKitReducedMotion();
    const mark = providerId ? platformMarkOf(providerId, providerLabel) : null;
    // 这个平台的颜色，和画在它上面的字的颜色。
    const colour = { '--login-pc': mark?.color ?? 'var(--st-t3)', '--login-on-pc': mark?.onColor ?? 'var(--st-win)' } as React.CSSProperties;
    // 窗口从按下去的那一边出来：走那段距离的三成。
    const from = useMemo(() => (origin && !still ? { x: (origin.x - window.innerWidth / 2) * 0.3, y: (origin.y - window.innerHeight / 2) * 0.3 } : null), [origin, still]);
    const arrival = useMarkArrival(isOpen, still ? null : origin, providerId, providerLabel);
    const fades = `st-t-fast transition-opacity ${quiet ? 'opacity-0' : ''}`;

    return (
        <>
            <Sheet
                isOpen={isOpen}
                onClose={onClose}
                size="side"
                restHeight={REST_HEIGHT}
                title={title}
                closeTip={closeTip}
                from={from}
                quiet={quiet}
                leave={leavesThrough ? 'through' : undefined}
                ponderId="sign-in"
                titleLead={providerId ? (
                    <span ref={arrival.leadRef} className="inline-flex" style={arrival.onTheWay ? { opacity: 0 } : undefined}>
                        <PlatformMark providerId={providerId} label={providerLabel} size={LEAD} />
                    </span>
                ) : undefined}
                aside={narrow ? undefined : (
                    <div className="relative w-[212px] shrink-0 bg-[var(--st-side)] shadow-[inset_-1px_0_0_var(--st-line)]" style={{ '--login-edge': 'var(--st-side)' } as React.CSSProperties}>
                        <div className={`absolute inset-0 flex flex-col p-2 ${fades}`}>{column('column')}</div>
                    </div>
                )}
                underlay={mark && (
                    <div className="absolute inset-0" style={colour} data-login-still={still || undefined}>
                        <div
                            key={providerId}
                            className="login-fade absolute inset-0"
                            style={{ background: 'radial-gradient(62% 120% at 100% 0%, color-mix(in srgb, var(--login-pc) 17%, transparent), transparent 72%)' }}
                        />
                        {rings && !narrow && (
                            <svg className="login-rings login-fade absolute overflow-visible" width="1" height="1" style={{ left: TILE_CENTER.x, top: TILE_CENTER.y }}>
                                <circle r="104" /><circle r="104" /><circle r="104" />
                            </svg>
                        )}
                    </div>
                )}
                overlay={overlay && <div className="absolute inset-0" style={colour}>{overlay(narrow)}</div>}
            >
                <div style={colour} data-login-still={still || undefined} className={narrow ? 'flex flex-col gap-4' : 'pb-1 pt-[70px]'}>
                    {narrow && <div className={`-mx-2 ${fades}`}>{column('row')}</div>}
                    <div className={narrow ? 'flex flex-col items-center gap-4' : 'flex gap-6'}>
                        {tile}
                        <div className={`${narrow ? 'flex w-full min-w-0' : 'flex min-w-0 flex-1'} ${fades}`}>{message}</div>
                    </div>
                    {below}
                </div>
            </Sheet>
            {arrival.flying}
        </>
    );
};

export default LoginWindow;
