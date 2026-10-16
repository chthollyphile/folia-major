import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../../types';
import type { NowPlayingLauncherError } from '../../../types/nowPlayingLauncher';
import { useNowPlayingLauncher } from '../../../hooks/useNowPlayingLauncher';

// src/components/modal/settings/NowPlayingLauncherPanel.tsx
// Desktop-only "auto-launch Now Playing" switch and executable picker shown under the Now Playing
// stage source. Renders nothing where auto-launch is unsupported (non-Windows builds).

type NowPlayingLauncherPanelProps = {
    toggleOffBackgroundClass: string;
    theme?: Theme;
};

const ERROR_KEYS: Record<NowPlayingLauncherError, string> = {
    'missing-executable': 'options.nowPlayingLauncherErrorMissing',
    'invalid-executable': 'options.nowPlayingLauncherErrorInvalid',
    'spawn-failed': 'options.nowPlayingLauncherErrorSpawn',
};

const NowPlayingLauncherPanel: React.FC<NowPlayingLauncherPanelProps> = ({ toggleOffBackgroundClass, theme }) => {
    const { t } = useTranslation();
    const { status, setEnabled, chooseExecutable } = useNowPlayingLauncher();

    if (!status?.supported) return null;

    const { enabled, executablePath, lastError } = status;
    // A missing path only matters once the switch is on; before that it is just the empty state.
    const visibleError = lastError && (enabled || lastError !== 'missing-executable') ? lastError : null;

    return (
        <div className="pt-2 mt-1 border-t border-white/10 space-y-3">
            <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {t('options.nowPlayingAutoLaunch')}
                    </div>
                    <div className="text-[10px] opacity-40 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                        {t('options.nowPlayingAutoLaunchDesc')}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => void setEnabled(!enabled)}
                    className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${!enabled ? toggleOffBackgroundClass : ''}`}
                    style={{ backgroundColor: enabled ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                    aria-label={t('options.nowPlayingAutoLaunch')}
                >
                    <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
            </div>

            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-[0.16em] opacity-40 mb-1" style={{ color: 'var(--text-secondary)' }}>
                        {t('options.nowPlayingExecutable')}
                    </div>
                    <div className="text-xs break-all" style={{ color: 'var(--text-primary)', opacity: executablePath ? 1 : 0.5 }}>
                        {executablePath ?? t('options.nowPlayingExecutableUnset')}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => void chooseExecutable()}
                    className="shrink-0 px-3 py-2 bg-white/10 hover:bg-white/15 rounded-lg text-xs transition-colors"
                    style={{ color: 'var(--text-primary)' }}
                >
                    {t('options.nowPlayingChooseExecutable')}
                </button>
            </div>

            {visibleError && (
                <div className="text-[11px] text-red-400">
                    {t(ERROR_KEYS[visibleError])}
                </div>
            )}
        </div>
    );
};

export default NowPlayingLauncherPanel;
