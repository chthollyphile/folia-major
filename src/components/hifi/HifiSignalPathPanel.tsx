import React from 'react';
import { BadgeCheck, BadgeInfo, CircleHelp, Merge, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { HifiSignalPath, HifiSignalStage, HifiSignalStageStatus, HifiSignalVerdict } from '../../types/hifi';
import { useHifiTrackStore } from '../../services/hifi/hifiTrackStore';
import { useHifiSettingsStore } from '../../stores/useHifiSettingsStore';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { WebAudioSignalPath } from './WebAudioSignalPath';
import Sheet from '../shared/Sheet';
import { useHifiPanelStore } from './hifiPanelStore';
import { HifiSystemFootnote, HifiSystemReport } from './HifiSystemReport';
import {
    describeConversion,
    describeStage,
    formatStageFormat,
    isConversionLossless,
    isValuePreservingPath,
    stageLabel,
    stageStatusLabel,
    verdictDescription,
    verdictTitle,
} from './hifiSignalText';
import { useHifiOutputProbe } from './useHifiOutputProbe';
import { readHifiPlatform, useHifiSignalPath, useHifiTrackDeferred, useIsHifiRoute } from './useHifiSignalPath';

// src/components/hifi/HifiSignalPathPanel.tsx
// HiFi 信号链路面板：顶上一行大字说结论（原生直通 / 经 DoP 原生输出 DSD / 采样率直通（经 PipeWire）/ 已转换 /
// 经过系统混音器 / 尚未确认），下面从源文件到输出设备逐级列出每一级的状态、格式和改动；Linux 上经 PipeWire 时最后一级是
// PipeWire 报的设备，逐项列出检查、没切采样率时的原因和配置，并总是注明那只是 PipeWire 报的、要看 DAC 的指示确认。
// 底部注明 HiFi 绕过了哪些功能。在 AppOverlays 里挂一次，开关由 hifiPanelStore 管；Web 路线显示引擎与应用转码情况。
// PipeWire 的探测（useHifiOutputProbe）也挂在这里：面板关着时照样在跑，徽标的结论要用它。

const VERDICT_LOOK: Record<HifiSignalVerdict, { icon: LucideIcon; className: string }> = {
    'bit-perfect': { icon: BadgeCheck, className: 'text-[color:var(--st-ok)]' },
    dop: { icon: BadgeCheck, className: 'text-[color:var(--st-ok)]' },
    // 不用逐位直通的那个勾：这只是 PipeWire 报的采样率对得上。
    'rate-passthrough': { icon: BadgeInfo, className: 'text-[color:var(--st-accent)]' },
    converted: { icon: TriangleAlert, className: 'text-[color:var(--st-warn)]' },
    'shared-mixer': { icon: Merge, className: 'text-[color:var(--st-warn)]' },
    unknown: { icon: CircleHelp, className: 'text-[color:var(--st-t3)]' },
};
// 已转换但只有数值不变的格式转换（float 转 s32、转成浮点）：和采样率直通同一个提示图标，不用警告色。
const VALUE_PRESERVING_LOOK = { icon: BadgeInfo, className: 'text-[color:var(--st-accent)]' };

const STATUS_CHIP_CLASS: Record<HifiSignalStageStatus, string> = {
    passthrough: 'bg-[color-mix(in_srgb,var(--st-ok)_14%,transparent)] text-[color:var(--st-ok)]',
    converted: 'bg-[color-mix(in_srgb,var(--st-warn)_14%,transparent)] text-[color:var(--st-warn)]',
    bypassed: 'bg-[var(--st-fill)] text-[color:var(--st-t2)]',
    unknown: 'bg-[var(--st-fill)] text-[color:var(--st-t3)]',
};

const STATUS_DOT_CLASS: Record<HifiSignalStageStatus, string> = {
    passthrough: 'bg-[var(--st-ok)]',
    converted: 'bg-[var(--st-warn)]',
    bypassed: 'bg-[var(--st-t3)]',
    unknown: 'bg-[var(--st-line2)]',
};

// PipeWire 那一级全都对得上时也不用逐位直通的绿色：那只是 PipeWire 报的状态，不是确认。
const SYSTEM_PASSTHROUGH_CHIP_CLASS = 'bg-[color-mix(in_srgb,var(--st-accent)_14%,transparent)] text-[color:var(--st-accent)]';
const SYSTEM_PASSTHROUGH_DOT_CLASS = 'bg-[var(--st-accent)]';

const stageChipClass = (stage: HifiSignalStage) => (
    stage.id === 'system' && stage.status === 'passthrough' ? SYSTEM_PASSTHROUGH_CHIP_CLASS : STATUS_CHIP_CLASS[stage.status]
);

const stageDotClass = (stage: HifiSignalStage) => (
    stage.id === 'system' && stage.status === 'passthrough' ? SYSTEM_PASSTHROUGH_DOT_CLASS : STATUS_DOT_CLASS[stage.status]
);

type StageRowProps = {
    stage: HifiSignalStage;
    path: HifiSignalPath;
    origin: 'local' | 'navidrome' | null;
    /** 输出级上设置里记着的设备名（比 mpv 的设备 id 好认）。 */
    deviceLabel: string | null;
    isLast: boolean;
};

const StageRow: React.FC<StageRowProps> = ({ stage, path, origin, deviceLabel, isLast }) => {
    const { t, i18n } = useTranslation();
    const format = formatStageFormat(stage, t, i18n.language);
    const description = describeStage(stage, path, origin, t, readHifiPlatform());

    return (
        <li className="flex gap-3">
            {/* 左边一条竖线把五级串起来，点的颜色就是这一级的状态。 */}
            <div aria-hidden className="flex w-2.5 shrink-0 flex-col items-center">
                <span className={`mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full ${stageDotClass(stage)}`} />
                {!isLast && <span className="mt-1 w-px flex-1 bg-[var(--st-line)]" />}
            </div>
            <div className={`min-w-0 flex-1${isLast ? '' : ' pb-4'}`}>
                <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium leading-5">{stageLabel(stage.id, t)}</span>
                    <span className={`shrink-0 rounded px-1.5 text-[11px] leading-[18px] ${stageChipClass(stage)}`}>
                        {stageStatusLabel(stage.status, t)}
                    </span>
                </div>
                {format && <p className="mt-0.5 text-[13px] leading-5 tabular-nums">{format}</p>}
                {description && <p className="text-xs leading-[18px] text-[color:var(--st-t2)]">{description}</p>}
                {stage.id === 'output' && deviceLabel && (
                    <p className="text-xs leading-[18px] text-[color:var(--st-t2)]">{deviceLabel}</p>
                )}
                {stage.detail && (
                    <p className="break-all font-mono text-[11px] leading-4 text-[color:var(--st-t3)]">{stage.detail}</p>
                )}
                {/* PipeWire 那一级的改动由下面的逐项检查说，不再列一遍。 */}
                {stage.id !== 'system' && stage.conversions.length > 0 && (
                    <ul className="mt-1 flex flex-col gap-0.5">
                        {stage.conversions.map(conversion => (
                            <li
                                key={conversion}
                                className={`text-xs leading-[18px] ${isConversionLossless(conversion) ? 'text-[color:var(--st-ok)]' : 'text-[color:var(--st-warn)]'}`}
                            >
                                {describeConversion(conversion, path, t, i18n.language, stage.id)}
                            </li>
                        ))}
                    </ul>
                )}
                {stage.id === 'system' && <HifiSystemReport path={path} />}
            </div>
        </li>
    );
};

const HifiSignalPathPanel: React.FC = () => {
    const { t } = useTranslation();
    const isOpen = useHifiPanelStore(state => state.isSignalPathOpen);
    const close = useHifiPanelStore(state => state.closeSignalPath);
    const isHifiRoute = useIsHifiRoute();
    const path = useHifiSignalPath();
    const deferred = useHifiTrackDeferred();
    const songName = useHifiTrackStore(state => state.current?.song.name ?? null);
    const webSongName = usePlaybackStore(state => state.currentSong?.name ?? null);
    const origin = useHifiTrackStore(state => state.current?.origin ?? state.sourceSpec?.origin ?? null);
    const audioDevice = useHifiSettingsStore(state => state.audioDevice);
    const audioDeviceLabel = useHifiSettingsStore(state => state.audioDeviceLabel);

    useHifiOutputProbe(isOpen);

    const look = path ? (isValuePreservingPath(path) ? VALUE_PRESERVING_LOOK : VERDICT_LOOK[path.verdict]) : null;
    const deviceLabel = path && audioDeviceLabel && path.output.device === audioDevice ? audioDeviceLabel : null;

    // 一直画同一个 Sheet，关上时它还能带着最后的内容退场。
    return (
        <Sheet
            isOpen={isOpen}
            onClose={close}
            size="m"
            title={t(isHifiRoute ? 'hifi.signal.title' : 'hifi.web.title')}
            subtitle={(isHifiRoute ? songName : webSongName) ?? undefined}
            footerNote={t(isHifiRoute ? 'hifi.signal.bypassedNote' : 'hifi.web.note')}
        >
            {!isHifiRoute && <WebAudioSignalPath />}
            {path && look && (
                <>
                    <section className="flex items-start gap-3 rounded-xl bg-[var(--st-card)] px-4 py-3.5 shadow-[0_0_0_1px_var(--st-line)]">
                        <look.icon size={22} aria-hidden className={`mt-0.5 shrink-0 ${look.className}`} />
                        <div className="min-w-0 flex-1">
                            <p role="status" className="text-lg font-semibold leading-7">{verdictTitle(path.verdict, t)}</p>
                            <p className="mt-0.5 text-[13px] leading-5 text-[color:var(--st-t2)]">
                                {/* 恢复出来还没载入的曲目：按下播放、mpv 载入之后才有结论。 */}
                                {deferred ? t('hifi.signal.verdictDesc.notLoaded') : verdictDescription(path, t, readHifiPlatform())}
                            </p>
                        </div>
                    </section>
                    <ol aria-label={t('hifi.signal.stagesLabel')} className="mt-5 px-1">
                        {path.stages.map((stage, index) => (
                            <StageRow
                                key={stage.id}
                                stage={stage}
                                path={path}
                                origin={origin}
                                deviceLabel={deviceLabel}
                                isLast={index === path.stages.length - 1}
                            />
                        ))}
                    </ol>
                    {/* PipeWire 报的不等于 DAC 收到的：有 PipeWire 那一级就总写这一句，采样率对上了也写。 */}
                    {path.system && <HifiSystemFootnote />}
                </>
            )}
        </Sheet>
    );
};

export default HifiSignalPathPanel;
