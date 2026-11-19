import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ConfirmDialog from '../shared/ConfirmDialog';
import { setLyricHoldReason } from '../app/backgroundThrottling/backgroundLyricHoldStore';
import { holdGpuAnalysis } from '../../services/analysis/beatThisGpu';
import i18n from '../../i18n/config';
import { getStoredBoolean, setStoredBoolean } from '../../stores/storagePrimitives';
import { useAutomixSettingsStore } from '../../stores/useAutomixSettingsStore';
import { useThemeSettingsStore } from '../../stores/useThemeSettingsStore';
import { setStatusMessage } from '../../stores/useStatusMessageStore';
import { useVisualizerSettingsStore } from '../../stores/useVisualizerSettingsStore';
import { openPerfCheck } from './openPerfCheck';
import type { PerfCheckSettings } from './perfCheckTypes';

// src/components/perfCheck/PerfCheckOffer.tsx
// The performance check's half in the main window, mounted with the app's dialogs: the first time
// automix or 智能动感 (its 'on' setting, the one that analyses) is switched on, it offers the check
// once per device; the settings chosen in the check window arrive here, to be applied through the
// stores' own actions like any change made in the settings window; and while the check window is
// open this window holds its lyric animation and its GPU analysis, so the check measures the computer
// rather than both windows drawing and analysing at once.

/** Set once the check has been offered on this device, whatever the answer. */
export const PERF_CHECK_OFFERED_KEY = 'folia_perf_check_offered';

const applyChoice = (choice: PerfCheckSettings) => {
    const visualizer = useVisualizerSettingsStore.getState();
    visualizer.handleSetVisualizerFrameRate(choice.frameRate);
    visualizer.handleSetLyricRenderQuality({ scale: choice.scale, antialias: choice.antialias });
    console.info('[PerfCheck] applied', choice);
    setStatusMessage({ type: 'success', text: i18n.t('perfCheck.appliedNotice') });
};

const PerfCheckOffer: React.FC = () => {
    const { t } = useTranslation();
    const [offering, setOffering] = useState(false);
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);

    useEffect(() => window.electron?.onPerfCheckApply?.(applyChoice), []);

    useEffect(() => {
        const unsubscribe = window.electron?.onPerfCheckState?.(({ running }) => {
            console.info(`[PerfCheck] ${running ? 'holding' : 'releasing'} this window's lyric animation and GPU analysis for the check`);
            setLyricHoldReason('perfCheck', running);
            holdGpuAnalysis(running);
        });
        return () => {
            unsubscribe?.();
            setLyricHoldReason('perfCheck', false);
            holdGpuAnalysis(false);
        };
    }, []);

    useEffect(() => {
        if (!window.electron?.openPerfCheck || getStoredBoolean(PERF_CHECK_OFFERED_KEY, false)) return undefined;
        const offer = () => {
            if (getStoredBoolean(PERF_CHECK_OFFERED_KEY, false)) return;
            setStoredBoolean(PERF_CHECK_OFFERED_KEY, true);
            setOffering(true);
        };
        const stopAutomix = useAutomixSettingsStore.subscribe((state, previous) => {
            if (state.automixEnabled && !previous.automixEnabled) offer();
        });
        const stopSmartBeat = useVisualizerSettingsStore.subscribe((state, previous) => {
            if (state.smartBeat.mode === 'on' && previous.smartBeat.mode !== 'on') offer();
        });
        return () => {
            stopAutomix();
            stopSmartBeat();
        };
    }, []);

    return (
        <ConfirmDialog
            isOpen={offering}
            title={t('perfCheck.offerTitle')}
            description={t('perfCheck.offerDescription')}
            confirmText={t('perfCheck.offerConfirm')}
            cancelText={t('perfCheck.offerLater')}
            isDaylight={isDaylight}
            onConfirm={() => {
                setOffering(false);
                openPerfCheck();
            }}
            onClose={() => setOffering(false)}
        />
    );
};

export default PerfCheckOffer;
