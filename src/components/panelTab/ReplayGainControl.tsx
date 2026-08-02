import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReplayGainInfo, ReplayGainMode } from '../../types';

// Shared control keeps local and Navidrome ReplayGain presentation and mode selection in sync.
type ReplayGainValues = Pick<ReplayGainInfo, 'trackGain' | 'albumGain'>;

interface ReplayGainControlProps {
    values?: ReplayGainValues;
    mode: ReplayGainMode;
    onChangeMode: (mode: ReplayGainMode) => void;
    isDaylight: boolean;
}

const ReplayGainControl: React.FC<ReplayGainControlProps> = ({
    values,
    mode,
    onChangeMode,
    isDaylight,
}) => {
    const { t } = useTranslation();
    const summary = useMemo(() => {
        const parts: string[] = [];
        if (typeof values?.trackGain === 'number') {
            parts.push(`T ${values.trackGain > 0 ? '+' : ''}${values.trackGain.toFixed(1)} dB`);
        }
        if (typeof values?.albumGain === 'number') {
            parts.push(`A ${values.albumGain > 0 ? '+' : ''}${values.albumGain.toFixed(1)} dB`);
        }
        return parts.length > 0 ? parts.join(' / ') : t('localMusic.replayGainUnavailable');
    }, [t, values?.albumGain, values?.trackGain]);
    const modes: { key: ReplayGainMode; label: string; }[] = [
        { key: 'off', label: t('localMusic.replayGainOff') },
        { key: 'track', label: t('localMusic.replayGainTrack') },
        { key: 'album', label: t('localMusic.replayGainAlbum') },
    ];
    const activeBackground = isDaylight ? 'bg-blue-500/15 text-blue-600' : 'bg-blue-500/20 text-blue-300';
    const inactiveBackground = isDaylight ? 'bg-black/5 text-zinc-500 hover:bg-black/10' : 'bg-white/5 text-zinc-400 hover:bg-white/10';

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <h3 className="text-[12px] font-bold opacity-40 uppercase tracking-widest">
                    {t('localMusic.replayGainTitle')}
                </h3>
                <span className="text-[11px] opacity-60 text-right">
                    {summary}
                </span>
            </div>
            <div className="flex gap-1">
                {modes.map(({ key, label }) => (
                    <button
                        key={key}
                        onClick={() => onChangeMode(key)}
                        className={`flex-1 text-[11px] py-1 px-1.5 rounded-md font-medium transition-all ${
                            mode === key ? activeBackground : inactiveBackground
                        }`}
                    >
                        {label}
                    </button>
                ))}
            </div>
        </div>
    );
};

export default ReplayGainControl;
