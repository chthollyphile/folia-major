import React from 'react';
import { ChevronRight, QrCode, Smartphone, User, X } from 'lucide-react';
import PonderSurfaceStateLayer, { PonderSurfaceBase } from '../PonderSurfaceStateLayer';
import {
    SIGN_IN_GEOMETRY as G,
    SIGN_IN_ROW_COUNT,
    SIGN_IN_SIGNED_IN_ROW,
    SIGN_IN_WINDOW as W,
    signInRowRect,
} from './signIn.geometry';
import { relativeRectStyle } from '../relativeRectStyle';
import type { PonderSurfaceDeclarations, PonderSurfaceProps as SurfaceProps } from '../surfaceDeclarations';

// src/components/ponder/surfaces/basics/signIn.surface.tsx
// 登录：没有人登录时的主页（中间一颗「登录」按钮，右下角那一枚），和这两处打开的登录窗口。
//
// 窗口画了两幅。选中一个还没登录的平台：右边是它的二维码、标题和一句说明，右下角一串步骤标记。
// 选中一个已经登录的平台：右边是它的账号和两颗按钮。两幅都盖在主页上，后一幅替换前一幅。

type Paint = Pick<SurfaceProps, 'accent' | 'line' | 'outline'>;

/** 窗口打开、停在一个还没登录的平台上的那一层。账号那一幅替换的是它。 */
const WINDOW_STATE = 'window-open';

/** 没有人登录时的主页：一句标题、两行提示、带着三个平台记号的「登录」按钮，右下角那一枚。 */
const HomePage: React.FC<Paint> = ({ accent, line, outline }) => (
    <>
        <span className="rounded-full" style={{ ...relativeRectStyle(G.title), backgroundColor: line, opacity: 0.95 }} />
        <span className="flex flex-col items-center justify-between" style={relativeRectStyle(G.prompt)}>
            <span className="h-[24%] w-full rounded-full opacity-60" style={{ backgroundColor: line }} />
            <span className="h-[24%] w-[56%] rounded-full opacity-60" style={{ backgroundColor: line }} />
        </span>
        {/* 小块里的留白用 inset 写：百分比的 padding 算的是整页的宽，不是这一块自己的。 */}
        <span data-ponder-sign-in-home-button className="rounded-xl" style={{ ...relativeRectStyle(G.homeButton), backgroundColor: accent }}>
            <span className="absolute inset-x-[9%] inset-y-[22%] flex items-center gap-[8%]">
                {/* 前三个平台的记号，叠着。 */}
                <span className="relative h-full shrink-0" style={{ aspectRatio: '2.1 / 1' }}>
                    {[0, 1, 2].map(index => (
                        <span
                            key={index}
                            className="absolute top-0 aspect-square h-full rounded-full"
                            style={{ left: `${index * 26}%`, backgroundColor: 'var(--st-on-accent)', boxShadow: `0 0 0 1.5px ${accent}` }}
                        />
                    ))}
                </span>
                <span className="h-[22%] min-w-0 flex-1 rounded-full" style={{ backgroundColor: 'var(--st-on-accent)' }} />
            </span>
        </span>
        {/* 右下角那一枚：正在用的平台的记号（登录后是头像），一道线，返回播放器的箭头。 */}
        <span
            data-ponder-sign-in-pill
            className="rounded-full"
            style={{ ...relativeRectStyle(G.pill), backgroundColor: 'var(--st-menu)', boxShadow: `inset 0 0 0 1px ${outline}` }}
        >
            <span className="absolute inset-x-[7%] inset-y-[12%] flex items-center">
                <span className="aspect-square h-full shrink-0 rounded-full" style={{ backgroundColor: accent }} />
                <span className="mx-[6%] h-[52%] w-px shrink-0" style={{ backgroundColor: outline }} />
                <ChevronRight className="h-[52%] w-auto min-w-0 flex-1 opacity-70" />
            </span>
        </span>
    </>
);

