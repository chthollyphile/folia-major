import { parseCommandQuery } from './syntax/parse';
import type { CommandSyntaxSpec } from './syntax/types';

// src/components/command-palette/sleepTimerQuery.ts
// Parses and validates the sleep timer's one-shot `--on` / `--off` command input.

export const SLEEP_TIMER_MAX_TOTAL_MINUTES = 999 * 60 + 59;

export const SLEEP_TIMER_SYNTAX_SPEC: CommandSyntaxSpec = {
    flags: [
        { name: 'on', aliases: ['enable'] },
        { name: 'off', aliases: ['disable'] },
    ],
    facets: [],
};

export type SleepTimerQueryErrorCode =
    | 'unknown-option'
    | 'conflicting-options'
    | 'invalid-minutes'
    | 'minutes-out-of-range'
    | 'unexpected-minutes'
    | 'duration-required';

export type SleepTimerQueryResult =
    | { ok: true; action: 'enable'; totalMinutes: number }
    | { ok: true; action: 'disable' }
    | { ok: false; code: SleepTimerQueryErrorCode; token?: string };

const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;
const OPTION_TOKEN_PATTERN = /(?:^|\s)--([a-z-]+)/i;

const findUnexpectedOption = (text: string) => {
    const match = OPTION_TOKEN_PATTERN.exec(text);
    return match?.[1]?.toLowerCase() ?? null;
};

// The shared parser owns flag placement and aliases; this wrapper supplies the timer's strict
// positional-minute rules and rejects any second option left in the free-text portion.
export const parseSleepTimerQuery = (
    input: string,
    configuredTotalMinutes: number,
): SleepTimerQueryResult => {
    const parsed = parseCommandQuery(SLEEP_TIMER_SYNTAX_SPEC, input);
    if (parsed.flagDraft !== null) {
        return { ok: false, code: 'unknown-option', token: parsed.flagDraft };
    }

    const unexpectedOption = findUnexpectedOption(parsed.text);
    if (unexpectedOption) {
        if ((parsed.flag === 'on' && unexpectedOption === 'off')
            || (parsed.flag === 'off' && unexpectedOption === 'on')) {
            return { ok: false, code: 'conflicting-options' };
        }
        return { ok: false, code: 'unknown-option', token: unexpectedOption };
    }

    const minuteTokens = parsed.text ? parsed.text.split(' ') : [];
    if (parsed.flag === 'off') {
        return minuteTokens.length > 0
            ? { ok: false, code: 'unexpected-minutes' }
            : { ok: true, action: 'disable' };
    }

    if (minuteTokens.length === 0) {
        return configuredTotalMinutes > 0
            ? { ok: true, action: 'enable', totalMinutes: configuredTotalMinutes }
            : { ok: false, code: 'duration-required' };
    }

    if (minuteTokens.length !== 1 || !POSITIVE_INTEGER_PATTERN.test(minuteTokens[0])) {
        return { ok: false, code: 'invalid-minutes' };
    }

    const totalMinutes = Number(minuteTokens[0]);
    if (!Number.isSafeInteger(totalMinutes) || totalMinutes > SLEEP_TIMER_MAX_TOTAL_MINUTES) {
        return { ok: false, code: 'minutes-out-of-range' };
    }

    return { ok: true, action: 'enable', totalMinutes };
};

type Translate = (key: string, fallback?: string) => string;

export const describeSleepTimerQuery = (
    result: SleepTimerQueryResult,
    t: Translate,
): { isError: boolean; text: string } => {
    if (result.ok) {
        if (result.action === 'disable') {
            return {
                isError: false,
                text: t('commandPalette.sleepTimerOffPreview', 'Press Enter to cancel the sleep timer'),
            };
        }
        return {
            isError: false,
            text: t('commandPalette.sleepTimerSetPreview', 'Start a {{minutes}} min timer')
                .replace('{{minutes}}', String(result.totalMinutes)),
        };
    }

    const messages: Record<SleepTimerQueryErrorCode, [string, string]> = {
        'unknown-option': ['commandPalette.sleepTimerUnknownOption', 'Unknown option --{{option}}'],
        'conflicting-options': ['commandPalette.sleepTimerConflictingOptions', '--on and --off cannot be used together'],
        'invalid-minutes': ['commandPalette.sleepTimerInvalidMinutes', 'Minutes must be one positive integer'],
        'minutes-out-of-range': ['commandPalette.sleepTimerMinutesOutOfRange', 'Minutes must be between 1 and {{max}}'],
        'unexpected-minutes': ['commandPalette.sleepTimerUnexpectedMinutes', '--off does not accept a duration'],
        'duration-required': ['commandPalette.sleepTimerDurationRequired', 'Enter minutes before turning the timer on'],
    };
    const [key, fallback] = messages[result.code];
    return {
        isError: true,
        text: t(key, fallback)
            .replace('{{option}}', result.token ?? '')
            .replace('{{max}}', String(SLEEP_TIMER_MAX_TOTAL_MINUTES)),
    };
};
