import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { hifiEngine, useHifiEngineStore } from '../../../../../services/hifi/hifiEngine';
import { useHifiSettingsStore } from '../../../../../stores/useHifiSettingsStore';
import type { HifiDevice } from '../../../../../types/hifi';
import { Button, Group, Row, Select, Toggle } from '../../kit';
import HifiDsdRows from './HifiDsdRows';
import { HIFI_PLATFORM, O, OUTPUT } from './options';

// src/components/modal/settings/pages/hifi/HifiOutputGroup.tsx
// The mpv output group, drawn only while mpv is the engine: the device mpv plays to, with its
// refresh button, exclusive mode, software volume and the DSD rows. Reading the devices starts mpv,
// so the list is only read once it is opened or refreshed; until then the saved device keeps the
// name it was chosen under. On Linux the ALSA hw: devices, the ones that skip the sound server, are
// marked, and the hint says that choosing one of them is the bit-perfect path there. Linux has no
// exclusive switch: mpv's PipeWire and PulseAudio outputs always mix, so mpv runs with
// --audio-exclusive=no there; the saved value is left alone. By default mpv plays at 100% and the
// DAC or amplifier sets the loudness; software volume lets the app's slider scale the samples in
// mpv instead, which costs the bit-perfect path.

const IS_LINUX = HIFI_PLATFORM === 'linux';

/** mpv's own value for "follow the system default". */
const AUTO_DEVICE = 'auto';

type ListState = 'idle' | 'loading' | 'loaded';

export const HifiOutputGroup: React.FC = () => {
    const { t } = useTranslation();
    const settings = useHifiSettingsStore(useShallow(state => ({
        audioDevice: state.audioDevice,
        audioDeviceLabel: state.audioDeviceLabel,
        setAudioDevice: state.setAudioDevice,
        exclusive: state.exclusive,
        setExclusive: state.setExclusive,
        softwareVolume: state.softwareVolume,
        setSoftwareVolume: state.setSoftwareVolume,
        enabled: state.enabled,
    })));
    const devices = useHifiEngineStore(state => state.devices);
    const runtime = useHifiEngineStore(state => state.runtime);
    // Without the engine (a build whose preload has no HiFi) nothing here does anything; the palette asks the same.
    const supported = useHifiEngineStore(state => state.supported);
    // The engine store keeps the last list for the session, so a page opened again starts from it.
    const [listState, setListState] = useState<ListState>(() => (devices.length > 0 ? 'loaded' : 'idle'));
    const noMpv = runtime !== null && !runtime.available;

    const refresh = async () => {
        setListState('loading');
        await hifiEngine.listDevices();
        setListState('loaded');
    };

    const ensureLoaded = () => {
        if (listState === 'idle' && !noMpv) {
            void refresh();
        }
    };

    // The marker goes first: a long card name is cut off at the end in the narrow menu, and the
    // marker is what the device hint tells the listener to look for.
    const deviceLabel = (device: HifiDevice) => {
        const name = device.description || device.name;
        return IS_LINUX && device.direct ? `${t('hifi.settings.deviceDirect')} · ${name}` : name;
    };

    // mpv lists 'auto' itself; it is drawn once, first, under the app's own name.
    const listed = devices.filter(device => device.name !== AUTO_DEVICE);
    const options = [
        { value: AUTO_DEVICE, label: t('hifi.settings.deviceAuto') },
        ...listed.map(device => ({ value: device.name, label: deviceLabel(device) })),
    ];
    // Not read yet, or unplugged: the saved device still needs an entry so the list does not
    // look as if the default were in use.
    if (settings.audioDevice !== AUTO_DEVICE && !listed.some(device => device.name === settings.audioDevice)) {
        options.push({ value: settings.audioDevice, label: settings.audioDeviceLabel || settings.audioDevice });
    }

    const chooseDevice = (name: string) => {
        const device = listed.find(candidate => candidate.name === name);
        const label = name === AUTO_DEVICE ? '' : device?.description ?? (name === settings.audioDevice ? settings.audioDeviceLabel : '');
        settings.setAudioDevice(name, label);
    };

    const state = noMpv
        ? t('hifi.settings.devicesNeedMpv')
        : listState === 'loading'
            ? t('hifi.settings.devicesLoading')
            : listState === 'loaded' && listed.length === 0
                ? t('hifi.settings.devicesEmpty')
                : undefined;
    // On Linux, with nothing else to say, the hint points at the one choice that skips the sound server.
    const deviceHint = state ?? (IS_LINUX ? t('hifi.settings.deviceLinuxHint') : undefined);

    // The search asks the same (OUTPUT.available).
    if (!settings.enabled) return null;

    return (
        <Group def={OUTPUT}>
            <Row option={O.device} hint={deviceHint} note={IS_LINUX ? t('hifi.settings.deviceDirectNote') : undefined} disabled={!supported}>
                <Button icon={RefreshCw} tip={t('hifi.settings.devicesRefresh')} onClick={() => void refresh()} disabled={listState === 'loading' || noMpv} />
                <Select value={settings.audioDevice} options={options} onChange={chooseDevice} onOpen={ensureLoaded} />
            </Row>
            {!IS_LINUX && (
                <Row option={O.exclusive} hint={t('hifi.settings.exclusiveDesc')} disabled={!supported}>
                    <Toggle checked={settings.exclusive} onChange={settings.setExclusive} />
                </Row>
            )}
            <Row option={O.softwareVolume} hint={t('hifi.settings.softwareVolumeDesc')} disabled={!supported}>
                <Toggle checked={settings.softwareVolume} onChange={settings.setSoftwareVolume} />
            </Row>
            <HifiDsdRows />
        </Group>
    );
};

export default HifiOutputGroup;
