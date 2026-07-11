import React from 'react';
import { motion } from 'framer-motion';
import {
    AlertCircle,
    AppWindow,
    Check,
    Cpu,
    Download,
    ExternalLink,
    EyeOff,
    Globe,
    KeyRound,
    Loader2,
    Minimize2,
    Monitor,
    RefreshCw,
    ShieldAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../../types';

// src/components/modal/settings/DesktopSettingsSubview.tsx
// Desktop-only tray, update, and AI settings separated from the global settings modal.

type ElectronSettingsState = {
    GEMINI_API_KEY: string;
    OPENAI_API_KEY: string;
    OPENAI_API_URL: string;
    OPENAI_API_MODEL: string;
    AI_PROVIDER: string;
    USE_SYSTEM_PROXY_FOR_AI: boolean;
    ENABLE_UPDATE_CHECK: boolean;
    ENABLE_AUTO_UPDATE: boolean;
    STAGE_MODE_SOURCE: string;
    DISCORD_RICH_PRESENCE_ENABLED: boolean;
};

export type DesktopSettingsChrome = {
    borderColor: string;
    isDaylight: boolean;
    isElectron: boolean;
    settingsCardClass: string;
    settingsIconClass: string;
    successTextColor: string;
    theme?: Theme;
    toggleOffBackgroundClass: string;
};

export type DesktopSettingsPreferences = {
    hideTaskbarIcon: boolean;
    hideRemoteControlTaskbarIcon: boolean;
    minimizeToTray: boolean;
    onToggleHideTaskbarIcon: (enabled: boolean) => void;
    onToggleHideRemoteControlTaskbarIcon: (enabled: boolean) => void;
    onToggleMinimizeToTray: (enabled: boolean) => void;
    onToggleOpenPlayerOnLaunch: (enabled: boolean) => void;
    openPlayerOnLaunch: boolean;
};

export type DesktopSettingsModel = {
    canDownloadUpdate: boolean;
    canEnableAutoUpdate: boolean;
    electronSaveStatus: 'idle' | 'saving' | 'saved';
    electronSettings: ElectronSettingsState;
    onCheckForUpdates: () => Promise<void> | void;
    onDownloadUpdate: () => Promise<void> | void;
    onInstallUpdate: () => Promise<void> | void;
    onOpenChinaDownload: () => Promise<void> | void;
    onSaveElectronSettings: () => Promise<void> | void;
    onToggleAutoUpdate: () => Promise<void> | void;
    onToggleUpdateCheck: () => Promise<void> | void;
    setElectronSettings: React.Dispatch<React.SetStateAction<ElectronSettingsState>>;
    updateBadgeIcon: React.ReactNode;
    updateBadgeLabel: string;
    updateStatus: ElectronUpdateStatus | null;
};

type DesktopSettingsSubviewProps = {
    chrome: DesktopSettingsChrome;
    model: DesktopSettingsModel;
    preferences: DesktopSettingsPreferences;
};

const DesktopSettingsSubview: React.FC<DesktopSettingsSubviewProps> = ({
    chrome,
    model,
    preferences,
}) => {
    const {
        borderColor,
        isDaylight,
        isElectron,
        settingsCardClass,
        settingsIconClass,
        successTextColor,
        theme,
        toggleOffBackgroundClass,
    } = chrome;
    const {
        hideTaskbarIcon,
        hideRemoteControlTaskbarIcon,
        minimizeToTray,
        onToggleHideTaskbarIcon,
        onToggleHideRemoteControlTaskbarIcon,
        onToggleMinimizeToTray,
        onToggleOpenPlayerOnLaunch,
        openPlayerOnLaunch,
    } = preferences;
    const {
        canDownloadUpdate,
        canEnableAutoUpdate,
        electronSaveStatus,
        electronSettings,
        onCheckForUpdates,
        onDownloadUpdate,
        onInstallUpdate,
        onOpenChinaDownload,
        onSaveElectronSettings,
        onToggleAutoUpdate,
        onToggleUpdateCheck,
        setElectronSettings,
        updateBadgeIcon,
        updateBadgeLabel,
        updateStatus,
    } = model;
    const { t } = useTranslation();

    if (!isElectron) {
        return null;
    }

    const renderToggle = (checked: boolean, onChange: () => void, disabled?: boolean) => (
        <button
            type="button"
            onClick={onChange}
            disabled={disabled}
            className={`w-12 h-6 rounded-full p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${checked ? '' : toggleOffBackgroundClass}`}
            style={{ backgroundColor: checked ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
        >
            <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-6' : 'translate-x-0'}`} />
        </button>
    );

    return (
        <>
            <section className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest mb-3 flex items-center gap-2 opacity-60" style={{ color: 'var(--text-secondary)' }}>
                    <Monitor size={14} className="opacity-70" /> {t('options.desktopTrayBehavior')}
                </h3>
                <div className={`border rounded-2xl overflow-hidden ${borderColor} ${settingsCardClass}`}>
                    <div className={`p-4 bg-black/[0.04] dark:bg-white/[0.02] border-b ${borderColor}`}>
                        <p className="text-xs opacity-60 leading-relaxed text-left" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.desktopTrayBehaviorDesc')}
                        </p>
                    </div>

                    <div className={`flex items-center justify-between p-4 gap-4 hover:bg-black/[0.01] dark:hover:bg-white/[0.01] transition-colors border-b ${borderColor}`}>
                        <div className="flex items-start gap-3 min-w-0">
                            <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${settingsIconClass}`} style={{ color: 'var(--text-primary)' }}>
                                <Minimize2 size={16} />
                            </div>
                            <div className="space-y-0.5 text-left">
                                <h4 className="text-sm font-semibold leading-none" style={{ color: 'var(--text-primary)' }}>
                                    {t('options.minimizeToTray')}
                                </h4>
                                <p className="text-xs opacity-50 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                    点击最小化时，应用将隐藏至系统托盘。
                                </p>
                            </div>
                        </div>
                        {renderToggle(minimizeToTray, () => onToggleMinimizeToTray(!minimizeToTray))}
                    </div>

                    <div className={`flex items-center justify-between p-4 gap-4 hover:bg-black/[0.01] dark:hover:bg-white/[0.01] transition-colors border-b ${borderColor}`}>
                        <div className="flex items-start gap-3 min-w-0">
                            <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${settingsIconClass}`} style={{ color: 'var(--text-primary)' }}>
                                <AppWindow size={16} />
                            </div>
                            <div className="space-y-0.5 text-left">
                                <h4 className="text-sm font-semibold leading-none" style={{ color: 'var(--text-primary)' }}>
                                    {t('options.openPlayerOnLaunch')}
                                </h4>
                                <p className="text-xs opacity-50 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                    应用启动时自动开启全屏/大屏歌词播放界面，无需手动点击。
                                </p>
                            </div>
                        </div>
                        {renderToggle(openPlayerOnLaunch, () => onToggleOpenPlayerOnLaunch(!openPlayerOnLaunch))}
                    </div>

                    <div className={`flex items-center justify-between p-4 gap-4 hover:bg-black/[0.01] dark:hover:bg-white/[0.01] transition-colors border-b ${borderColor}`}>
                        <div className="flex items-start gap-3 min-w-0">
                            <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${settingsIconClass}`} style={{ color: 'var(--text-primary)' }}>
                                <EyeOff size={16} />
                            </div>
                            <div className="space-y-0.5 text-left">
                                <h4 className="text-sm font-semibold leading-none" style={{ color: 'var(--text-primary)' }}>
                                    {t('options.hideTaskbarIcon')}
                                </h4>
                                <p className="text-xs opacity-50 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                    即使主窗口处于打开状态，也不在系统任务栏显示应用，最大程度减少干扰。
                                </p>
                            </div>
                        </div>
                        {renderToggle(hideTaskbarIcon, () => onToggleHideTaskbarIcon(!hideTaskbarIcon))}
                    </div>
                    <div className="flex items-center justify-between p-4 gap-4 hover:bg-black/[0.01] dark:hover:bg-white/[0.01] transition-colors">
                        <div className="flex items-start gap-3 min-w-0">
                            <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${settingsIconClass}`} style={{ color: 'var(--text-primary)' }}>
                                <EyeOff size={16} />
                            </div>
                            <div className="space-y-0.5 text-left">
                                <h4 className="text-sm font-semibold leading-none" style={{ color: 'var(--text-primary)' }}>
                                    {t('options.hideRemoteControlTaskbarIcon')}
                                </h4>
                                <p className="text-xs opacity-50 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.hideRemoteControlTaskbarIconDesc')}
                                </p>
                            </div>
                        </div>
                        {renderToggle(hideRemoteControlTaskbarIcon, () => onToggleHideRemoteControlTaskbarIcon(!hideRemoteControlTaskbarIcon))}
                    </div>
                </div>

                {hideTaskbarIcon && (
                    <motion.div
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`flex items-start gap-3 p-3.5 rounded-2xl border text-xs leading-relaxed ${
                            isDaylight
                                ? 'bg-amber-500/10 border-amber-500/20 text-amber-800'
                                : 'bg-amber-500/8 border-amber-500/15 text-amber-200'
                        }`}
                    >
                        <ShieldAlert size={16} className="shrink-0 mt-0.5" />
                        <div className="space-y-0.5 text-left">
                            <span className="font-semibold">重要提示：</span>
                            <span>隐藏任务栏图标后，应用只会在系统托盘显示。如需找回主窗口，请双击或右键点击托盘中的 Folia 图标。建议同时配合启用“最小化到托盘”。</span>
                        </div>
                    </motion.div>
                )}
            </section>

            <section className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest mb-3 flex items-center justify-between gap-3 opacity-60" style={{ color: 'var(--text-secondary)' }}>
                    <span className="flex items-center gap-2">
                        <RefreshCw size={14} className="opacity-70" /> {t('options.updateCheck') || 'Update Check'}
                    </span>
                    <button
                        type="button"
                        onClick={onCheckForUpdates}
                        disabled={!electronSettings.ENABLE_UPDATE_CHECK || updateStatus?.status === 'checking'}
                        className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium transition-all hover:bg-white/10 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                        style={{ color: 'var(--text-primary)' }}
                    >
                        {updateBadgeIcon}
                        <span>{updateBadgeLabel}</span>
                    </button>
                </h3>

                <div className={`border rounded-2xl overflow-hidden ${borderColor} ${settingsCardClass}`}>
                    <div className={`flex items-center justify-between p-4 gap-4 hover:bg-black/[0.01] dark:hover:bg-white/[0.01] transition-colors border-b ${borderColor}`}>
                        <div className="flex items-start gap-3 min-w-0">
                            <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${settingsIconClass}`} style={{ color: 'var(--text-primary)' }}>
                                <Globe size={16} />
                            </div>
                            <div className="space-y-0.5 text-left">
                                <h4 className="text-sm font-semibold leading-none" style={{ color: 'var(--text-primary)' }}>
                                    {t('options.enableUpdateCheck') || 'Enable Update Check'}
                                </h4>
                                <p className="text-xs opacity-50 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.enableUpdateCheckDesc') || 'Check GitHub releases through the system proxy when the desktop app starts.'}
                                </p>
                            </div>
                        </div>
                        {renderToggle(electronSettings.ENABLE_UPDATE_CHECK, onToggleUpdateCheck)}
                    </div>

                    <div className="flex items-center justify-between p-4 gap-4 hover:bg-black/[0.01] dark:hover:bg-white/[0.01] transition-colors">
                        <div className="flex items-start gap-3 min-w-0">
                            <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${settingsIconClass}`} style={{ color: 'var(--text-primary)' }}>
                                <Download size={16} />
                            </div>
                            <div className="space-y-0.5 text-left">
                                <h4 className="text-sm font-semibold leading-none" style={{ color: 'var(--text-primary)' }}>
                                    {t('options.enableAutoUpdate') || 'Enable Auto Update'}
                                </h4>
                                <p className="text-xs opacity-50 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.enableAutoUpdateDesc') || 'Automatically download updates after a new version is found.'}
                                </p>
                            </div>
                        </div>
                        {renderToggle(electronSettings.ENABLE_AUTO_UPDATE, onToggleAutoUpdate, !canEnableAutoUpdate)}
                    </div>
                </div>

                <div className="text-[10px] opacity-45 px-1 leading-relaxed text-left" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.autoUpdateGithubNotice') || 'Auto update needs access to GitHub; if the network is unstable, keep a system proxy enabled.'}
                </div>

                {updateStatus?.availableVersion && (
                    <div className={`p-4 rounded-2xl border ${borderColor} ${settingsCardClass} space-y-3`}>
                        <div className="flex items-center gap-2">
                            <AlertCircle size={16} className="text-amber-500 shrink-0" />
                            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                {t('options.newVersionFound', { version: updateStatus.availableVersion })}
                            </span>
                        </div>

                        {/* 自动更新时的提示 */}
                        {electronSettings.ENABLE_AUTO_UPDATE && updateStatus.status === 'downloading' && (
                            <div className="text-xs text-left text-zinc-400">
                                {t('options.autoUpdateGithubNotice')}
                            </div>
                        )}

                        {/* 下载进度条 */}
                        {updateStatus.status === 'downloading' && updateStatus.downloadProgress && (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between text-xs font-mono">
                                    <span className="opacity-60 text-left" style={{ color: 'var(--text-secondary)' }}>
                                        {t('options.downloadUpdate')}
                                    </span>
                                    <span className="font-semibold text-emerald-400">
                                        {Math.round(updateStatus.downloadProgress.percent)}%
                                    </span>
                                </div>
                                <div className="w-full h-1.5 rounded-full overflow-hidden bg-white/10">
                                    <div
                                        className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-[width] duration-300 ease-out"
                                        style={{ width: `${updateStatus.downloadProgress.percent}%` }}
                                    />
                                </div>
                                {updateStatus.downloadProgress.transferred !== undefined && updateStatus.downloadProgress.total !== undefined && (
                                    <div className="text-[10px] opacity-40 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>
                                        {(updateStatus.downloadProgress.transferred / 1024 / 1024).toFixed(1)} MB / {(updateStatus.downloadProgress.total / 1024 / 1024).toFixed(1)} MB
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => window.electron?.openUpdateReleasePage(updateStatus.availableVersion)}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-3.5 py-2 text-xs font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]"
                                style={{ color: 'var(--text-primary)' }}
                            >
                                <ExternalLink size={14} />
                                {t('options.openReleasePage') || 'Open Release Page'}
                            </button>
                            <button
                                type="button"
                                onClick={onOpenChinaDownload}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-3.5 py-2 text-xs font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]"
                                style={{ color: 'var(--text-primary)' }}
                            >
                                <ExternalLink size={14} />
                                {t('options.downloadChina')}
                            </button>
                            {!electronSettings.ENABLE_AUTO_UPDATE && (
                                <button
                                    type="button"
                                    onClick={onDownloadUpdate}
                                    disabled={!canDownloadUpdate}
                                    className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 hover:bg-white/15 px-3.5 py-2 text-xs font-semibold transition-all hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    <Download size={14} />
                                    {t('options.downloadUpdate') || 'Download Update'}
                                </button>
                            )}
                            {updateStatus.status === 'downloaded' && (
                                <button
                                    type="button"
                                    onClick={onInstallUpdate}
                                    className="inline-flex items-center gap-1.5 rounded-xl bg-green-500/20 hover:bg-green-500/30 text-green-400 px-3.5 py-2 text-xs font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]"
                                >
                                    <RefreshCw size={14} className="animate-spin-slow" />
                                    {t('options.restartToInstallUpdate') || 'Restart to Install'}
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </section>

            <section className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest mb-3 flex items-center gap-2 opacity-60" style={{ color: 'var(--text-secondary)' }}>
                    <Cpu size={14} className="opacity-70" /> {t('options.electronSettings') || 'Desktop App Settings'}
                </h3>

                <div className={`border rounded-2xl p-5 ${borderColor} ${settingsCardClass} space-y-5`}>
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="space-y-0.5 text-left">
                            <label className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                {t('options.aiProvider') || 'AI Provider'}
                            </label>
                            <p className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                选择生成智能歌词主题效果的 AI 服务商。
                            </p>
                        </div>

                        <div className="flex bg-black/15 dark:bg-white/5 rounded-xl border border-white/5 p-1 shrink-0">
                            <button
                                type="button"
                                onClick={() => setElectronSettings({ ...electronSettings, AI_PROVIDER: 'gemini' })}
                                className={`px-4.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                                    electronSettings.AI_PROVIDER !== 'openai'
                                        ? (isDaylight ? 'bg-white text-zinc-900 shadow-sm' : 'bg-white/10 text-white shadow-sm')
                                        : 'opacity-50 hover:opacity-100 text-zinc-400 hover:text-zinc-200'
                                }`}
                                style={{ color: electronSettings.AI_PROVIDER !== 'gemini' ? 'var(--text-primary)' : undefined }}
                            >
                                Google Gemini
                            </button>
                            <button
                                type="button"
                                onClick={() => setElectronSettings({ ...electronSettings, AI_PROVIDER: 'openai' })}
                                className={`px-4.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                                    electronSettings.AI_PROVIDER === 'openai'
                                        ? (isDaylight ? 'bg-white text-zinc-900 shadow-sm' : 'bg-white/10 text-white shadow-sm')
                                        : 'opacity-50 hover:opacity-100 text-zinc-400 hover:text-zinc-200'
                                }`}
                                style={{ color: electronSettings.AI_PROVIDER === 'openai' ? 'var(--text-primary)' : undefined }}
                            >
                                OpenAI Compatible
                            </button>
                        </div>
                    </div>

                    <div className="border-t border-white/5 pt-4 space-y-4">
                        {electronSettings.AI_PROVIDER !== 'openai' ? (
                            <div className="space-y-2 text-left">
                                <div className="flex items-center gap-1.5">
                                    <KeyRound size={14} className="opacity-60" style={{ color: 'var(--text-primary)' }} />
                                    <label className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                                        {t('options.geminiApiKey') || 'Gemini API Key'}
                                    </label>
                                </div>
                                <input
                                    type="password"
                                    value={electronSettings.GEMINI_API_KEY || ''}
                                    onChange={(e) => setElectronSettings({ ...electronSettings, GEMINI_API_KEY: e.target.value })}
                                    placeholder="AI Theme Generation Key"
                                    className="w-full px-3.5 py-2.5 bg-black/10 dark:bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-zinc-500 dark:focus:border-white/30 focus:ring-2 focus:ring-zinc-500/10 transition-all leading-normal"
                                    style={{ color: 'var(--text-primary)' }}
                                />
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="space-y-2 text-left">
                                    <div className="flex items-center gap-1.5">
                                        <Globe size={14} className="opacity-60" style={{ color: 'var(--text-primary)' }} />
                                        <label className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                                            {t('options.openaiApiUrl') || 'OpenAI API URL'}
                                        </label>
                                    </div>
                                    <input
                                        type="text"
                                        value={electronSettings.OPENAI_API_URL || ''}
                                        onChange={(e) => setElectronSettings({ ...electronSettings, OPENAI_API_URL: e.target.value })}
                                        placeholder="https://api.openai.com/v1 or https://api.deepseek.com"
                                        className="w-full px-3.5 py-2.5 bg-black/10 dark:bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-zinc-500 dark:focus:border-white/30 focus:ring-2 focus:ring-zinc-500/10 transition-all leading-normal"
                                        style={{ color: 'var(--text-primary)' }}
                                    />
                                </div>

                                <div className="space-y-2 text-left">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-1.5">
                                            <Cpu size={14} className="opacity-60" style={{ color: 'var(--text-primary)' }} />
                                            <label className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                                                {t('options.openaiApiModel') || 'OpenAI Model'}
                                            </label>
                                        </div>
                                    </div>
                                    <input
                                        type="text"
                                        value={electronSettings.OPENAI_API_MODEL || ''}
                                        onChange={(e) => setElectronSettings({ ...electronSettings, OPENAI_API_MODEL: e.target.value })}
                                        placeholder="gpt-4o / gpt-4.1-mini / deepseek-v4-flash"
                                        className="w-full px-3.5 py-2.5 bg-black/10 dark:bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-zinc-500 dark:focus:border-white/30 focus:ring-2 focus:ring-zinc-500/10 transition-all leading-normal"
                                        style={{ color: 'var(--text-primary)' }}
                                    />
                                    <p className="text-[10px] opacity-40 leading-relaxed px-1" style={{ color: 'var(--text-secondary)' }}>
                                        {t('options.openaiApiModelDesc') || 'Required for many OpenAI-compatible providers. DeepSeek models like deepseek-v4-flash must be filled explicitly if auto-detection does not apply.'}
                                    </p>
                                </div>

                                <div className="space-y-2 text-left">
                                    <div className="flex items-center gap-1.5">
                                        <KeyRound size={14} className="opacity-60" style={{ color: 'var(--text-primary)' }} />
                                        <label className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                                            {t('options.openaiApiKey') || 'OpenAI API Key'}
                                        </label>
                                    </div>
                                    <input
                                        type="password"
                                        value={electronSettings.OPENAI_API_KEY || ''}
                                        onChange={(e) => setElectronSettings({ ...electronSettings, OPENAI_API_KEY: e.target.value })}
                                        placeholder="sk-..."
                                        className="w-full px-3.5 py-2.5 bg-black/10 dark:bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-zinc-500 dark:focus:border-white/30 focus:ring-2 focus:ring-zinc-500/10 transition-all leading-normal"
                                        style={{ color: 'var(--text-primary)' }}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center justify-between pt-4 border-t border-white/5 gap-4">
                        <div className="space-y-0.5 text-left">
                            <label className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                {t('options.useSystemProxyAI') || 'Use System Proxy for AI'}
                            </label>
                            <p className="text-xs opacity-50 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.useSystemProxyAIDesc') || 'Route strictly AI requests through system proxy.'}
                            </p>
                        </div>
                        {renderToggle(electronSettings.USE_SYSTEM_PROXY_FOR_AI, () => setElectronSettings({ ...electronSettings, USE_SYSTEM_PROXY_FOR_AI: !electronSettings.USE_SYSTEM_PROXY_FOR_AI }))}
                    </div>

                    <div className="flex items-center justify-between pt-4 border-t border-white/5 gap-4">
                        <span className="text-[10px] opacity-40 leading-relaxed max-w-[280px] text-left" style={{ color: 'var(--text-secondary)' }}>
                            {electronSettings.AI_PROVIDER !== 'openai'
                                ? (t('options.geminiApiKeyDesc') || 'Netease API backend runs locally.')
                                : '使用兼容 OpenAI 格式的其它大模型接口。'}
                        </span>
                        <button
                            type="button"
                            onClick={onSaveElectronSettings}
                            disabled={electronSaveStatus === 'saving'}
                            className="px-6 py-2.5 bg-zinc-800 hover:bg-zinc-700 dark:bg-white/10 dark:hover:bg-white/15 active:scale-95 disabled:scale-100 disabled:opacity-50 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm min-w-[80px]"
                            style={{ color: 'var(--text-primary)' }}
                        >
                            {electronSaveStatus === 'saved' ? (
                                <>
                                    <Check size={14} className={successTextColor} />
                                    <span className={successTextColor}>已保存</span>
                                </>
                            ) : electronSaveStatus === 'saving' ? (
                                <>
                                    <Loader2 size={14} className="animate-spin" />
                                    <span>正在保存...</span>
                                </>
                            ) : (
                                <span>{t('options.save') || 'Save'}</span>
                            )}
                        </button>
                    </div>
                </div>
            </section>
        </>
    );
};

export default DesktopSettingsSubview;
