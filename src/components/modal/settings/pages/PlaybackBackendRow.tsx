import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { listPlaybackBackends, selectedPlaybackBackend, selectPlaybackBackend, subscribePlaybackBackends } from '../../../../services/playbackBackend/registry';
import { backendPlayback } from '../../../../services/playbackBackend/controller';
import { setPlayerState } from '../../../../stores/usePlaybackStore';
import { PlayerState } from '../../../../types';
import { Row, Select, Status, type SettingsOptionDef } from '../kit';

// Only backend choice and reported state; device, DSP and engine settings belong to each mod.

const subscribeStatus = (listener: () => void) => backendPlayback.subscribe(() => listener());

export const PlaybackBackendRow = ({ option }: { option: SettingsOptionDef }) => {
    const { t } = useTranslation();
    const entries = useSyncExternalStore(subscribePlaybackBackends, listPlaybackBackends);
    const selected = useSyncExternalStore(subscribePlaybackBackends, selectedPlaybackBackend);
    const status = useSyncExternalStore(subscribeStatus, backendPlayback.getStatus);
    const options = [
        { value: '', label: t('options.playbackBackendBrowser') },
        ...entries.map(entry => ({ value: entry.id, label: entry.definition.name })),
    ];
    if (selected && !entries.some(entry => entry.id === selected)) {
        options.push({ value: selected, label: t('options.playbackBackendMissing') });
    }
    const output = selected ? status.output : undefined;
    return (
        <Row option={option} hint={t('options.playbackBackendHint')}>
            {output && <Status tone={output.exclusiveRequested && output.exclusiveActive !== true ? 'warn' : undefined}>
                {t(output.exclusiveActive === true ? 'options.playbackExclusiveActive'
                    : output.exclusiveRequested ? 'options.playbackExclusiveUnknown' : 'options.playbackShared')}
                {output.sampleRate ? ` · ${output.sampleRate} Hz` : ''}
                {output.format ? ` · ${output.format}` : ''}
            </Status>}
            <Select value={selected ?? ''} options={options} onChange={value => {
                setPlayerState(PlayerState.PAUSED);
                selectPlaybackBackend(value || null);
            }} />
        </Row>
    );
};
