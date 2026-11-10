import React from 'react';
import { AlertTriangle, Eye, RefreshCw } from 'lucide-react';
import PonderSurfaceStateLayer, { PonderSurfaceBase } from '../PonderSurfaceStateLayer';
import {
    SettingsHeading as Heading,
    SettingsLabelRow as LabelRow,
    SettingsSegment as Segment,
    SettingsSegments as Segments,
    SettingsToggleRow as ToggleRow,
    type PonderSettingsSurfaceProps as SurfaceProps,
} from './ponderSettingsParts';
import {
    GRID_HOTKEY_GEOMETRY as H,
    LIBRARY_WATCH_GEOMETRY as W,
    LYRICS_SOURCE_GEOMETRY as L,
    QUEUE_SETTINGS_GEOMETRY as Q,
    REPLAY_GAIN_GEOMETRY as R,
    TRANSITION_SETTINGS_GEOMETRY as T,
} from './playbackSettings.geometry';
import { relativeRectStyle } from '../relativeRectStyle';
import type { PonderSurfaceDeclarations } from '../surfaceDeclarations';

// src/components/ponder/surfaces/settings/playbackSettings.surface.tsx
// 播放与交互那几组设置：过渡与自动混音、本地文件夹监视、加入队列的默认行为、
// 歌词来源、网格上的 S 归谁、音频增益。
//
// 放一个文件，因为它们是同一类形状 —— 分组标题加一张卡，卡里几行开关和分段选项。
// 形状本身来自 ponderSettingsParts；各拆一个文件只会多出五个几十行的模块。

/**
 * 过渡与自动混音。
 *
 * 要讲的是那枚徽章：选中 automix 不等于它真的在跑 —— 缺条件时会悄悄退回淡化，
 * 而唯一的提示就是「过渡模式」那一行两段左边那一小块字变成「已退回淡化」。
 */
const PonderTransitionSettingsSurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-transition-settings-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            <Heading rect={T.heading} line={line} />
            <div className="rounded-xl border" style={{ ...relativeRectStyle(T.card), borderColor: outline }}>
                <span className="absolute inset-x-0 top-[16%] h-px" style={{ backgroundColor: outline }} />
            </div>
            <ToggleRow marker="data-ponder-transition-enable" rect={T.enable} line={line} accent={accent} withDesc={false} on />
            {/* 「过渡模式」一行：左边名字，右端先是状态徽章，再是淡化 / 自动混音两段。 */}
            <span className="rounded-full" style={{ ...relativeRectStyle(T.modeLabel), backgroundColor: line }} />
            <span className="rounded-lg" style={{ ...relativeRectStyle(T.modeTrack), backgroundColor: line }} />
            <Segment marker="data-ponder-transition-crossfade" rect={T.modeCrossfade} outline={outline} accent={accent} />
            <Segment marker="data-ponder-transition-automix" rect={T.modeAutomix} outline={outline} accent={accent} selected />
            <span
                data-ponder-transition-badge
                className="flex items-center justify-center rounded-full"
                style={{ ...relativeRectStyle(T.badge), backgroundColor: `${accent}3d` }}
            >
                <span className="h-1 w-[62%] rounded-full" style={{ backgroundColor: accent }} />
            </span>
            <div className="flex flex-col justify-center gap-[16%]" style={relativeRectStyle(T.detail)}>
                <span className="flex items-center gap-2">
                    <span className="h-1.5 w-[32%] rounded-full opacity-70" style={{ backgroundColor: line }} />
                    <span className="flex-1" />
                    <span className="h-1.5 w-[10%] rounded-full opacity-50" style={{ backgroundColor: line }} />
                </span>
                <span className="relative h-1.5 rounded-full" style={{ backgroundColor: line }}>
                    <span className="absolute inset-y-0 left-0 w-[46%] rounded-full" style={{ backgroundColor: accent, opacity: 0.8 }} />
                </span>
            </div>

            {/* automix 缺条件时那条提示，右端一颗就地开启歌曲缓存的按钮。 */}
            <div
                data-ponder-transition-notice
                className="flex items-center gap-[4%] rounded-xl px-[4%]"
                style={{
                    ...relativeRectStyle(T.notice),
                    boxShadow: 'inset 0 0 0 1px var(--st-warn)',
                    backgroundColor: 'color-mix(in srgb, var(--st-warn) 12%, transparent)',
                }}
            >
                <AlertTriangle className="h-[42%] w-auto shrink-0" style={{ color: 'var(--st-warn)' }} />
                <span className="flex flex-1 flex-col gap-1">
                    <span className="h-1 w-[72%] rounded-full opacity-70" style={{ backgroundColor: 'var(--st-warn)' }} />
                    <span className="h-1 w-[34%] rounded-full" style={{ backgroundColor: 'var(--st-warn)' }} />
                </span>
                <span data-ponder-transition-notice-button className="flex h-[56%] w-[24%] shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: line }}>
                    <span className="h-1 w-[60%] rounded-full" style={{ backgroundColor: outline }} />
                </span>
            </div>
        </PonderSurfaceBase>
    </div>
);

