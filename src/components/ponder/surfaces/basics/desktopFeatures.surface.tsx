import React from 'react';
import { Minus, Pause, Square, X } from 'lucide-react';
import PonderSurfaceStateLayer, { PonderSurfaceBase, type PonderSurfaceStateRegistrar } from '../PonderSurfaceStateLayer';
import { DESKTOP_FEATURES_GEOMETRY as D } from './desktopFeatures.geometry';
import { relativeRectStyle } from '../relativeRectStyle';
import type { PonderSurfaceDeclarations } from '../surfaceDeclarations';

// src/components/ponder/surfaces/basics/desktopFeatures.surface.tsx
// 桌面端那三样东西：壁纸模式、系统托盘、遥控窗口。
//
// 画一整块桌面而不是画应用界面：这三样讲的都是「Folia 和操作系统之间的关系」——
// 窗口沉到哪一层、图标停在系统的哪一侧、另开的那个窗口浮在谁上面。
// 只画应用自己的界面，这三件事一件也说不清。

type SurfaceProps = {
    accent: string;
    line: string;
    outline: string;
    registerStateNode?: PonderSurfaceStateRegistrar;
};

/** 一扇窗：标题栏加三颗窗口按钮，下面是内容。 */
const WindowFrame: React.FC<{
    marker: string;
    rect: Parameters<typeof relativeRectStyle>[0];
    accent: string;
    line: string;
    outline: string;
    /** 壁纸模式下的主窗口：没有边框、没有标题栏，整块就是歌词。 */
    sunken?: boolean;
    children?: React.ReactNode;
}> = ({ marker, rect, accent, line, outline, sunken, children }) => (
    <div
        {...{ [marker]: true }}
        className={`flex flex-col overflow-hidden ${sunken ? 'rounded-none' : 'rounded-lg border'}`}
        style={{
            ...relativeRectStyle(rect),
            borderColor: outline,
            backgroundColor: sunken ? 'transparent' : 'rgba(24,24,27,0.95)',
        }}
    >
        {!sunken && (
            <span className="flex h-[14%] shrink-0 items-center gap-[2%] border-b px-[3%]" style={{ borderColor: outline }}>
                <span className="h-1 w-[22%] rounded-full opacity-55" style={{ backgroundColor: line }} />
                <span className="flex-1" />
                <Minus className="h-[52%] w-auto opacity-45" />
                <Square className="h-[42%] w-auto opacity-45" />
                <X className="h-[52%] w-auto opacity-45" />
            </span>
        )}
        <span className="flex min-h-0 flex-1 flex-col justify-center gap-[7%] px-[6%]">
            {children ?? [78, 96, 58].map((width, index) => (
                <span
                    key={width}
                    className="h-1.5 rounded-full"
                    style={{
                        width: `${width}%`,
                        backgroundColor: index === 1 ? accent : line,
                        opacity: index === 1 ? 0.85 : 0.5,
                    }}
                />
            ))}
        </span>
    </div>
);

const PonderDesktopFeaturesSurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-desktop-features-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            {/* 桌面本身：一块带壁纸的底。 */}
            <span
                data-ponder-desktop
                className="rounded-lg"
                style={{ ...relativeRectStyle(D.desktop), backgroundColor: line, opacity: 0.25 }}
            />
            <WindowFrame marker="data-ponder-desktop-main" rect={D.mainWindow} accent={accent} line={line} outline={outline} />
            <span
                data-ponder-desktop-taskbar
                className="flex items-center gap-[1.5%] rounded-md px-[2%]"
                style={{ ...relativeRectStyle(D.taskbar), backgroundColor: 'rgba(9,9,11,0.9)', border: `1px solid ${outline}` }}
            >
                {[0, 1, 2].map(index => (
                    <span key={index} className="aspect-square h-[54%] rounded-sm" style={{ backgroundColor: line }} />
                ))}
            </span>
            <span
                data-ponder-desktop-tray
                className="flex items-center justify-center rounded-sm"
                style={{ ...relativeRectStyle(D.trayIcon), backgroundColor: accent, opacity: 0.85 }}
            />
        </PonderSurfaceBase>

        {/* 壁纸模式：主窗口沉到桌面最底层，边框和标题栏都没了，只剩歌词。 */}
        <PonderSurfaceStateLayer state="wallpaper-on" registerStateNode={registerStateNode} replaces>
            <span
                className="rounded-lg"
                style={{ ...relativeRectStyle(D.desktop), backgroundColor: line, opacity: 0.25 }}
            />
            <div
                data-ponder-desktop-wallpaper
                className="flex flex-col justify-center gap-[6%]"
                style={relativeRectStyle({ left: 0.1, right: 0.1, top: 0.14, bottom: 0.24 })}
            >
                {[62, 88, 48, 74].map((width, index) => (
                    <span
                        key={width}
                        className="h-2 rounded-full"
                        style={{ width: `${width}%`, backgroundColor: index === 1 ? accent : line, opacity: index === 1 ? 0.9 : 0.45 }}
                    />
                ))}
            </div>
            <span
                className="flex items-center gap-[1.5%] rounded-md px-[2%]"
                style={{ ...relativeRectStyle(D.taskbar), backgroundColor: 'rgba(9,9,11,0.9)', border: `1px solid ${outline}` }}
            >
                {[0, 1, 2].map(index => (
                    <span key={index} className="aspect-square h-[54%] rounded-sm" style={{ backgroundColor: line }} />
                ))}
            </span>
            <span
                className="flex items-center justify-center rounded-sm"
                style={{ ...relativeRectStyle(D.trayIcon), backgroundColor: accent, opacity: 0.85 }}
            />
        </PonderSurfaceStateLayer>

        {/* 托盘菜单：从托盘图标上方弹出的一列。 */}
        <PonderSurfaceStateLayer state="tray-menu" registerStateNode={registerStateNode}>
            <div
                data-ponder-desktop-tray-menu
                className="flex flex-col justify-evenly rounded-lg border bg-zinc-950/98 px-[6%] py-[4%]"
                style={{ ...relativeRectStyle(D.trayMenu), borderColor: outline }}
            >
                {[62, 78, 54, 70, 46, 66].map((width, index) => (
                    <span
                        key={width}
                        data-ponder-desktop-tray-item
                        className="h-1 rounded-full"
                        style={{ width: `${width}%`, backgroundColor: index === 1 ? accent : line, opacity: index === 1 ? 0.9 : 0.6 }}
                    />
                ))}
            </div>
        </PonderSurfaceStateLayer>

        {/* 遥控窗口：另一个窗口，浮在主窗口之上，可以置顶、透明、点击穿透。 */}
        <PonderSurfaceStateLayer state="remote-open" registerStateNode={registerStateNode}>
            <WindowFrame
                marker="data-ponder-desktop-remote"
                rect={D.remoteWindow}
                accent={accent}
                line={line}
                outline={outline}
            >
                <span className="flex items-center justify-center gap-[8%]">
                    <span className="aspect-square h-3 rounded-full" style={{ backgroundColor: line }} />
                    <span className="flex aspect-square h-5 items-center justify-center rounded-full" style={{ backgroundColor: accent }}>
                        <Pause className="h-1/2 w-1/2" style={{ color: 'rgba(9,9,11,0.85)' }} />
                    </span>
                    <span className="aspect-square h-3 rounded-full" style={{ backgroundColor: line }} />
                </span>
                <span className="h-1 w-full rounded-full" style={{ backgroundColor: line, opacity: 0.6 }} />
            </WindowFrame>
        </PonderSurfaceStateLayer>
    </div>
);

export default {
    'desktop-features': PonderDesktopFeaturesSurface,
} satisfies PonderSurfaceDeclarations;
