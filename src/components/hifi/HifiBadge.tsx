import React from 'react';
import { BadgeCheck, BadgeInfo, CircleHelp, Merge, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { HifiSignalVerdict } from '../../types/hifi';
import { openHifiSignalPath } from './hifiPanelStore';
import { formatHifiBadge, isValuePreservingPath, signalPathTone, type HifiVerdictTone } from './hifiSignalText';
import { useHifiSignalPath, useHifiTrackDeferred } from './useHifiSignalPath';

// src/components/hifi/HifiBadge.tsx
// 播放胶囊进度条旁的 HiFi 小牌子：结论加输出格式，如「HiFi · 原生直通 · 96 kHz / 24 bit」，点一下打开信号链路面板。
// 只在 HiFi 路线上出现。胶囊在面板外面，--st-* 到不了这里，颜色只用根变量。

type HifiBadgeProps = {
    isDaylight?: boolean;
    disabled?: boolean;
};

// 日间胶囊是半透明白底，底色要深一点才看得出。
const TONE_CLASS: Record<HifiVerdictTone, { day: string; night: string }> = {
    accent: {
        day: 'text-[color:var(--text-accent)] bg-[color-mix(in_srgb,var(--text-accent)_18%,transparent)] enabled:hover:bg-[color-mix(in_srgb,var(--text-accent)_26%,transparent)]',
        night: 'text-[color:var(--text-accent)] bg-[color-mix(in_srgb,var(--text-accent)_14%,transparent)] enabled:hover:bg-[color-mix(in_srgb,var(--text-accent)_22%,transparent)]',
    },
    muted: {
        day: 'text-[color:var(--text-secondary)] bg-[color-mix(in_srgb,var(--text-secondary)_14%,transparent)] enabled:hover:bg-[color-mix(in_srgb,var(--text-secondary)_22%,transparent)]',
        night: 'text-[color:var(--text-secondary)] bg-[color-mix(in_srgb,var(--text-secondary)_12%,transparent)] enabled:hover:bg-[color-mix(in_srgb,var(--text-secondary)_20%,transparent)]',
    },
};

/**
 * 最窄的小牌子只写 HiFi，结论靠这个图标（和信号链路面板顶上的同一套）。采样率直通的图标和逐位直通不同：
 * 那只是 PipeWire 报的采样率对得上，不是逐位直通。已转换但只有数值不变的格式转换（isValuePreservingPath）用同一个提示图标，不用警告。颜色见 signalPathTone：PipeWire 那一级每项都过时和逐位直通同为强调色，
 * 有一项没过（滤波器、音量、别的流、声道）就用次要色。
 */
const VERDICT_ICON: Record<HifiSignalVerdict, LucideIcon> = {
    'bit-perfect': BadgeCheck,
    dop: BadgeCheck,
    'rate-passthrough': BadgeInfo,
    converted: TriangleAlert,
    'shared-mixer': Merge,
    unknown: CircleHelp,
};

/**
 * 小牌子按所在那一行（@container）有多宽换长短，不看窗口宽度：胶囊最宽也就 32rem，窗口再宽这一行也只有三百来像素。
 * 不到 24rem 只写图标加 HiFi，24–28rem 写「HiFi · 结论」，28rem 起才带上格式。读屏软件总是听到全称。
 */
const HifiBadge: React.FC<HifiBadgeProps> = ({ isDaylight = false, disabled = false }) => {
    const { t, i18n } = useTranslation();
    const path = useHifiSignalPath();
    const deferred = useHifiTrackDeferred();

    if (!path) {
        return null;
    }

    const { text, shortText, chipText } = formatHifiBadge(path, t, i18n.language, { deferred });
    const tone = TONE_CLASS[signalPathTone(path)][isDaylight ? 'day' : 'night'];
    // 还没载入的曲目没有结论可画。
    const Icon = deferred ? null : isValuePreservingPath(path) ? BadgeInfo : VERDICT_ICON[path.verdict];

    return (
        <button
            type="button"
            aria-haspopup="dialog"
            aria-label={t('hifi.player.badgeAria', { badge: text })}
            disabled={disabled}
            onClick={(event) => {
                // 胶囊本身点一下会去播放页。
                event.stopPropagation();
                openHifiSignalPath();
            }}
            className={`flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-semibold leading-4 tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${tone}`}
        >
            {Icon && <Icon size={11} strokeWidth={2.4} aria-hidden className="shrink-0 @sm:hidden" />}
            <span className="truncate @sm:hidden">{chipText}</span>
            <span className="hidden truncate @sm:block @md:hidden">{shortText}</span>
            <span className="hidden truncate @md:block">{text}</span>
        </button>
    );
};

type HifiProgressRowProps = {
    /** 这一行在胶囊网格里的位置，和 Web 路线那一行一样。 */
    className: string;
    isDaylight?: boolean;
    disabled?: boolean;
    /** 进度条（两头的时间加中间的条）。 */
    children: React.ReactNode;
};

/**
 * HiFi 路线上胶囊的进度行：进度条在前、小牌子在后。这一行是小牌子量宽度的容器；进度条至少留 10rem（两头的时间
 * 共 88px，条本身至少 72px），小牌子在更窄的地方自己截断，挤不掉进度条。
 */
export const HifiProgressRow: React.FC<HifiProgressRowProps> = ({ className, isDaylight, disabled, children }) => (
    <div className={`${className} @container flex items-center gap-2`}>
        <div className="min-w-40 flex-1">{children}</div>
        <HifiBadge isDaylight={isDaylight} disabled={disabled} />
    </div>
);

export default HifiBadge;