/**
 * 本地文件夹监视。
 *
 * 开关打开之后才展开监视列表，而列表里每一行的图标有两种：正常的眼睛，和警告的三角 ——
 * 后者意味着这个文件夹的监视已经失效，但不点开看根本分辨不出来。
 */
const PonderLibraryWatchSurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-library-watch-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            <Heading rect={W.heading} line={line} />
            <div className="rounded-xl border" style={{ ...relativeRectStyle(W.card), borderColor: outline }} />
            <ToggleRow marker="data-ponder-watch-enable" rect={W.enable} line={line} accent={accent} />
        </PonderSurfaceBase>

        {/* 打开之后下面才长出监视列表、上次扫描时间和重新检查。 */}
        <PonderSurfaceStateLayer state="watch-on" registerStateNode={registerStateNode}>
            <ToggleRow marker="data-ponder-watch-enable-on" rect={W.enable} line={line} accent={accent} on />
            <div data-ponder-watch-roots className="flex flex-col justify-evenly" style={relativeRectStyle(W.roots)}>
                {([
                    [Eye, false],
                    [AlertTriangle, true],
                ] as const).map(([Icon, warning], index) => (
                    <span
                        key={index}
                        data-ponder-watch-root
                        data-ponder-watch-warning={warning || undefined}
                        className="flex h-[44%] flex-col justify-center gap-1 rounded-lg px-[4%]"
                        style={{ backgroundColor: 'rgba(0,0,0,0.25)', border: `1px solid ${outline}` }}
                    >
                        <span className="flex items-center gap-[3%]">
                            <Icon className="h-3 w-3 shrink-0" style={{ color: warning ? '#f59e0b' : undefined, opacity: warning ? 1 : 0.5 }} />
                            <span className="h-1 w-[46%] rounded-full" style={{ backgroundColor: line }} />
                        </span>
                        <span className="h-1 w-[72%] rounded-full opacity-35" style={{ backgroundColor: line }} />
                    </span>
                ))}
            </div>
            <span className="h-1 rounded-full opacity-45" style={{ ...relativeRectStyle(W.status), backgroundColor: line }} />
            <span
                data-ponder-watch-recheck
                className="flex items-center justify-center gap-[8%] rounded-lg"
                style={{ ...relativeRectStyle(W.recheck), backgroundColor: line }}
            >
                <RefreshCw className="h-3 w-3 opacity-60" />
                <span className="h-1 w-[36%] rounded-full opacity-55" style={{ backgroundColor: outline }} />
            </span>
        </PonderSurfaceStateLayer>
    </div>
);

/** 加入队列的默认位置：一行，左边名字，右端两段。 */
const PonderQueueSettingsSurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-queue-settings-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            <Heading rect={Q.heading} line={line} />
            <div className="rounded-xl border" style={{ ...relativeRectStyle(Q.card), borderColor: outline }} />
            <span className="rounded-full" style={{ ...relativeRectStyle(Q.copy), backgroundColor: line }} />
            <span className="rounded-lg" style={{ ...relativeRectStyle(Q.options), backgroundColor: line }} />
            <Segment marker="data-ponder-queue-append" rect={Q.optionAppend} outline={outline} accent={accent} selected />
            <Segment marker="data-ponder-queue-next" rect={Q.optionNext} outline={outline} accent={accent} />
        </PonderSurfaceBase>
    </div>
);

/** 歌词来源：自动择优开关、本地 / 在线优先两段、全局时间偏移入口。 */
const PonderLyricsSourceSurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-lyrics-source-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            <Heading rect={L.heading} line={line} />
            <div className="rounded-xl border" style={{ ...relativeRectStyle(L.card), borderColor: outline }}>
                <span className="absolute inset-x-0 top-[22%] h-px" style={{ backgroundColor: outline }} />
                <span className="absolute inset-x-0 top-[66%] h-px" style={{ backgroundColor: outline }} />
            </div>
            <ToggleRow marker="data-ponder-lyrics-auto-best" rect={L.autoBest} line={line} accent={accent} on />
            <span className="rounded-full" style={{ ...relativeRectStyle(L.priorityLabel), backgroundColor: line }} />
            <span className="rounded-lg" style={{ ...relativeRectStyle(L.priority), backgroundColor: line }} />
            <Segment marker="data-ponder-lyrics-priority-local" rect={L.priorityLocal} outline={outline} accent={accent} selected />
            <Segment marker="data-ponder-lyrics-priority-online" rect={L.priorityOnline} outline={outline} accent={accent} />
            <div
                data-ponder-lyrics-global-offset
                className="flex items-center gap-[4%] rounded-xl border px-[4%]"
                style={{ ...relativeRectStyle(L.globalOffset), borderColor: outline }}
            >
                <span className="flex flex-1 flex-col gap-1.5">
                    <span className="h-1.5 w-[42%] rounded-full" style={{ backgroundColor: line }} />
                    <span className="h-1 w-[68%] rounded-full opacity-45" style={{ backgroundColor: line }} />
                </span>
                <span className="h-4 w-4 shrink-0 rounded-full border" style={{ borderColor: outline }} />
            </div>
        </PonderSurfaceBase>
    </div>
);

