import type { TFunction } from 'i18next';
import type { HifiSignalFormat, HifiSignalPath, HifiSignalStageId, HifiSystemCheck, HifiSystemCheckId } from '../../types/hifi';
import { OWN_STREAM_MARK, SYSTEM_DEVICE_UNKNOWN, isSystemDeviceUnknown, listsOwnStream } from '../../services/hifi/signalPathSystem';
import { formatChannels, formatSampleRate } from './hifiSignalText';

// src/components/hifi/hifiSystemText.ts
// 信号链路面板里 PipeWire 那一级（Linux）的文字：每项检查一行，PipeWire 没把设备切到 mpv 的采样率时按报来的数据推的原因，
// 和要放进 PipeWire 配置的那一行（issue #835）或要在终端运行的命令。这些只复述 PipeWire 报的状态，从不说逐位直通。

const stageFormat = (path: HifiSignalPath, id: HifiSignalStageId): HifiSignalFormat | null => (
    path.stages.find(stage => stage.id === id)?.format ?? null
);

const findCheck = (path: HifiSignalPath, id: HifiSystemCheckId): HifiSystemCheck | null => (
    path.system?.checks.find(check => check.id === id) ?? null
);

/** 一路 Folia 自己的流的名字：本来就叫 Folia 的（Chromium 报的是应用名）照写，别的名字后面注明来自 Folia。 */
const ownStreamName = (name: string, t: TFunction) => (/folia/i.test(name) ? name : t('hifi.signal.system.ownStream', { name }));

/** 「同设备上别的流」那串名字：Folia 自己的流（signalPathSystem 在名字后面标了 OWN_STREAM_MARK）换成翻译过的说法。 */
const streamNames = (detail: string | null, t: TFunction): string => (detail ?? '')
    .split(', ')
    .filter(Boolean)
    .map(name => (name.endsWith(OWN_STREAM_MARK) ? ownStreamName(name.slice(0, -OWN_STREAM_MARK.length), t) : name))
    .join(', ');

/**
 * PipeWire 那一级的一项检查写成一行，ok 时说没问题的那一面，不 ok 时说它改了什么。
 * 采样率和声道用 mpv 交出的（输出级）和设备的（system 级）格式写，别的项把检查里不翻译的补充（节点名、百分比）嵌进去。
 */
export const describeSystemCheck = (check: HifiSystemCheck, path: HifiSignalPath, t: TFunction, locale: string): string => {
    const output = stageFormat(path, 'output');
    const device = stageFormat(path, 'system');
    switch (check.id) {
        case 'rate': {
            // 链路停在虚拟设备上：说到那里为止，不说设备以什么采样率运行。
            if (check.detail === SYSTEM_DEVICE_UNKNOWN) {
                return t('hifi.signal.system.rateVirtual', { name: path.stages.find(stage => stage.id === 'system')?.detail ?? '' });
            }
            const from = formatSampleRate(output?.sampleRate, t, locale);
            const to = formatSampleRate(path.system?.deviceRate ?? device?.sampleRate, t, locale);
            if (check.ok) return t('hifi.signal.system.rateOk', { rate: to ?? from ?? '' });
            return to && from ? t('hifi.signal.system.rateWarn', { from, to }) : t('hifi.signal.system.rateUnknown');
        }
        case 'filters':
            return check.ok ? t('hifi.signal.system.filtersOk') : t('hifi.signal.system.filtersWarn', { names: check.detail ?? '' });
        case 'streamVolume':
            return check.ok ? t('hifi.signal.system.streamVolumeOk') : t('hifi.signal.system.streamVolumeWarn', { volume: check.detail ?? '' });
        case 'deviceVolume':
            return check.ok ? t('hifi.signal.system.deviceVolumeOk') : t('hifi.signal.system.deviceVolumeWarn', { volume: check.detail ?? '' });
        case 'otherStreams':
            return check.ok ? t('hifi.signal.system.otherStreamsOk') : t('hifi.signal.system.otherStreamsWarn', { names: streamNames(check.detail, t) });
        case 'channels': {
            if (check.ok) return t('hifi.signal.system.channelsOk');
            const from = formatChannels(output?.channels, t);
            const to = formatChannels(device?.channels, t);
            return from && to ? t('hifi.signal.system.channelsWarn', { from, to }) : t('hifi.signal.system.channelsWarnPlain');
        }
    }
};

