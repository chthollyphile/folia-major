import React, { useEffect, useState } from 'react';
import { Activity, AlertCircle, Check, Copy, Loader2, Server, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { NowPlayingConnectionStatus, StageSource, StageStatus, Theme } from '../../../types';
import type { NavidromeServerProfile } from '../../../types/navidrome';
import type { ObsBrowserSourceStatus } from '../../../types/obsBrowserSource';
import type { PlayerCapConnectionStatus } from '../../../types/playerCap';
import { CustomSelect } from '../../shared/CustomSelect';
import { buildCurrentObsUrl } from '../../../utils/currentObsUrl';
import { resolveWebObsTarget } from '../../../utils/webObsTarget';
import { hasCustomObsFont } from '../../../utils/visualSettingsConfig';
import { useSettingsUiStore } from '../../../stores/useSettingsUiStore';

// src/components/modal/settings/IntegrationSettingsSubview.tsx
// Integration settings for Discord, Stage, Now Playing, OBS, and Navidrome.

type NavidromeTestStatus = 'idle' | 'testing' | 'success' | 'failed';
type StageActionStatus = 'idle' | 'regenerating';

export type IntegrationSettingsChrome = {
    errorBgColor: string;
    errorTextColor: string;
    getAccentOptionStyle: (selected: boolean) => React.CSSProperties;
    isElectron: boolean;
    settingsCardClass: string;
    successBgColor: string;
    successTextColor: string;
    theme?: Theme;
    toggleOffBackgroundClass: string;
};

export type IntegrationStageModel = {
    nowPlayingConnectionStatus: NowPlayingConnectionStatus;
    obsBrowserSourceStatus?: ObsBrowserSourceStatus | null;
    onCopyText: (text: string) => Promise<void>;
    onRegenerateObsBrowserSourceToken?: () => Promise<void> | void;
    onRegenerateStageToken?: () => Promise<void> | void;
    onStageSourceChange?: (source: StageSource) => Promise<void> | void;
    onToggleObsBrowserSource?: (enabled: boolean) => Promise<void> | void;
    onToggleStageMode?: (enabled: boolean) => Promise<void> | void;
    playerCapConnectionStatus?: PlayerCapConnectionStatus;
    playerCapPlayers?: string[];
    setStageActionStatus: (status: StageActionStatus) => void;
    setStageAddressCopied: (copied: boolean) => void;
    stageActionStatus: StageActionStatus;
    stageAddressCopied: boolean;
    stageSource?: StageSource | null;
    stageStatus?: StageStatus | null;
};

export type IntegrationNavidromeModel = {
    navidromeConfigured: boolean;
    navidromeEnabled: boolean;
    navidromePassword: string;
    navidromeServerProfile: NavidromeServerProfile | null;
    navidromeTestStatus: NavidromeTestStatus;
    navidromeUrl: string;
    navidromeUsername: string;
    onClearNavidrome: () => void;
    onToggleNavidrome: (enabled: boolean) => void;
    setNavidromePassword: (value: string) => void;
    setNavidromeUrl: (value: string) => void;
    setNavidromeUsername: (value: string) => void;
    testNavidromeConnection: () => Promise<void> | void;
};

export type IntegrationDiscordModel = {
    enabled: boolean;
    onToggle: (enabled: boolean) => Promise<void> | void;
    status?: ElectronDiscordPresenceStatus | null;
};

type IntegrationSettingsSubviewProps = {
    chrome: IntegrationSettingsChrome;
    discord: IntegrationDiscordModel;
    navidrome: IntegrationNavidromeModel;
    stage: IntegrationStageModel;
};

const maskStageToken = (token: string | null | undefined, t: (key: string) => string) => {
    if (!token) return t('options.stageTokenMissing');
    if (token.length <= 10) return token;
    return `${token.slice(0, 6)}...${token.slice(-4)}`;
};

const IntegrationSettingsSubview: React.FC<IntegrationSettingsSubviewProps> = ({
    chrome,
    discord,
    navidrome,
    stage,
}) => {
    const {
        errorBgColor,
        errorTextColor,
        getAccentOptionStyle,
        isElectron,
        settingsCardClass,
        successBgColor,
        successTextColor,
        theme,
        toggleOffBackgroundClass,
    } = chrome;
    const {
        nowPlayingConnectionStatus,
        obsBrowserSourceStatus,
        onCopyText,
        onRegenerateObsBrowserSourceToken,
        onRegenerateStageToken,
        onStageSourceChange,
        onToggleObsBrowserSource,
        onToggleStageMode,
        setStageActionStatus,
        setStageAddressCopied,
        stageActionStatus,
        stageAddressCopied,
        stageSource,
        stageStatus,
        playerCapConnectionStatus,
        playerCapPlayers,
    } = stage;
    const {
        navidromeConfigured,
        navidromeEnabled,
        navidromePassword,
        navidromeServerProfile,
        navidromeTestStatus,
        navidromeUrl,
        navidromeUsername,
        onClearNavidrome,
        onToggleNavidrome,
        setNavidromePassword,
        setNavidromeUrl,
        setNavidromeUsername,
        testNavidromeConnection,
    } = navidrome;
    const {
        enabled: discordPresenceEnabled,
        onToggle: onToggleDiscordPresence,
        status: discordPresenceStatus,
    } = discord;
    const { t } = useTranslation();
    const getNowPlayingStatusLabel = (status: NowPlayingConnectionStatus) => {
        if (status === 'connected') return t('status.connected');
        if (status === 'connecting') return t('status.connecting');
        if (status === 'error') return t('status.disconnected');
        return t('options.updateCheckDisabled');
    };
    const [obsAddressCopied, setObsAddressCopied] = useState(false);
    const [obsUrlCopied, setObsUrlCopied] = useState(false);
    // PlayerCap config: the subview reads the store directly (fewer layers); connection state/players are passed in by the stage model.
    const {
        playerCapHost,
        playerCapPlayer,
        playerCapTimeBasis,
        playerCapSticky,
        setPlayerCapHost,
        setPlayerCapPlayer,
        setPlayerCapTimeBasis,
        setPlayerCapSticky,
        setWebStageSource,
        isDaylight,
    } = useSettingsUiStore(useShallow(state => ({
        playerCapHost: state.playerCapHost,
        playerCapPlayer: state.playerCapPlayer,
        playerCapTimeBasis: state.playerCapTimeBasis,
        playerCapSticky: state.playerCapSticky,
        setPlayerCapHost: state.setPlayerCapHost,
        setPlayerCapPlayer: state.setPlayerCapPlayer,
        setPlayerCapTimeBasis: state.setPlayerCapTimeBasis,
        setPlayerCapSticky: state.setPlayerCapSticky,
        setWebStageSource: state.setWebStageSource,
        isDaylight: state.isDaylight,
    })));
    const [playerCapHostDraft, setPlayerCapHostDraft] = useState(playerCapHost);
    useEffect(() => { setPlayerCapHostDraft(playerCapHost); }, [playerCapHost]);
    const playerCapConnected = playerCapConnectionStatus === 'connected';
    const playerCapStatusLabel = (() => {
        switch (playerCapConnectionStatus) {
            case 'connected': return t('status.connected');
            case 'connecting':
            case 'probing': return t('status.connecting');
            case 'disconnected':
            case 'unreachable': return t('status.disconnected');
            default: return t('options.updateCheckDisabled');
        }
    })();
    const commitPlayerCapHost = () => setPlayerCapHost(playerCapHostDraft.trim() || 'localhost:8765');
    const nowPlayingStatusLabel = getNowPlayingStatusLabel(nowPlayingConnectionStatus);
    const maskStageTokenWithT = (token: string | null | undefined) => maskStageToken(token, t);
    const discordPresenceStatusLabel = (() => {
        if (!discordPresenceStatus?.enabled) return t('options.discordPresenceDisabled') || 'Disabled';
        if (discordPresenceStatus.connected) return t('options.discordPresenceConnected') || 'Connected';
        return t('options.discordPresenceDisconnected') || 'Disconnected';
    })();
    const navidromeExtensionCount = navidromeServerProfile?.openSubsonicExtensions.length ?? 0;
    const navidromeFolderCount = navidromeServerProfile?.musicFolders.length ?? 0;
    const navidromeServerLabel = navidromeServerProfile?.serverVersion
        || navidromeServerProfile?.serverType
        || t('navidrome.serverProfileUnavailable');

    const handleCopyStageAddress = async (address: string) => {
        await onCopyText(address);
        setStageAddressCopied(true);
        window.setTimeout(() => setStageAddressCopied(false), 1600);
    };

    const handleCopyObsAddress = async (address: string) => {
        await onCopyText(address);
        setObsAddressCopied(true);
        window.setTimeout(() => setObsAddressCopied(false), 1600);
    };

    // Whether the web stage is enabled (stageSource is derived by the controller from the store's two toggles: null means disabled).
    const webStageEnabled = stageSource === 'now-playing' || stageSource === 'playercap';

    // Copy the OBS overlay URL for the selected web stage source (Now Playing / PlayerCap).
    const handleCopyObsUrl = async () => {
        const target = resolveWebObsTarget();
        if (!target) return;
        await onCopyText(await buildCurrentObsUrl(target.source, target.host, target.extra));
        setObsUrlCopied(true);
        window.setTimeout(() => setObsUrlCopied(false), 1600);
        if (hasCustomObsFont()) {
            useSettingsUiStore.getState().statusSetter?.({ type: 'info', text: t('options.obsUrlCustomFontHint') });
        }
    };

    // PlayerCap config panel: the Electron and Web sections share a single instance (host/player/timeline/sticky).
    const renderPlayerCapPanel = () => (
        <>
            <div className={`rounded-xl border p-3 space-y-3 ${settingsCardClass}`}>
                <div className="flex items-center justify-between gap-3">
                    <div className="text-[10px] uppercase tracking-[0.16em] opacity-40" style={{ color: 'var(--text-secondary)' }}>
                        {t('options.playerCapAddress')}
                    </div>
                    <span className={`shrink-0 px-2 py-1 rounded-full text-[10px] ${playerCapConnected ? successBgColor : errorBgColor} ${playerCapConnected ? successTextColor : errorTextColor}`}>
                        {playerCapStatusLabel}
                    </span>
                </div>
                <input
                    type="text"
                    value={playerCapHostDraft}
                    onChange={(e) => setPlayerCapHostDraft(e.target.value)}
                    onBlur={commitPlayerCapHost}
                    placeholder="localhost:8765"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-white/30 transition-colors"
                    style={{ color: 'var(--text-primary)' }}
                />
                <div className="text-[10px] opacity-40" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.playerCapAddressHint')}
                </div>
            </div>

            <div className={`rounded-xl border p-3 space-y-2 ${settingsCardClass}`}>
                <div className="text-[10px] uppercase tracking-[0.16em] opacity-40" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.playerCapPlayer')}
                </div>
                <CustomSelect
                    value={playerCapPlayer}
                    onChange={setPlayerCapPlayer}
                    options={[{ value: '', label: t('options.playerCapPlayerDefault') }, ...(playerCapPlayers ?? []).map((p) => ({ value: p, label: p }))]}
                    disabled={!playerCapConnected}
                    isDaylight={isDaylight}
                    theme={theme}
                    ariaLabel="PlayerCap Player"
                />
            </div>

            <div className={`rounded-xl border p-3 space-y-3 ${settingsCardClass}`}>
                <div className="text-[10px] uppercase tracking-[0.16em] opacity-40" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.playerCapTimeline')}
                </div>
                <div className="grid grid-cols-2 gap-2">
                    {([
                        { value: 'play_time', label: 'play_time' },
                        { value: 'timestamp', label: 'timestamp' },
                    ] as Array<{ value: 'play_time' | 'timestamp'; label: string }>).map((option) => {
                        const selected = playerCapTimeBasis === option.value;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => setPlayerCapTimeBasis(option.value)}
                                className="rounded-xl border px-3 py-3 text-sm transition-colors"
                                style={{ ...getAccentOptionStyle(selected), color: 'var(--text-primary)' }}
                            >
                                {option.label}
                            </button>
                        );
                    })}
                </div>
                <div className="text-[10px] opacity-40 leading-relaxed space-y-0.5" style={{ color: 'var(--text-secondary)' }}>
                    <div>{t('options.playerCapBasisPlayTime')}</div>
                    <div>{t('options.playerCapBasisTimestamp')}</div>
                </div>
                <div className="flex items-center justify-between gap-4 pt-1">
                    <div className="space-y-1">
                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {t('options.playerCapIgnoreClear')}
                        </div>
                        <div className="text-[10px] opacity-40" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.playerCapIgnoreClearHint')}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setPlayerCapSticky(!playerCapSticky)}
                        className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${!playerCapSticky ? toggleOffBackgroundClass : ''}`}
                        style={{ backgroundColor: playerCapSticky ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                        aria-label={t('options.playerCapIgnoreClear')}
                    >
                        <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${playerCapSticky ? 'translate-x-6' : 'translate-x-0'}`} />
                    </button>
                </div>
            </div>
        </>
    );

    // Now Playing panel: the Electron and Web sections share it (fixed ws://localhost:9863).
    const renderNowPlayingPanel = () => (
        <div className={`rounded-xl border p-3 space-y-2 ${settingsCardClass}`}>
            <div className="text-[10px] uppercase tracking-[0.16em] opacity-40" style={{ color: 'var(--text-secondary)' }}>
                Now Playing
            </div>
            <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
                {t("options.nowPlayingStatusLabel", { status: nowPlayingStatusLabel })}
            </div>
            <div className="text-[11px] opacity-50" style={{ color: 'var(--text-secondary)' }}>
                {t('options.nowPlayingFixedConnectionDesc')}
            </div>
        </div>
    );

    return (
        <>
            {isElectron && (
                <section>
                    <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                        <Activity size={14} /> {t('options.discordRichPresence') || 'Discord Rich Presence'}
                    </h3>
                    <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                        <div className="flex items-center justify-between gap-4">
                            <div className="space-y-1">
                                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                    {t('options.enableDiscordRichPresence') || 'Enable Discord playback status'}
                                </div>
                                <div className="text-[10px] opacity-40 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.discordRichPresenceDesc') || 'Show the current Folia track in Discord desktop. Folia connects with its built-in application identity.'}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => void onToggleDiscordPresence(!discordPresenceEnabled)}
                                className={`w-12 h-6 rounded-full p-1 transition-colors ${!discordPresenceEnabled ? toggleOffBackgroundClass : ''}`}
                                style={{ backgroundColor: discordPresenceEnabled ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                                aria-label={t('options.enableDiscordRichPresence') || 'Enable Discord playback status'}
                            >
                                <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${discordPresenceEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                            </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <span className={`px-2 py-1 rounded-full text-[10px] ${discordPresenceStatus?.connected ? successBgColor : errorBgColor} ${discordPresenceStatus?.connected ? successTextColor : errorTextColor}`}>
                                {discordPresenceStatusLabel}
                            </span>
                            {discordPresenceStatus?.error && (
                                <span className="text-[10px] opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                    {discordPresenceStatus.error}
                                </span>
                            )}
                        </div>
                    </div>
                </section>
            )}

            {isElectron && obsBrowserSourceStatus && (
                <section>
                    <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                        <Server size={14} /> {t('options.obsBrowserSource') || 'OBS Browser Source'}
                    </h3>
                    <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                        <div className="flex items-center justify-between gap-4">
                            <div className="space-y-1">
                                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                    {t('options.enableObsBrowserSource') || 'Enable OBS browser source'}
                                </div>
                                <div className="text-[10px] opacity-40 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.obsBrowserSourceDesc') || 'Renders the full lyrics animation in OBS without audio. When connected, the main window stops rendering the heavy visualizer.'}
                                </div>
                            </div>
                            <button
                                onClick={() => void onToggleObsBrowserSource?.(!obsBrowserSourceStatus.enabled)}
                                className={`w-12 h-6 rounded-full p-1 transition-colors ${!obsBrowserSourceStatus.enabled ? toggleOffBackgroundClass : ''}`}
                                style={{ backgroundColor: obsBrowserSourceStatus.enabled ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                                aria-label={t('options.enableObsBrowserSource') || 'Enable OBS browser source'}
                            >
                                <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${obsBrowserSourceStatus.enabled ? 'translate-x-6' : 'translate-x-0'}`} />
                            </button>
                        </div>

                        {obsBrowserSourceStatus.enabled && (
                            <div className="space-y-3">
                                <div className={`rounded-xl border p-3 space-y-3 ${settingsCardClass}`}>
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <div className="text-[10px] uppercase tracking-[0.16em] opacity-40 mb-2" style={{ color: 'var(--text-secondary)' }}>
                                                {t('options.obsBrowserSourceAddress') || 'OBS URL'}
                                            </div>
                                            <div className="text-sm break-all" style={{ color: 'var(--text-primary)' }}>
                                                {obsBrowserSourceStatus.url ?? 'http://127.0.0.1'}
                                            </div>
                                        </div>
                                        <span className={`shrink-0 px-2 py-1 rounded-full text-[10px] ${obsBrowserSourceStatus.clientCount > 0 ? successBgColor : errorBgColor} ${obsBrowserSourceStatus.clientCount > 0 ? successTextColor : errorTextColor}`}>
                                            {t('options.obsBrowserSourceClients') || 'Clients'}: {obsBrowserSourceStatus.clientCount}
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            onClick={() => obsBrowserSourceStatus.url ? void handleCopyObsAddress(obsBrowserSourceStatus.url) : undefined}
                                            disabled={!obsBrowserSourceStatus.url}
                                            className="px-3 py-2 bg-white/10 hover:bg-white/15 rounded-lg text-xs transition-colors disabled:opacity-40 flex items-center gap-2"
                                            style={{ color: obsAddressCopied ? '#86efac' : 'var(--text-primary)' }}
                                        >
                                            {obsAddressCopied ? <Check size={14} /> : null}
                                            {obsAddressCopied
                                                ? (t('options.stageAddressCopied') || 'Copied')
                                                : (t('options.copyObsBrowserSourceAddress') || 'Copy OBS URL')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void onRegenerateObsBrowserSourceToken?.()}
                                            className="px-3 py-2 bg-white/10 hover:bg-white/15 rounded-lg text-xs transition-colors"
                                            style={{ color: 'var(--text-primary)' }}
                                        >
                                            {t('options.regenerateObsBrowserSourceToken') || 'Regenerate Token'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </section>
            )}

            {isElectron && stageStatus && (
                <section>
                    <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                        <Server size={14} /> {t('options.stageMode')}
                    </h3>
                    <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                        <div className="flex items-center justify-between gap-4">
                            <div className="space-y-1">
                                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                    {t('options.enableStageMode')}
                                </div>
                                <div className="text-[10px] opacity-40 max-w-[320px]" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.enableStageModeDescElectron')}
                                </div>
                            </div>
                            <button
                                onClick={() => void onToggleStageMode?.(!(stageStatus.modeEnabled ?? false))}
                                className={`w-12 h-6 rounded-full p-1 transition-colors ${!(stageStatus.modeEnabled ?? false) ? toggleOffBackgroundClass : ''}`}
                                style={{ backgroundColor: stageStatus.modeEnabled ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                            >
                                <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${stageStatus.modeEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                            </button>
                        </div>

                        {stageStatus.modeEnabled && (
                            <div className="space-y-3">
                                <div className={`rounded-xl border p-3 space-y-2 ${settingsCardClass}`}>
                                    <div className="text-[10px] uppercase tracking-[0.16em] opacity-40" style={{ color: 'var(--text-secondary)' }}>
                                        Source
                                    </div>
                                    <div className="grid grid-cols-3 gap-2">
                                        {([
                                            { value: 'stage-api', label: 'Stage API' },
                                            { value: 'now-playing', label: 'Now Playing' },
                                            { value: 'playercap', label: 'Nexus PlayerCap' },
                                        ] as Array<{ value: StageSource; label: string }>).map((option) => {
                                            const selected = stageSource === option.value;
                                            return (
                                                <button
                                                    key={option.value}
                                                    type="button"
                                                    onClick={() => void onStageSourceChange?.(option.value)}
                                                    className="rounded-xl border px-3 py-3 text-sm transition-colors"
                                                    style={{ ...getAccentOptionStyle(selected), color: 'var(--text-primary)' }}
                                                >
                                                    {option.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {stageSource === 'playercap' ? (
                                    renderPlayerCapPanel()
                                ) : stageSource === 'now-playing' ? (
                                    renderNowPlayingPanel()
                                ) : (
                                    <>
                                        <div className={`rounded-xl border p-3 space-y-3 ${settingsCardClass}`}>
                                            <div>
                                                <div className="text-[10px] uppercase tracking-[0.16em] opacity-40 mb-2" style={{ color: 'var(--text-secondary)' }}>
                                                    {t('options.stageAddress') || 'Stage Address'}
                                                </div>
                                                <div className="text-sm break-all" style={{ color: 'var(--text-primary)' }}>
                                                    {`http://127.0.0.1:${stageStatus.port}`}
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => void handleCopyStageAddress(`http://127.0.0.1:${stageStatus.port}`)}
                                                    className="px-3 py-2 bg-white/10 hover:bg-white/15 rounded-lg text-xs transition-colors flex items-center gap-2"
                                                    style={{ color: stageAddressCopied ? '#86efac' : 'var(--text-primary)' }}
                                                >
                                                    {stageAddressCopied ? <Check size={14} /> : null}
                                                    {stageAddressCopied
                                                        ? (t('options.stageAddressCopied') || 'Copied')
                                                        : (t('options.copyStageAddress') || 'Copy Address')}
                                                </button>
                                            </div>
                                        </div>

                                        <div className={`rounded-xl border p-3 space-y-3 ${settingsCardClass}`}>
                                            <div>
                                                <div className="text-[10px] uppercase tracking-[0.16em] opacity-40 mb-2" style={{ color: 'var(--text-secondary)' }}>
                                                    {t('options.stageToken') || 'Bearer Token'}
                                                </div>
                                                <div className="text-sm break-all" style={{ color: 'var(--text-primary)' }}>
                                                    {maskStageTokenWithT(stageStatus.token)}
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => void onCopyText(stageStatus.token || '')}
                                                    disabled={!stageStatus.token}
                                                    className="px-3 py-2 bg-white/10 hover:bg-white/15 rounded-lg text-xs transition-colors disabled:opacity-40"
                                                    style={{ color: 'var(--text-primary)' }}
                                                >
                                                    {t('options.copyStageToken') || 'Copy Token'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={async () => {
                                                        setStageActionStatus('regenerating');
                                                        try {
                                                            await onRegenerateStageToken?.();
                                                        } finally {
                                                            setStageActionStatus('idle');
                                                        }
                                                    }}
                                                    disabled={stageActionStatus !== 'idle'}
                                                    className="px-3 py-2 bg-white/10 hover:bg-white/15 rounded-lg text-xs transition-colors disabled:opacity-40"
                                                    style={{ color: 'var(--text-primary)' }}
                                                >
                                                    {stageActionStatus === 'regenerating'
                                                        ? (t('options.stageTokenRegenerating') || 'Regenerating...')
                                                        : (t('options.regenerateStageToken') || 'Regenerate Token')}
                                                </button>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </section>
            )}

            {!isElectron && (
                <section>
                    <h3 className="text-sm font-bold uppercase tracking-wider mb-4 flex items-center justify-between gap-2" style={{ color: 'var(--text-secondary)' }}>
                        <span className="flex items-center gap-2 opacity-50"><Server size={14} /> {t('options.stageMode')}</span>
                        <button
                            type="button"
                            onClick={() => void handleCopyObsUrl()}
                            disabled={!webStageEnabled}
                            className="normal-case text-xs font-medium flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{ color: obsUrlCopied ? '#86efac' : 'var(--text-primary)' }}
                        >
                            {obsUrlCopied ? <Check size={13} /> : <Copy size={13} />}
                            {obsUrlCopied ? t('status.copied') : t('options.copyObsUrl')}
                        </button>
                    </h3>
                    <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                        <div className="flex items-center justify-between gap-4">
                            <div className="space-y-1">
                                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                    {t('options.enableStageMode')}
                                </div>
                                <div className="text-[10px] opacity-40 max-w-[320px]" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.enableStageModeDescWeb')}
                                </div>
                            </div>
                            <button
                                onClick={() => setWebStageSource(webStageEnabled ? null : 'now-playing')}
                                className={`w-12 h-6 rounded-full p-1 transition-colors ${!webStageEnabled ? toggleOffBackgroundClass : ''}`}
                                style={{ backgroundColor: webStageEnabled ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                                aria-label={t('options.enableStageMode')}
                            >
                                <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${webStageEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                            </button>
                        </div>

                        {webStageEnabled && (
                            <div className="space-y-3">
                                <div className={`rounded-xl border p-3 space-y-2 ${settingsCardClass}`}>
                                    <div className="text-[10px] uppercase tracking-[0.16em] opacity-40" style={{ color: 'var(--text-secondary)' }}>
                                        Source
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        {([
                                            { value: 'now-playing', label: 'Now Playing' },
                                            { value: 'playercap', label: 'Nexus PlayerCap' },
                                        ] as Array<{ value: 'now-playing' | 'playercap'; label: string }>).map((option) => {
                                            const selected = stageSource === option.value;
                                            return (
                                                <button
                                                    key={option.value}
                                                    type="button"
                                                    onClick={() => setWebStageSource(option.value)}
                                                    className="rounded-xl border px-3 py-3 text-sm transition-colors"
                                                    style={{ ...getAccentOptionStyle(selected), color: 'var(--text-primary)' }}
                                                >
                                                    {option.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {stageSource === 'playercap' ? renderPlayerCapPanel() : renderNowPlayingPanel()}
                            </div>
                        )}
                    </div>
                </section>
            )}

            <section>
                <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <Server size={14} /> {t('navidrome.settings') || 'Navidrome Settings'}
                    {navidromeEnabled && navidromeConfigured && (
                        <span className={`ml-2 px-2 py-0.5 ${successBgColor} ${successTextColor} text-xs rounded-full font-normal normal-case`}>
                            {t('navidrome.connectionSuccess') || 'Connected'}
                        </span>
                    )}
                </h3>
                <div className="bg-white/5 p-4 rounded-xl border border-white/5 space-y-4">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {t('navidrome.enable') || 'Enable Navidrome'}
                        </span>
                        <button
                            onClick={() => onToggleNavidrome(!navidromeEnabled)}
                            className={`w-12 h-6 rounded-full p-1 transition-colors ${!navidromeEnabled ? toggleOffBackgroundClass : ''}`}
                            style={{ backgroundColor: navidromeEnabled ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                        >
                            <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-300 ${navidromeEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                        </button>
                    </div>

                    {navidromeEnabled && (
                        <>
                            <div className="space-y-2">
                                <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                    {t('navidrome.serverUrl') || 'Server URL'}
                                </label>
                                <input
                                    type="url"
                                    value={navidromeUrl}
                                    onChange={(e) => setNavidromeUrl(e.target.value)}
                                    placeholder={t('navidrome.serverUrlPlaceholder') || 'e.g., http://localhost:4533'}
                                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-white/30 transition-colors"
                                    style={{ color: 'var(--text-primary)' }}
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                    {t('navidrome.username') || 'Username'}
                                </label>
                                <input
                                    type="text"
                                    value={navidromeUsername}
                                    onChange={(e) => setNavidromeUsername(e.target.value)}
                                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-white/30 transition-colors"
                                    style={{ color: 'var(--text-primary)' }}
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                    {t('navidrome.password') || 'Password'}
                                </label>
                                <input
                                    type="password"
                                    value={navidromePassword}
                                    onChange={(e) => setNavidromePassword(e.target.value)}
                                    placeholder={navidromeConfigured ? '••••••••' : ''}
                                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-white/30 transition-colors"
                                    style={{ color: 'var(--text-primary)' }}
                                />
                            </div>

                            {navidromeConfigured && navidromeServerProfile && (
                                <div className="border-t border-white/10 pt-3">
                                    <div className="flex items-center justify-center text-xs opacity-80 overflow-hidden whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                                        <span className="truncate" title={navidromeServerLabel}>{navidromeServerLabel}</span>
                                        <span className="opacity-50 mx-1.5 shrink-0">·</span>
                                        <span className="truncate" title={navidromeServerProfile.user?.username || navidromeUsername}>
                                            {navidromeServerProfile.user?.username || navidromeUsername}
                                        </span>
                                        {navidromeServerProfile.openSubsonic && (
                                            <>
                                                <span className="opacity-50 mx-1.5 shrink-0">·</span>
                                                <span className="shrink-0">OpenSubsonic ({navidromeExtensionCount})</span>
                                            </>
                                        )}
                                        <span className="opacity-50 mx-1.5 shrink-0">·</span>
                                        <span className="shrink-0">{t('navidrome.musicFolders') || 'Libraries'} ({navidromeFolderCount})</span>
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {navidromeEnabled && (
                        <div className="flex gap-2 pt-2">
                            <button
                                onClick={testNavidromeConnection}
                                disabled={navidromeTestStatus === 'testing' || !navidromeUrl || !navidromeUsername || !navidromePassword}
                                className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 bg-white/10 hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed"
                                style={{ color: 'var(--text-primary)' }}
                            >
                                {navidromeTestStatus === 'testing' ? (
                                    <>
                                        <Loader2 size={16} className="animate-spin" />
                                        {t('navidrome.testing') || 'Connecting...'}
                                    </>
                                ) : navidromeTestStatus === 'success' ? (
                                    <>
                                        <Check size={16} className={successTextColor} />
                                        {t('navidrome.connectionSuccess') || 'Connected'}
                                    </>
                                ) : navidromeTestStatus === 'failed' ? (
                                    <>
                                        <AlertCircle size={16} className={errorTextColor} />
                                        {t('navidrome.connectionFailed') || 'Failed'}
                                    </>
                                ) : (
                                    <>
                                        <Server size={16} />
                                        {t('navidrome.testConnection') || 'Test Connection'}
                                    </>
                                )}
                            </button>

                            {navidromeConfigured && (
                                <button
                                    onClick={onClearNavidrome}
                                    className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${errorBgColor} hover:bg-red-500/20 ${errorTextColor}`}
                                >
                                    <Trash2 size={16} />
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </section>
        </>
    );
};

export default IntegrationSettingsSubview;
