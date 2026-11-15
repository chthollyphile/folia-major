import type { TFunction } from 'i18next';
import type { PerfCheckSettings } from './perfCheckTypes';

// src/components/perfCheck/perfCheckText.ts
// How the check names a set of settings, the same in its progress card and its results.

/** The three settings as short labels: frame-rate cap, canvas resolution as a percentage, anti-aliasing. */
export const settingLabels = (t: TFunction, settings: PerfCheckSettings): string[] => [
    settings.frameRate === 'off' ? t('perfCheck.frameRateOff') : t('perfCheck.frameRateCap', { fps: settings.frameRate }),
    t('perfCheck.scale', { percent: Math.round(settings.scale * 100) }),
    t(`perfCheck.antialias_${settings.antialias}`),
];

/** The three labels in one line. */
export const settingsLine = (t: TFunction, settings: PerfCheckSettings): string => settingLabels(t, settings).join(t('perfCheck.listSeparator'));
