import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ReplayGainInfo, ReplayGainMode } from '../../types';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { PanelRow } from './shell/PanelRow';
import { Segments } from './shell/Segments';

// Shared control keeps local and Navidrome ReplayGain presentation and mode selection in sync.
// One row of the song's tab: off, auto, track or album, and under the name what the chosen mode does to the song.
export type ReplayGainValues = Pick<ReplayGainInfo, 'trackGain' | 'albumGain'>;

interface ReplayGainControlProps {
    values?: ReplayGainValues;
    mode: ReplayGainMode;
    onChangeMode: (mode: ReplayGainMode) => void;
}

const formatGain = (gain: number) => `${gain > 0 ? '+' : ''}${gain.toFixed(1)} dB`;

const ReplayGainControl: React.FC<ReplayGainControlProps> = ({
    values,
    mode,
    onChangeMode,
}) => {
    const { t } = useTranslation();
    const appliedDb = usePlaybackStore(state => state.replayGainAppliedDb);
    const estimated = usePlaybackStore(state => state.replayGainEstimated);
    const labels: Record<ReplayGainMode, string> = {
        off: t('localMusic.replayGainOff'),
        auto: t('localMusic.replayGainAuto'),
        track: t('localMusic.replayGainTrack'),
        album: t('localMusic.replayGainAlbum'),
    };
    // Track and album read the song's tags (album falls back to track), so without either there is nothing to apply.
    const hasTags = typeof values?.trackGain === 'number' || typeof values?.albumGain === 'number';
    const hint = mode === 'off' ? undefined
        : mode !== 'auto' && !hasTags ? t('localMusic.replayGainUnavailable')
        : `${labels[mode]} ${formatGain(appliedDb)}${mode === 'auto' && estimated ? ` · ${t('localMusic.replayGainEstimated')}` : ''}`;

    return (
        <PanelRow label={t('localMusic.replayGainTitle')} hint={hint}>
            <Segments
                fill
                value={mode}
                onChange={onChangeMode}
                options={(['off', 'auto', 'track', 'album'] as const).map(value => ({ value, label: labels[value] }))}
            />
        </PanelRow>
    );
};

export default ReplayGainControl;
