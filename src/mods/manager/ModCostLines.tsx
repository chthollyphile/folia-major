import React from 'react';
import { useTranslation } from 'react-i18next';
import { FOLIUM_START_LIMIT_MS } from '../runtime/clientLoader';
import type { ModCost } from './modCost';

// src/mods/manager/ModCostLines.tsx
// What a mod costs, as the lines of its expanded row, and the "slow" mark both
// the row's head and those lines carry. The numbers come from modCost.ts.

/** The mark for a mod that is slow. It says so and nothing more: Folia switches nothing off for it. */
export const ModSlowMark: React.FC<{ isDaylight: boolean }> = ({ isDaylight }) => {
    const { t } = useTranslation();
    return (
        <span
            title={t('mods.cost.slowHint')}
            className={`shrink-0 rounded px-1 py-px text-[10px] font-medium leading-tight ${
                isDaylight ? 'bg-amber-500/15 text-amber-700' : 'bg-amber-400/15 text-amber-300'
            }`}
        >
            {t('mods.cost.slow')}
        </span>
    );
};

export const ModCostLines: React.FC<{ cost: ModCost; isDaylight: boolean }> = ({ cost, isDaylight }) => {
    const { t } = useTranslation();
    const line = (key: string, text: string, slow = false) => (
        <div key={key} className="flex items-center gap-1.5">
            <span className="opacity-75">{text}</span>
            {slow ? <ModSlowMark isDaylight={isDaylight} /> : null}
        </div>
    );
    // A mod without a client running in this window has no start and no running time to speak of.
    const { start } = cost;
    const startText = (() => {
        if (!start) return '';
        // A start that threw has no time to show: it did not get to its end.
        if (start.state === 'failed') return t('mods.cost.startFailed');
        if (start.state === 'starting') {
            // Past the limit it is slow, not failed: the same words as the notice.
            return start.late
                ? t('mods.cost.startLate', { seconds: FOLIUM_START_LIMIT_MS / 1000 })
                : t('mods.cost.startPending');
        }
        // Two decimals are shown; a start shorter than that would read "0.00".
        return start.ms < 10 ? t('mods.cost.startQuick') : t('mods.cost.start', { seconds: (start.ms / 1000).toFixed(2) });
    })();
    return (
        <div className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--text-primary)' }}>
            <div className="font-medium opacity-50">{t('mods.cost.title')}</div>
            {start ? line('start', startText, cost.slowStart) : null}
            {start ? line(
                'running',
                cost.runningMs === null
                    ? t('mods.cost.runningNone')
                    // One decimal is shown; less than that would read "0.0".
                    : cost.runningMs < 0.1
                        ? t('mods.cost.runningQuick')
                        : t('mods.cost.running', { ms: cost.runningMs.toFixed(1) }),
                cost.slowRunning,
            ) : null}
            {cost.main ? line(
                'main',
                t('mods.cost.main', { total: cost.main.totalMs, longest: cost.main.longestMs }),
                cost.slowMain,
            ) : null}
            {line(
                'failures',
                cost.failures === 0 ? t('mods.cost.noFailures') : t('mods.cost.failures', { count: cost.failures, places: cost.failurePlaces }),
            )}
        </div>
    );
};