/** 那一列里每一行的名字有多长（占一行的几成）。 */
const ROW_NAME_WIDTHS = [26, 32, 22, 22, 30, 52];
/** 灰着、不能选的那一行。 */
const ROW_OFF = 3;

/** 像二维码的一块图案：三个角上的定位块，中间一片点。它不编码任何东西。 */
const CodePattern: React.FC = () => (
    <svg viewBox="0 0 21 21" className="h-[84%] w-[84%]" aria-hidden>
        {[[0, 0], [14, 0], [0, 14]].map(([x, y]) => (
            <g key={`${x}-${y}`}>
                <rect x={x} y={y} width="7" height="7" className="fill-zinc-900" />
                <rect x={x + 1} y={y + 1} width="5" height="5" className="fill-white" />
                <rect x={x + 2} y={y + 2} width="3" height="3" className="fill-zinc-900" />
            </g>
        ))}
        {Array.from({ length: 21 * 21 }, (_, index) => [index % 21, Math.floor(index / 21)] as const)
            .filter(([x, y]) => !(x < 8 && y < 8) && !(x > 12 && y < 8) && !(x < 8 && y > 12) && (x * 7 + y * 13 + x * y) % 5 < 2)
            .map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" className="fill-zinc-900" />)}
    </svg>
);

/**
 * 登录窗口。account 为真是账号那一幅：选中的是已经登录的那一行，右边是头像、名字和两颗按钮；
 * 否则选中第一行，右边是二维码、标题、一句说明和步骤标记。
 */
const LoginWindow: React.FC<Paint & { account?: boolean }> = ({ account, accent, line, outline }) => {
    const chosen = account ? SIGN_IN_SIGNED_IN_ROW : 0;
    return (
        <>
            <span className="absolute inset-0" style={{ backgroundColor: 'var(--pd-scrim)' }} />
            <div
                data-ponder-sign-in-window
                className="overflow-hidden rounded-xl"
                style={{ ...relativeRectStyle(G.window), backgroundColor: 'var(--st-win)', boxShadow: `0 0 0 1px ${outline}` }}
            >
                <span style={{ ...relativeRectStyle(W.column), backgroundColor: 'var(--st-side)', boxShadow: `inset -1px 0 0 ${line}` }} />
                {Array.from({ length: SIGN_IN_ROW_COUNT }, (_, index) => (
                    <span
                        key={index}
                        data-ponder-sign-in-row
                        className="flex items-center gap-[6%] rounded-md px-[1%]"
                        style={{
                            ...relativeRectStyle(signInRowRect(index)),
                            backgroundColor: index === chosen ? line : undefined,
                            opacity: index === ROW_OFF ? 0.4 : 1,
                        }}
                    >
                        <span className="aspect-square h-[60%] shrink-0 rounded-full" style={{ backgroundColor: index === chosen ? accent : outline }} />
                        <span className="h-[12%] rounded-full" style={{ width: `${ROW_NAME_WIDTHS[index]}%`, backgroundColor: outline }} />
                        <span className="flex-1" />
                        {/* 已经登录的那一行，右端是账号的头像。 */}
                        {index === SIGN_IN_SIGNED_IN_ROW && (
                            <span className="flex aspect-square h-[50%] shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: line }}>
                                <User className="h-[60%] w-auto opacity-70" />
                            </span>
                        )}
                    </span>
                ))}

                <span className="flex items-center gap-[5%]" style={relativeRectStyle(W.title)}>
                    <span className="aspect-square h-full shrink-0 rounded-full" style={{ backgroundColor: accent }} />
                    <span className="h-[28%] w-[62%] rounded-full" style={{ backgroundColor: line, opacity: 0.95 }} />
                </span>
                <X className="opacity-55" style={relativeRectStyle(W.close)} />

                {account ? (
                    <>
                        <span
                            data-ponder-sign-in-tile
                            className="flex items-center justify-center rounded-xl"
                            style={{ ...relativeRectStyle(W.tile), backgroundColor: 'var(--st-card)', boxShadow: `inset 0 0 0 1px ${line}` }}
                        >
                            {/* 头像，角上是平台的记号。 */}
                            <span className="relative flex aspect-square h-[44%] items-center justify-center rounded-full" style={{ backgroundColor: line }}>
                                <User className="h-[50%] w-auto opacity-70" />
                                <span className="absolute -bottom-[4%] -right-[4%] aspect-square h-[42%] rounded-full" style={{ backgroundColor: accent }} />
                            </span>
                        </span>
                        <span className="flex flex-col gap-[14%]" style={relativeRectStyle(W.message)}>
                            <span className="h-[20%] w-[24%] rounded-full" style={{ backgroundColor: line, opacity: 0.95 }} />
                            <span className="h-[11%] w-[58%] rounded-full opacity-60" style={{ backgroundColor: line }} />
                        </span>
                        {/* 切换到这个平台（实心的那一颗），退出登录。 */}
                        <span data-ponder-sign-in-actions className="flex items-stretch gap-[4%]" style={relativeRectStyle(W.actions)}>
                            <span className="flex flex-[1.45] items-center justify-center rounded-lg" style={{ backgroundColor: accent }}>
                                <span className="h-[12%] w-[64%] rounded-full" style={{ backgroundColor: 'var(--st-on-accent)' }} />
                            </span>
                            <span className="flex flex-1 items-center justify-center rounded-lg" style={{ backgroundColor: line }}>
                                <span className="h-[12%] w-[60%] rounded-full" style={{ backgroundColor: outline }} />
                            </span>
                        </span>
                    </>
                ) : (
                    <>
                        {/* 二维码底下那一块在两种主题里都是白的：码要在白底上才扫得出来。 */}
                        <span
                            data-ponder-sign-in-tile
                            className="flex items-center justify-center rounded-xl bg-white"
                            style={relativeRectStyle(W.tile)}
                        >
                            <CodePattern />
                        </span>
                        <span className="flex flex-col gap-[14%]" style={relativeRectStyle(W.message)}>
                            <span className="h-[20%] w-[62%] rounded-full" style={{ backgroundColor: line, opacity: 0.95 }} />
                            <span className="h-[11%] w-[78%] rounded-full opacity-60" style={{ backgroundColor: line }} />
                        </span>
                        {/* 步骤：二维码、手机、账号。走到的那一个描着边。 */}
                        <span data-ponder-sign-in-steps className="flex items-center" style={relativeRectStyle(W.steps)}>
                            {[QrCode, Smartphone, User].map((Icon, index) => (
                                <React.Fragment key={index}>
                                    {index > 0 && <span className="h-px min-w-0 flex-1" style={{ backgroundColor: outline }} />}
                                    <span
                                        className="flex aspect-square h-full shrink-0 items-center justify-center rounded-full"
                                        style={{ boxShadow: `inset 0 0 0 1.5px ${index === 0 ? accent : outline}` }}
                                    >
                                        <Icon className="h-[48%] w-auto" style={{ opacity: index === 0 ? 1 : 0.55 }} />
                                    </span>
                                </React.Fragment>
                            ))}
                        </span>
                    </>
                )}
            </div>
        </>
    );
};

const PonderSignInSurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => {
    const paint = { accent, line, outline };
    return (
        <div className="absolute inset-0 overflow-hidden" data-ponder-sign-in-structure>
            <PonderSurfaceBase registerStateNode={registerStateNode}>
                <HomePage {...paint} />
            </PonderSurfaceBase>

            <PonderSurfaceStateLayer state={WINDOW_STATE} registerStateNode={registerStateNode}>
                <LoginWindow {...paint} />
            </PonderSurfaceStateLayer>
            <PonderSurfaceStateLayer state="window-account" registerStateNode={registerStateNode} replaces={WINDOW_STATE}>
                <LoginWindow account {...paint} />
            </PonderSurfaceStateLayer>
        </div>
    );
};

export default {
    'sign-in': PonderSignInSurface,
} satisfies PonderSurfaceDeclarations;
