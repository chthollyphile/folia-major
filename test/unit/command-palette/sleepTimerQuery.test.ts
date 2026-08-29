import { describe, expect, it } from 'vitest';
import {
    parseSleepTimerQuery,
    SLEEP_TIMER_MAX_TOTAL_MINUTES,
} from '../../../src/components/command-palette/sleepTimerQuery';

// test/unit/command-palette/sleepTimerQuery.test.ts

describe('sleep timer command query', () => {
    it('treats a plain positive integer as minutes and enables the timer', () => {
        expect(parseSleepTimerQuery('30', 0)).toEqual({
            ok: true,
            action: 'enable',
            totalMinutes: 30,
        });
    });

    it('accepts on at either edge and normalizes its alias', () => {
        expect(parseSleepTimerQuery('--on 90', 0)).toMatchObject({ action: 'enable', totalMinutes: 90 });
        expect(parseSleepTimerQuery('90 --on', 0)).toMatchObject({ action: 'enable', totalMinutes: 90 });
        expect(parseSleepTimerQuery('--enable 90', 0)).toMatchObject({ action: 'enable', totalMinutes: 90 });
    });

    it('uses the configured duration for a bare on and accepts off aliases', () => {
        expect(parseSleepTimerQuery('--on', 75)).toEqual({ ok: true, action: 'enable', totalMinutes: 75 });
        expect(parseSleepTimerQuery('--off', 75)).toEqual({ ok: true, action: 'disable' });
        expect(parseSleepTimerQuery('--disable', 75)).toEqual({ ok: true, action: 'disable' });
    });

    it('rejects invalid, zero, fractional, and excessive minute values', () => {
        expect(parseSleepTimerQuery('--on abc', 0)).toMatchObject({ ok: false, code: 'invalid-minutes' });
        expect(parseSleepTimerQuery('--on 0', 0)).toMatchObject({ ok: false, code: 'invalid-minutes' });
        expect(parseSleepTimerQuery('--on 1.5', 0)).toMatchObject({ ok: false, code: 'invalid-minutes' });
        expect(parseSleepTimerQuery(`--on ${SLEEP_TIMER_MAX_TOTAL_MINUTES + 1}`, 0))
            .toMatchObject({ ok: false, code: 'minutes-out-of-range' });
    });

    it('rejects unknown, conflicting, and semantically unexpected options', () => {
        expect(parseSleepTimerQuery('--later 30', 0)).toMatchObject({
            ok: false,
            code: 'unknown-option',
            token: 'later',
        });
        expect(parseSleepTimerQuery('--on --off', 30)).toMatchObject({ ok: false, code: 'conflicting-options' });
        expect(parseSleepTimerQuery('--off 30', 30)).toMatchObject({ ok: false, code: 'unexpected-minutes' });
        expect(parseSleepTimerQuery('--on', 0)).toMatchObject({ ok: false, code: 'duration-required' });
    });
});
