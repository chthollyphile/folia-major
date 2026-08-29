import React, { useSyncExternalStore } from 'react';
import { Activity, FolderOpen, ScrollText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../../types';
import {
    getConsoleLogEntries,
    isConsoleCaptureEnabled,
    setConsoleCaptureEnabled,
    subscribeToConsoleLog,
} from '../../../utils/consoleLogBuffer';
import {
    getDebugModuleSnapshot,
    openDebugLogsFolder,
    setDebugModuleState,
    subscribeToDebugModule,
    type DebugLogMode,
} from '../../../services/debug/debugModule';
import ConsoleLogPanel from '../../shared/ConsoleLogPanel';

// src/components/modal/settings/DeveloperSettingsSubview.tsx
// The debug module's switches: what is recorded, how its file opens, and where it lands.
//
// The buffer exists because the packaged desktop build has no console: DevTools only open under
// ELECTRON_DEV and the window is frameless, so there is no menu to reach them from. The two
// shortcuts are printed here for the same reason - a chord nobody wrote down is a chord nobody has.
//
// Two recordings, two files, two switches, and they are kept apart deliberately: runtime lines and
// a memory curve are read to answer different questions, and at one sample every couple of seconds
// the curve would bury the lines in a file they shared.

type DeveloperSettingsSubviewProps = {
    isDaylight: boolean;
    settingsCardClass: string;
    theme?: Theme;
    toggleOffBackgroundClass: string;
};

const Switch: React.FC<{
    isOn: boolean;
    onToggle: () => void;
    theme?: Theme;
    toggleOffBackgroundClass: string;
}> = ({ isOn, onToggle, theme, toggleOffBackgroundClass }) => (
    <button
        type="button"
        onClick={onToggle}
        aria-pressed={isOn}
        className={`w-12 h-6 shrink-0 rounded-full p-1 transition-colors ${!isOn ? toggleOffBackgroundClass : ''}`}
        style={{ backgroundColor: isOn ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
    >
        <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${isOn ? 'translate-x-6' : 'translate-x-0'}`} />
    </button>
);

/** Append or overwrite, as two buttons rather than a dropdown - there are only ever two. */
const ModeChoice: React.FC<{
    value: DebugLogMode;
    onChange: (mode: DebugLogMode) => void;
    isDaylight: boolean;
    disabled?: boolean;
}> = ({ value, onChange, isDaylight, disabled }) => {
    const { t } = useTranslation();
    const options: Array<{ mode: DebugLogMode; label: string }> = [
        { mode: 'append', label: t('options.debugLogModeAppend') || 'Append' },
        { mode: 'overwrite', label: t('options.debugLogModeOverwrite') || 'Overwrite' },
    ];
    return (
        <div className={`flex gap-1.5 ${disabled ? 'pointer-events-none opacity-40' : ''}`}>
            {options.map(option => {
                const isActive = value === option.mode;
                return (
                    <button
                        key={option.mode}
                        type="button"
                        onClick={() => onChange(option.mode)}
                        className={`rounded-full border px-3 py-1 text-[11px] transition-colors ${isDaylight ? 'border-black/10 hover:bg-black/[0.05]' : 'border-white/10 hover:bg-white/[0.07]'} ${isActive ? (isDaylight ? 'bg-black/[0.08]' : 'bg-white/[0.12]') : 'opacity-55'}`}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
};

/** One line under a switch: what it writes, where, and a way to get to it. */
const FileRow: React.FC<{
    label: string;
    path: string | null;
    onOpen: () => void;
    isDaylight: boolean;
    children?: React.ReactNode;
}> = ({ label, path, onOpen, isDaylight, children }) => {
    const { t } = useTranslation();
    return (
        <div className={`rounded-xl border px-3 py-2.5 ${isDaylight ? 'border-black/10 bg-black/[0.03]' : 'border-white/10 bg-black/15'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] opacity-70" style={{ color: 'var(--text-secondary)' }}>{label}</span>
                {children}
            </div>
            <button
                type="button"
                onClick={onOpen}
                className="mt-1.5 flex w-full items-center gap-1.5 text-left text-[10px] opacity-45 transition-opacity hover:opacity-80"
                style={{ color: 'var(--text-secondary)' }}
            >
                <FolderOpen size={10} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{path || (t('options.debugLogsUnavailable') || 'Desktop app only')}</span>
            </button>
        </div>
    );
};

const DeveloperSettingsSubview: React.FC<DeveloperSettingsSubviewProps> = ({
    isDaylight,
    settingsCardClass,
    theme,
    toggleOffBackgroundClass,
}) => {
    const { t } = useTranslation();
    // Subscribed rather than read once: the switch clears the buffer, and the count beside it has
    // to answer for that immediately or it reads as the switch having done nothing.
    const entries = useSyncExternalStore(subscribeToConsoleLog, getConsoleLogEntries);
    // The SWITCH is subscribed too, and it has to be its own subscription. Read plainly, this line
    // re-rendered only when `entries` changed identity - which switching OFF does, because it
    // clears the buffer, and switching ON does not. So the toggle animated one way and froze the
    // other, on a switch that had in fact flipped. A derived value is not a subscription.
    const capturing = useSyncExternalStore(subscribeToConsoleLog, isConsoleCaptureEnabled);
    const debug = useSyncExternalStore(subscribeToDebugModule, getDebugModuleSnapshot);

    return (
        <div className="space-y-4">
            <div className={`rounded-2xl border p-4 space-y-4 ${settingsCardClass}`}>
                <div className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                        <div className="p-2 rounded-lg opacity-60 shrink-0">
                            <ScrollText size={14} />
                        </div>
                        <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                    {t('options.consoleLogCapture') || 'Session log'}
                                </span>
                                {/* The same log is a keystroke away on the player page, and nobody
                                    finds a chord that is never written down. */}
                                <kbd
                                    className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-normal tracking-wide ${isDaylight ? 'border-black/10 bg-black/[0.04]' : 'border-white/10 bg-white/[0.06]'}`}
                                    style={{ color: 'var(--text-secondary)' }}
                                >
                                    Alt+Shift+D
                                </kbd>
                            </div>
                            <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.consoleLogCaptureDesc')
                                    || 'Keep what the app logs while it runs, so a problem can be read back and handed over.'}
                            </div>
                        </div>
                    </div>
                    <Switch
                        isOn={capturing}
                        onToggle={() => setConsoleCaptureEnabled(!capturing)}
                        theme={theme}
                        toggleOffBackgroundClass={toggleOffBackgroundClass}
                    />
                </div>

                <FileRow
                    label={t('options.debugLogsToFile') || 'Save to file'}
                    path={debug.runtimeFile}
                    onOpen={() => void openDebugLogsFolder('runtime')}
                    isDaylight={isDaylight}
                >
                    <div className="flex items-center gap-3">
                        <ModeChoice
                            value={debug.runtimeLogMode}
                            onChange={mode => void setDebugModuleState({ runtimeLogMode: mode })}
                            isDaylight={isDaylight}
                            disabled={!debug.available || !debug.runtimeLogEnabled}
                        />
                        <Switch
                            isOn={debug.runtimeLogEnabled}
                            onToggle={() => void setDebugModuleState({ runtimeLogEnabled: !debug.runtimeLogEnabled })}
                            theme={theme}
                            toggleOffBackgroundClass={toggleOffBackgroundClass}
                        />
                    </div>
                </FileRow>

                {/* Rendered either way: the panel answers for the switch itself, so this page and
                    the Alt+Shift+D overlay cannot disagree about whether anything is being kept. */}
                <ConsoleLogPanel
                    isDaylight={isDaylight}
                    className={`rounded-xl border ${isDaylight ? 'border-black/10 bg-black/[0.03]' : 'border-white/10 bg-black/15'}`}
                    listMaxHeightClass="max-h-[22rem]"
                />
            </div>

            <div className={`rounded-2xl border p-4 space-y-4 ${settingsCardClass}`}>
                <div className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                        <div className="p-2 rounded-lg opacity-60 shrink-0">
                            <Activity size={14} />
                        </div>
                        <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                    {t('options.memoryMonitor') || 'Memory monitor'}
                                </span>
                                <kbd
                                    className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-normal tracking-wide ${isDaylight ? 'border-black/10 bg-black/[0.04]' : 'border-white/10 bg-white/[0.06]'}`}
                                    style={{ color: 'var(--text-secondary)' }}
                                >
                                    Alt+Shift+M
                                </kbd>
                            </div>
                            <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.memoryMonitorDesc') || 'Sample every process and record the curve.'}
                            </div>
                        </div>
                    </div>
                    <Switch
                        isOn={debug.memoryMonitorEnabled}
                        onToggle={() => void setDebugModuleState({ memoryMonitorEnabled: !debug.memoryMonitorEnabled })}
                        theme={theme}
                        toggleOffBackgroundClass={toggleOffBackgroundClass}
                    />
                </div>

                <FileRow
                    label={t('options.debugLogsToFile') || 'Save to file'}
                    path={debug.memoryFile}
                    onOpen={() => void openDebugLogsFolder('memory')}
                    isDaylight={isDaylight}
                >
                    <ModeChoice
                        value={debug.memoryLogMode}
                        onChange={mode => void setDebugModuleState({ memoryLogMode: mode })}
                        isDaylight={isDaylight}
                        disabled={!debug.available}
                    />
                </FileRow>

                <div className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${isDaylight ? 'border-black/10 bg-black/[0.03]' : 'border-white/10 bg-black/15'}`}>
                    <span className="text-[11px] opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {t('options.memoryMonitorInterval') || 'Interval'}
                    </span>
                    <div className="flex gap-1.5">
                        {[1000, 2000, 5000, 15000].map(interval => {
                            const isActive = debug.memoryIntervalMs === interval;
                            return (
                                <button
                                    key={interval}
                                    type="button"
                                    disabled={!debug.available}
                                    onClick={() => void setDebugModuleState({ memoryIntervalMs: interval })}
                                    className={`rounded-full border px-2.5 py-1 text-[11px] tabular-nums transition-colors disabled:opacity-30 ${isDaylight ? 'border-black/10 hover:bg-black/[0.05]' : 'border-white/10 hover:bg-white/[0.07]'} ${isActive ? (isDaylight ? 'bg-black/[0.08]' : 'bg-white/[0.12]') : 'opacity-55'}`}
                                >
                                    {`${interval / 1000}s`}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            <div className="text-[11px] leading-relaxed opacity-45" style={{ color: 'var(--text-secondary)' }}>
                {t('options.consoleLogConvention')
                    || 'Lines are grouped by the [Module] prefix they start with, so anything logged as console.log(\'[YourModule] …\') can be filtered on its own. See docs/client-logging.md.'}
                {' '}
                {entries.length > 0 ? `(${entries.length})` : null}
            </div>
        </div>
    );
};

export default DeveloperSettingsSubview;
