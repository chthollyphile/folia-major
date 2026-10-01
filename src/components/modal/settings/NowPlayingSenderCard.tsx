import React, { useState } from 'react';
import { Check, Server } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../../types';
import type { NowPlayingSenderStatus } from '../../../types/nowPlayingSender';
import {
    NOW_PLAYING_SENDER_PROGRESS_INTERVAL_MAX_SEC,
    NOW_PLAYING_SENDER_PROGRESS_INTERVAL_MIN_SEC,
} from '../../../types/nowPlayingSender';
import { SettingsAnchor } from './navigation/SettingsAnchorContext';
import SettingsSectionHeading from './navigation/SettingsSectionHeading';

// src/components/modal/settings/NowPlayingSenderCard.tsx
// The desktop-only outbound Now Playing broadcaster: enable switch, endpoint, the
// running/unavailable badge, and the progress heartbeat interval. The listening port is fixed at
// 9863, so there is nothing to edit there; the heartbeat is the one dial, because a client that
// repositions its own bar on every report is the thing worth tuning.

type NowPlayingSenderCardProps = {
    errorBgColor: string;
    errorTextColor: string;
    onCopyText: (text: string) => Promise<void>;
    onChangeProgressIntervalSec?: (intervalSec: number) => Promise<void> | void;
    onToggle?: (enabled: boolean) => Promise<void> | void;
    settingsCardClass: string;
    status: NowPlayingSenderStatus;
    successBgColor: string;
    successTextColor: string;
    theme?: Theme;
    toggleOffBackgroundClass: string;
};

const NowPlayingSenderCard: React.FC<NowPlayingSenderCardProps> = ({
    errorBgColor,
    errorTextColor,
    onCopyText,
    onChangeProgressIntervalSec,
    onToggle,
    settingsCardClass,
    status,
    successBgColor,
    successTextColor,
    theme,
    toggleOffBackgroundClass,
}) => {
    const { t } = useTranslation();
    const [addressCopied, setAddressCopied] = useState(false);
    // One decimal, so the slider steps in 0.1s. `0` is the "never on a timer" position.
    const progressIntervalSec = status.progressIntervalSec ?? 0;

    const handleCopyAddress = async (address: string) => {
        await onCopyText(address);
        setAddressCopied(true);
        window.setTimeout(() => setAddressCopied(false), 1600);
    };

    return (
        <SettingsAnchor anchorId="nowPlayingSender" label={t('options.nowPlayingSender')}>
            <SettingsSectionHeading icon={Server} label={t('options.nowPlayingSender')} />
            <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                <div className="flex items-center justify-between gap-4">
                    <div className="space-y-1">
                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {t('options.enableNowPlayingSender')}
                        </div>
                        <div className="text-[10px] opacity-40 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.nowPlayingSenderDesc')}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => void onToggle?.(!status.enabled)}
                        className={`w-12 h-6 rounded-full p-1 transition-colors ${!status.enabled ? toggleOffBackgroundClass : ''}`}
                        style={{ backgroundColor: status.enabled ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                        aria-label={t('options.enableNowPlayingSender')}
                    >
                        <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${status.enabled ? 'translate-x-6' : 'translate-x-0'}`} />
                    </button>
                </div>

                {status.enabled && (
                    <div className={`rounded-xl border p-3 space-y-3 ${settingsCardClass}`}>
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <div className="text-[10px] uppercase tracking-[0.16em] opacity-40 mb-2" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.nowPlayingSenderAddress')}
                                </div>
                                <div className="text-sm break-all" style={{ color: 'var(--text-primary)' }}>
                                    {status.wsUrl ?? `ws://127.0.0.1:${status.port}/api/ws/lyric`}
                                </div>
                            </div>
                            <span className={`shrink-0 px-2 py-1 rounded-full text-[10px] ${status.running ? successBgColor : errorBgColor} ${status.running ? successTextColor : errorTextColor}`}>
                                {status.running
                                    ? `${t('options.nowPlayingSenderClients')}: ${status.clientCount}`
                                    : t('options.nowPlayingSenderUnavailable')}
                            </span>
                        </div>
                        <button
                            type="button"
                            onClick={() => status.wsUrl ? void handleCopyAddress(status.wsUrl) : undefined}
                            disabled={!status.wsUrl}
                            className="px-3 py-2 bg-white/10 hover:bg-white/15 rounded-lg text-xs transition-colors disabled:opacity-40 flex items-center gap-2"
                            style={{ color: addressCopied ? '#86efac' : 'var(--text-primary)' }}
                        >
                            {addressCopied ? <Check size={14} /> : null}
                            {addressCopied ? t('options.stageAddressCopied') : t('options.copyNowPlayingSenderAddress')}
                        </button>
                        {status.error && (
                            <div className="text-[10px] text-red-400 break-all">{status.error}</div>
                        )}
                        <div className="space-y-2 pt-1">
                            <div className="flex items-center justify-between gap-4">
                                <div className="text-xs" style={{ color: 'var(--text-primary)' }}>
                                    {t('options.nowPlayingSenderProgressInterval')}
                                </div>
                                <span className="text-xs font-mono w-16 text-right shrink-0" style={{ color: 'var(--text-primary)' }}>
                                    {progressIntervalSec <= 0 ? t('options.nowPlayingSenderProgressIntervalOff') : `${progressIntervalSec.toFixed(1)}s`}
                                </span>
                            </div>
                            <input
                                type="range"
                                min={NOW_PLAYING_SENDER_PROGRESS_INTERVAL_MIN_SEC}
                                max={NOW_PLAYING_SENDER_PROGRESS_INTERVAL_MAX_SEC}
                                step={0.1}
                                value={progressIntervalSec}
                                onChange={(event) => void onChangeProgressIntervalSec?.(Number(event.target.value))}
                                className="w-full accent-current"
                                style={{ accentColor: theme?.accentColor }}
                                aria-label={t('options.nowPlayingSenderProgressInterval')}
                            />
                            <div className="flex justify-between text-[11px] font-mono opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                <span>0</span>
                                <span>{NOW_PLAYING_SENDER_PROGRESS_INTERVAL_MAX_SEC}s</span>
                            </div>
                            <div className="text-[10px] opacity-40 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.nowPlayingSenderProgressIntervalDesc')}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </SettingsAnchor>
    );
};

export default NowPlayingSenderCard;