/** issue #835 里那份 PipeWire 配置要列的采样率；mpv 交出的不在里面时（DSD 转出的 352.8 kHz 这类）补上。 */
const SNIPPET_RATES = [44100, 48000, 88200, 96000, 176400, 192000];

/** 放进 ~/.config/pipewire/pipewire.conf.d/ 的那一行，让 PipeWire 可以把设备切到这些采样率。 */
export const pipewireAllowedRatesSnippet = (rate: number | null = null): string => {
    const rates = typeof rate === 'number' && Number.isFinite(rate) && rate > 0 && !SNIPPET_RATES.includes(rate) ? [...SNIPPET_RATES, rate].sort((a, b) => a - b) : SNIPPET_RATES;
    return `context.properties = { default.clock.allowed-rates = [ ${rates.join(' ')} ] }`;
};

/** 取消 clock.force-rate 的命令：0 表示不强制。 */
export const PIPEWIRE_UNFORCE_RATE_COMMAND = 'pw-metadata -n settings 0 clock.force-rate 0';

export type HifiSystemHint = {
    /**
     * forced：clock.force-rate 把采样率固定在了别的值上；notAllowed：allowed-rates 里没有 mpv 的采样率；
     * busy：允许，但设备上还有别的流在放（PipeWire 只在设备空闲时切）；noSwitch：看不出原因（允许、也没别的流，
     * 或者读不到 allowed-rates）。
     */
    id: 'forced' | 'notAllowed' | 'busy' | 'noSwitch';
    text: string;
    /** 要用户放进 PipeWire 配置的那一行；没有时为 null。 */
    snippet: string | null;
    /** 要用户在终端运行的命令；没有时为 null。 */
    command: string | null;
};

/**
 * PipeWire 没把设备切到 mpv 的采样率时，从报来的数据推一个最可能的原因和办法。采样率对上了、或者没有探测时为空。
 * 只给一条：先是 clock.force-rate 强制了别的采样率（不取消它别的都没用），再是配置不允许，再是别的流占着设备，
 * 最后是看不出原因。链路停在虚拟设备上时只看 force-rate：别的几条要看设备，而设备看不见。
 */
export const systemRateHints = (path: HifiSignalPath, t: TFunction, locale: string): HifiSystemHint[] => {
    const report = path.system;
    const rateCheck = report ? findCheck(path, 'rate') : null;
    if (!report || !rateCheck || rateCheck.ok) return [];
    const mpvRate = stageFormat(path, 'output')?.sampleRate ?? null;
    const rate = formatSampleRate(mpvRate, t, locale) ?? '';
    if (mpvRate !== null && report.forceRate !== null && report.forceRate !== mpvRate) {
        return [{
            id: 'forced',
            text: t('hifi.signal.system.hintForced', { forced: formatSampleRate(report.forceRate, t, locale) ?? '', rate }),
            snippet: null,
            command: PIPEWIRE_UNFORCE_RATE_COMMAND,
        }];
    }
    // 链路停在虚拟设备上，或 PipeWire 没报设备的采样率：不知道设备以什么采样率运行，不猜原因。
    if (isSystemDeviceUnknown(report) || report.deviceRate === null) return [];
    if (mpvRate !== null && report.allowedRates.length > 0 && !report.allowedRates.includes(mpvRate)) {
        return [{ id: 'notAllowed', text: t('hifi.signal.system.hintNotAllowed', { rate }), snippet: pipewireAllowedRatesSnippet(mpvRate), command: null }];
    }
    const others = findCheck(path, 'otherStreams');
    if (others && !others.ok) {
        const busy = t('hifi.signal.system.hintBusy', { names: streamNames(others.detail, t) });
        return [{
            id: 'busy',
            text: listsOwnStream(others.detail)
                ? t('hifi.signal.system.hintJoin', { first: busy, second: t('hifi.signal.system.hintBusyOwn') })
                : busy,
            snippet: null,
            command: null,
        }];
    }
    return [{
        id: 'noSwitch',
        text: t('hifi.signal.system.hintNoSwitch', { rate }),
        // 读不到 allowed-rates 时不知道配置允不允许：把配置也给出来。
        snippet: report.allowedRates.length === 0 ? pipewireAllowedRatesSnippet(mpvRate) : null,
        command: null,
    }];
};
