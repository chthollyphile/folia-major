import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ReplayGainInfo, ReplayGainMode } from '../../types';
import { useIsHifiRoute } from '../hifi/useHifiSignalPath';
import { PanelRow } from './shell/PanelRow';
import { Segments } from './shell/Segments';

// Shared control keeps local and Navidrome ReplayGain presentation and mode selection in sync.
// One row of the song's tab: the gains measured for the song under the name, and off, track or album.
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
    // mpv plays the song on the HiFi route and applies no gain; the mode is kept for the web engine.
    const isHifiRoute = useIsHifiRoute();
    const measured: string[] = [];
    if (typeof values?.trackGain === 'number') {
        measured.push(`${t('localMusic.replayGainTrack')} ${formatGain(values.trackGain)}`);
    }
    if (typeof values?.albumGain === 'number') {
        measured.push(`${t('localMusic.replayGainAlbum')} ${formatGain(values.albumGain)}`);
    }

    return (
        <PanelRow
            label={t('localMusic.replayGainTitle')}
            hint={isHifiRoute
                ? [t('hifi.player.replayGainBypassed'), ...measured].join(' · ')
                : measured.length > 0 ? measured.join(' · ') : t('localMusic.replayGainUnavailable')}
        >
            <Segments
                fill
                value={mode}
                onChange={onChangeMode}
                options={[
                    { value: 'off', label: t('localMusic.replayGainOff') },
                    { value: 'track', label: t('localMusic.replayGainTrack') },
                    { value: 'album', label: t('localMusic.replayGainAlbum') },
                ]}
            />
        </PanelRow>
    );
};

export default ReplayGainControl;