/** 快捷操作 · 海报墙：向左滑动打开（两段），下面是 S 归谁的那一行开关。 */
const PonderGridHotkeySurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-grid-hotkey-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            <Heading rect={H.heading} line={line} />
            <div className="rounded-xl border" style={{ ...relativeRectStyle(H.card), borderColor: outline }}>
                <span className="absolute inset-x-[4%] top-[48%] h-px" style={{ backgroundColor: line }} />
            </div>
            <LabelRow rect={H.slideRow} line={line}>
                <Segments count={2} active={0} className="h-[46%] w-[42%]" line={line} outline={outline} accent={accent} />
            </LabelRow>
            <ToggleRow marker="data-ponder-grid-hotkey-toggle" rect={H.toggle} line={line} accent={accent} />
        </PonderSurfaceBase>

        {/* 打开之后 S 改归命令窗口；其余字符还是进筛选框。 */}
        <PonderSurfaceStateLayer state="hotkey-on" registerStateNode={registerStateNode}>
            <ToggleRow marker="data-ponder-grid-hotkey-toggle-on" rect={H.toggle} line={line} accent={accent} on />
        </PonderSurfaceStateLayer>
    </div>
);

/**
 * 音频增益（ReplayGain）：一行，左边名字，右端关闭、单曲、专辑三段。
 *
 * 结果层画的是控制面板来源页上那一小块同名控件 —— 同一个值的另一处开关。两处摆在
 * 同一张图上才说得清「改一处两处都变」；各画一张图就又成了两个互不相干的设置。
 */
const PonderReplayGainSurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-replay-gain-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            <Heading rect={R.heading} line={line} />
            <div className="rounded-xl border" style={{ ...relativeRectStyle(R.card), borderColor: outline }} />
            <span className="rounded-full" style={{ ...relativeRectStyle(R.copy), backgroundColor: line }} />
            <span className="rounded-lg" style={{ ...relativeRectStyle(R.modes), backgroundColor: line }} />
            {([
                ['data-ponder-replay-gain-off', R.modeOff, false],
                ['data-ponder-replay-gain-track', R.modeTrack, true],
                ['data-ponder-replay-gain-album', R.modeAlbum, false],
            ] as const).map(([marker, rect, selected]) => (
                <Segment key={marker} marker={marker} rect={rect} outline={outline} accent={accent} selected={selected} />
            ))}
        </PonderSurfaceBase>

        {/* 控制面板来源页上那一小块：同样三选一，外加这首歌自己那串 T / A 分贝。 */}
        <PonderSurfaceStateLayer state="panel-mirror" registerStateNode={registerStateNode} replaces>
            {/* 分贝那一行和三选一的几何都是「相对 panelTab」的，所以要画在这个框**里面**；
                摆到外面去就按整块面板算，两块都会比这一小格还宽。
                描边走 inset box-shadow：1px 的 border 会把里面的百分比整体挪掉 1px。 */}
            <div
                data-ponder-replay-gain-panel
                className="rounded-2xl"
                style={{ ...relativeRectStyle(R.panelTab), boxShadow: `inset 0 0 0 1px ${outline}`, backgroundColor: 'rgba(0,0,0,0.35)' }}
            >
                <span className="absolute left-[5%] top-[12%] h-[14%] w-[34%] rounded-full opacity-50" style={{ backgroundColor: line }} />
                <span
                    data-ponder-replay-gain-summary
                    className="flex items-center justify-end"
                    style={relativeRectStyle(R.panelSummary)}
                >
                    <span className="h-1 w-[78%] rounded-full opacity-65" style={{ backgroundColor: line }} />
                </span>
                <div data-ponder-replay-gain-panel-modes className="grid grid-cols-3 gap-[3%]" style={relativeRectStyle(R.panelModes)}>
                    {[0, 1, 2].map(index => (
                        <span
                            key={index}
                            className="flex items-center justify-center rounded-md"
                            style={{ backgroundColor: index === 1 ? `${accent}33` : 'rgba(255,255,255,0.06)' }}
                        >
                            <span className="h-1 w-[52%] rounded-full" style={{ backgroundColor: index === 1 ? accent : line }} />
                        </span>
                    ))}
                </div>
            </div>
        </PonderSurfaceStateLayer>
    </div>
);

export default {
    'transition-settings': PonderTransitionSettingsSurface,
    'library-watch-settings': PonderLibraryWatchSurface,
    'queue-settings': PonderQueueSettingsSurface,
    'lyrics-source-settings': PonderLyricsSourceSurface,
    'grid-hotkey-settings': PonderGridHotkeySurface,
    'replay-gain-settings': PonderReplayGainSurface,
} satisfies PonderSurfaceDeclarations;
