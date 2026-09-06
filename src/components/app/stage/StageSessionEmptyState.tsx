import React from 'react';
import { useTranslation } from 'react-i18next';
import type { NowPlayingConnectionStatus, StageSource } from '../../../types';
import type { PlayerCapConnectionStatus } from '../../../types/playerCap';
import { useAppViewStore } from '../../../stores/useAppViewStore';
import { useThemeSettingsStore } from '../../../stores/useThemeSettingsStore';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';

// src/components/app/stage/StageSessionEmptyState.tsx
// What the player page shows when it is following an external stage that has nothing playing yet.
// Renders nothing at all outside that state, so App.tsx mounts it unconditionally.
// 空状态卡片不接入液态玻璃（按需求移除），保持普通毛玻璃 + class 底色。

type StageSessionEmptyStateProps = {
    stageSource?: StageSource | null;
    /** Non-null once a stage entry is actually driving playback; the card is for before that. */
    stageActiveEntryKind: string | null;
    nowPlayingConnectionStatus?: NowPlayingConnectionStatus;
    playerCapConnectionStatus?: PlayerCapConnectionStatus;
};

const SOURCE_LABELS: Record<string, string> = {
    'now-playing': 'Stage · Now Playing',
    playercap: 'Stage · Nexus PlayerCap',
};

const StageSessionEmptyState: React.FC<StageSessionEmptyStateProps> = ({
    stageSource,
    stageActiveEntryKind,
    nowPlayingConnectionStatus,
    playerCapConnectionStatus,
}) => {
    const { t } = useTranslation();
    const currentView = useAppViewStore(state => state.view);
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const activePlaybackContext = usePlaybackStore(state => state.activePlaybackContext);
    const currentSong = usePlaybackStore(state => state.currentSong);

    // now-playing is the exception: it keeps reporting an empty session even once an entry is
    // active, so the card stays up for it while every other source hides as soon as one arrives.
    const isWaitingOnStage = currentView === 'player'
        && activePlaybackContext === 'stage'
        && (!stageActiveEntryKind || stageSource === 'now-playing')
        && !currentSong;

    if (!isWaitingOnStage) {
        return null;
    }

    const detail = stageSource === 'playercap'
        ? (playerCapConnectionStatus === 'connected'
            ? t('options.playerCapWaitingLyrics')
            : t('options.playerCapConnecting'))
        : stageSource === 'now-playing'
            ? (nowPlayingConnectionStatus === 'error'
                ? t('options.stageConnectionError')
                : t('options.stageNotRunning'))
            : t('options.enableStageModeDesc');

    return (
        <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center px-6">
            <div
                className={`max-w-lg rounded-3xl border px-6 py-5 text-center backdrop-blur-md ${isDaylight ? 'border-black/10 bg-white/50 text-zinc-800' : 'border-white/10 bg-black/30 text-white'}`}
            >
                <div className="text-xs uppercase tracking-[0.22em] opacity-50">
                    {(stageSource && SOURCE_LABELS[stageSource]) ?? 'Stage · Stage API'}
                </div>
                {/* One key for every source. The original branched on now-playing and then used the
                    same key in both arms - preserved as-is rather than inventing a second string. */}
                <div className="mt-3 text-2xl font-semibold">{t('options.stageSessionEmpty')}</div>
                <div className="mt-2 text-sm opacity-70">{detail}</div>
            </div>
        </div>
    );
};

export default StageSessionEmptyState;
