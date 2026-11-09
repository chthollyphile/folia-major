import React from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useHifiEngineStore } from '../../../../../services/hifi/hifiEngine';
import { useHifiSettingsStore } from '../../../../../stores/useHifiSettingsStore';
import type { HifiDsdMode } from '../../../../../types/hifi';
import { Reveal, Row, Segmented, Status } from '../../kit';
import { HIFI_PLATFORM, O } from './options';

// src/components/modal/settings/pages/hifi/HifiDsdRows.tsx
// The DSD rows of the mpv output group: convert DSD to PCM, or send it as DoP. Drawn only on Windows
// (WASAPI exclusive, mpv newer than 0.41.0), where DoP works, or where a DoP choice was saved, so it
// can be switched back; elsewhere DSD is always converted. The warning about DACs without DoP stays
// whichever is chosen: such a DAC plays DoP as a hiss instead of the music.

const IS_WINDOWS = HIFI_PLATFORM === 'win32';

type Line = { tone: 'ok' | 'warn'; key: string };

export const HifiDsdRows: React.FC = () => {
    const { t } = useTranslation();
    const settings = useHifiSettingsStore(useShallow(state => ({
        dsdMode: state.dsdMode,
        setDsdMode: state.setDsdMode,
        exclusive: state.exclusive,
    })));
    // null until the runtime has been asked for.
    const dopCapable = useHifiEngineStore(state => state.runtime?.dopCapable ?? null);
    const supported = useHifiEngineStore(state => state.supported);
    const isDop = settings.dsdMode === 'dop';

    const options: ReadonlyArray<{ value: HifiDsdMode; label: string; disabled?: boolean }> = [
        { value: 'pcm', label: t('hifi.settings.dsdPcm') },
        // A DoP choice saved elsewhere stays selectable, so it can be seen and switched back.
        { value: 'dop', label: t('hifi.settings.dsdDop'), disabled: !IS_WINDOWS && !isDop },
    ];

    // What stands between the choice and DoP actually reaching the DAC.
    const lines: Line[] = [];
    if (IS_WINDOWS && dopCapable !== null) {
        lines.push(dopCapable ? { tone: 'ok', key: 'hifi.settings.dopCapable' } : { tone: 'warn', key: 'hifi.settings.dopNotCapable' });
    }
    if (isDop && !IS_WINDOWS) {
        lines.push({ tone: 'warn', key: 'hifi.settings.dopNotOnThisSystem' });
    }
    // Only Windows can turn exclusive mode into DoP; elsewhere the line above already says DoP is not
    // there, and Linux has no exclusive switch to point at.
    if (isDop && IS_WINDOWS && !settings.exclusive) {
        lines.push({ tone: 'warn', key: 'hifi.settings.dopNeedsExclusive' });
    }

    // The search asks the same (O.dsdMode.available).
    if (!IS_WINDOWS && !isDop) return null;

    return (
        <>
            <Row option={O.dsdMode} hint={t('hifi.settings.dsdModeDesc')} disabled={!supported}>
                <Segmented value={settings.dsdMode} options={options} onChange={settings.setDsdMode} />
            </Row>
            <Row sub notice={t('hifi.settings.dopWarning')} />
            <Reveal when={lines.length > 0}>
                {lines.map(line => (
                    <Row key={line.key} sub label={<Status tone={line.tone}>{t(line.key)}</Status>} />
                ))}
            </Reveal>
        </>
    );
};

export default HifiDsdRows;
