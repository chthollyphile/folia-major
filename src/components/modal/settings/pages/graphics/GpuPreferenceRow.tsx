import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { GPU_PREFERENCES, useDesktopSettingsStore, type GpuPreference } from '../../../../../stores/useDesktopSettingsStore';
import { Reveal, Row, Segmented, Value, type SettingsOptionDef } from '../../kit';

// src/components/modal/settings/pages/graphics/GpuPreferenceRow.tsx
// The 渲染显卡 row of the 性能与动效 page (Windows desktop only): the saved choice, the adapter
// Chromium renders on in this run, and a reminder that a changed choice waits for a restart.

type GpuPreferenceState = Awaited<ReturnType<NonNullable<NonNullable<Window['electron']>['getGpuPreferenceState']>>>;

const LABEL_KEYS: Record<GpuPreference, string> = {
    auto: 'options.gpuPreferenceAuto',
    'high-performance': 'options.gpuPreferenceHighPerformance',
    'low-power': 'options.gpuPreferenceLowPower',
};

export const GpuPreferenceRow: React.FC<{ option: SettingsOptionDef }> = ({ option }) => {
    const { t } = useTranslation();
    const { preference, setPreference } = useDesktopSettingsStore(useShallow(state => ({
        preference: state.gpuPreference,
        setPreference: state.handleSetGpuPreference,
    })));
    // What this run started with; it does not change until the app restarts.
    const [state, setState] = useState<GpuPreferenceState>(null);

    useEffect(() => {
        let cancelled = false;
        window.electron?.getGpuPreferenceState?.()
            .then(next => { if (!cancelled) setState(next); })
            .catch(error => console.warn('[GpuPreference] Reading the GPU state failed', error));
        return () => { cancelled = true; };
    }, []);

    const fromCommandLine = state?.source === 'command-line';
    const waitsForRestart = state !== null && !fromCommandLine && state.applied !== preference;

    return (
        <>
            <Row option={option} hint={t('options.gpuPreferenceHint')} note={t('options.gpuPreferenceDesc')}>
                <Segmented
                    value={preference}
                    options={GPU_PREFERENCES.map(value => ({ value, label: t(LABEL_KEYS[value]) }))}
                    onChange={setPreference}
                />
            </Row>
            <Reveal when={waitsForRestart}>
                <Row sub notice={t('options.gpuPreferenceRestartNotice')} />
            </Reveal>
            <Reveal when={fromCommandLine}>
                <Row sub notice={t('options.gpuPreferenceCommandLineNotice')} />
            </Reveal>
            {state?.activeGpu && (
                <Row sub label={t('options.gpuPreferenceActive')}>
                    <Value tip={state.activeGpu}>{state.activeGpu}</Value>
                </Row>
            )}
        </>
    );
};

export default GpuPreferenceRow;
