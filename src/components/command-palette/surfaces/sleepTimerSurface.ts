import type { CommandPaletteSurface } from './types';
import { describeSleepTimerQuery, parseSleepTimerQuery } from '../sleepTimerQuery';

// src/components/command-palette/surfaces/sleepTimerSurface.ts

export const sleepTimerSurface: CommandPaletteSurface = {
    load: () => import('./SleepTimerSurfaceView'),
    useLiveQuery: true,
    mapProps: ({ context, query, setQuery, isDaylight, theme }) => {
        const configuredTotalMinutes = context.settings.sleepTimerHours * 60 + context.settings.sleepTimerMinutes;
        const queryResult = query.trim()
            ? parseSleepTimerQuery(query, configuredTotalMinutes)
            : null;
        const previewTotalMinutes = queryResult?.ok && queryResult.action === 'enable'
            ? queryResult.totalMinutes
            : null;
        return {
            isDaylight,
            theme,
            enabled: context.settings.sleepTimerEnabled,
            hours: previewTotalMinutes === null
                ? context.settings.sleepTimerHours
                : Math.floor(previewTotalMinutes / 60),
            minutes: previewTotalMinutes === null
                ? context.settings.sleepTimerMinutes
                : previewTotalMinutes % 60,
            deadlineMs: context.settings.sleepTimerDeadlineMs,
            queryFeedback: queryResult
                ? describeSleepTimerQuery(queryResult, context.shared.t)
                : null,
            onEnabledChange: (enabled: boolean) => {
                if (enabled && previewTotalMinutes !== null) {
                    context.settings.setSleepTimerHours(Math.floor(previewTotalMinutes / 60));
                    context.settings.setSleepTimerMinutes(previewTotalMinutes % 60);
                }
                setQuery('');
                context.settings.setSleepTimerEnabled(enabled);
            },
            onHoursChange: (hours: number) => {
                setQuery('');
                context.settings.setSleepTimerHours(hours);
            },
            onMinutesChange: (minutes: number) => {
                setQuery('');
                context.settings.setSleepTimerMinutes(minutes);
            },
        };
    },
};
