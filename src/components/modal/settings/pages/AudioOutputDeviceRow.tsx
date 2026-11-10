import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAudioOutputDevices } from '../../../../hooks/useAudioOutputDevices';
import { useAudioSettingsStore } from '../../../../stores/useAudioSettingsStore';
import { Button, Row, Select, type SettingsOptionDef } from '../kit';

// src/components/modal/settings/pages/AudioOutputDeviceRow.tsx
// The output-device row of the 播放控制 page: the device list with its refresh button, and under
// the label what the list is doing or why it cannot be used. The devices are only read once the
// list is opened or refreshed (see useAudioOutputDevices for why).

interface MediaDevicesWithAudioOutput extends MediaDevices {
    selectAudioOutput?: (options?: { deviceId?: string; }) => Promise<{ deviceId: string; label?: string; }>;
}

type AudioOutputDeviceRowProps = {
    option: SettingsOptionDef;
    /** Switches the player's output; false when the device could not be used. */
    onDeviceChange: (deviceId: string) => Promise<boolean> | boolean;
};

const AudioOutputDeviceRow: React.FC<AudioOutputDeviceRowProps> = ({ option, onDeviceChange }) => {
    const { t } = useTranslation();
    const deviceId = useAudioSettingsStore(state => state.audioOutputDeviceId);
    const { devices, ensureLoaded, errorKey, hasLoaded, isLoading, isSupported, refresh, selectedDeviceLabel, setErrorKey } = useAudioOutputDevices(deviceId);
    const [isSelecting, setIsSelecting] = useState(false);

    // Where the browser has its own device prompt, the device is asked for through it first.
    const selectDevice = async (nextId: string) => {
        setErrorKey(null);
        const mediaDevices = navigator.mediaDevices as MediaDevicesWithAudioOutput | undefined;
        if (!nextId || !mediaDevices?.selectAudioOutput) {
            await onDeviceChange(nextId);
            return;
        }

        setIsSelecting(true);
        try {
            const selected = await mediaDevices.selectAudioOutput({ deviceId: nextId });
            if (await onDeviceChange(selected.deviceId)) {
                await refresh();
            } else {
                setErrorKey('options.audioOutputSelectFailed');
            }
        } catch (error) {
            console.error('[AudioOutputDeviceRow] Failed to select audio output device', error);
            setErrorKey('options.audioOutputSelectFailed');
        } finally {
            setIsSelecting(false);
        }
    };

    // Before the browser grants access a device comes without an id: it cannot be told from the
    // default, so it is not listed.
    const listed = devices.filter(device => device.deviceId);
    const options = [
        { value: '', label: t('options.audioOutputDefault') },
        ...listed.map((device, index) => ({
            value: device.deviceId,
            label: device.label || `${t('options.audioOutputUnnamed')} ${index + 1}`,
        })),
    ];
    // The list is read on demand, so a device saved in an earlier session needs its own entry
    // until then; without it the list would look empty while a non-default output is active.
    if (deviceId && !listed.some(device => device.deviceId === deviceId)) {
        options.push({ value: deviceId, label: selectedDeviceLabel || t('options.audioOutputUnnamed') });
    }

    const state = !isSupported
        ? t('options.audioOutputUnsupported')
        : errorKey
            ? t(errorKey)
            : isSelecting
                ? t('options.audioOutputSelecting')
                : isLoading
                    ? t('options.audioOutputLoading')
                    : hasLoaded && listed.length === 0
                        ? t('options.audioOutputEmpty')
                        : undefined;

    return (
        <Row option={option} hint={state} disabled={!isSupported}>
            <Button icon={RefreshCw} tip={t('options.audioOutputRefresh')} onClick={() => void refresh()} disabled={isLoading || isSelecting} />
            <Select value={deviceId} options={options} onChange={next => void selectDevice(next)} onOpen={ensureLoaded} disabled={isSelecting} />
        </Row>
    );
};

export default AudioOutputDeviceRow;
