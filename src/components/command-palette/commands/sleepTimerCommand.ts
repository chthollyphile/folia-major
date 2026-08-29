import { Timer } from 'lucide-react';
import { defineCommand } from '../commandFactories';
import { describeSleepTimerQuery, parseSleepTimerQuery, SLEEP_TIMER_SYNTAX_SPEC } from '../sleepTimerQuery';
import { sleepTimerSurface } from '../surfaces/sleepTimerSurface';
import type { CommandPaletteCommand } from '../types';

// src/components/command-palette/commands/sleepTimerCommand.ts

export const sleepTimerCommand: CommandPaletteCommand = defineCommand({
    id: 'sleep-timer',
    group: 'settings',
    title: 'Sleep timer',
    description: 'Pause playback after a chosen duration, or close the desktop app',
    keywords: ['sleep timer', 'auto close', 'auto quit', 'shutdown timer', '定时关闭', '睡眠定时', '自动关闭', '到时关闭', '倒计时退出', 'dingshiguanbi', 'shuimiandingshi', 'zidongguanbi', 'daoshiguanbi', 'dsgb', 'smds', 'zdgb'],
    icon: Timer,
    surface: sleepTimerSurface,
    syntax: SLEEP_TIMER_SYNTAX_SPEC,
    placeholder: context => context.shared.t('commandPalette.sleepTimerInputPlaceholder', 'Enter minutes, --on, or --off'),
    requiresInput: true,
    getPreview: (input, context) => {
        const configuredTotalMinutes = context.settings.sleepTimerHours * 60 + context.settings.sleepTimerMinutes;
        return describeSleepTimerQuery(
            parseSleepTimerQuery(input, configuredTotalMinutes),
            context.shared.t,
        ).text;
    },
    execute: (input, context) => {
        const configuredTotalMinutes = context.settings.sleepTimerHours * 60 + context.settings.sleepTimerMinutes;
        const result = parseSleepTimerQuery(input, configuredTotalMinutes);
        if (!result.ok) {
            context.shared.setStatusMsg({
                type: 'error',
                text: describeSleepTimerQuery(result, context.shared.t).text,
            });
            return false;
        }

        if (result.action === 'disable') {
            context.settings.setSleepTimerEnabled(false);
            return true;
        }

        context.settings.setSleepTimerHours(Math.floor(result.totalMinutes / 60));
        context.settings.setSleepTimerMinutes(result.totalMinutes % 60);
        context.settings.setSleepTimerEnabled(true);
        return true;
    },
});
