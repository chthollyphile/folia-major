import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '../../../src/types';
import { useOnlineProviderAccountStore } from '../../../src/stores/useOnlineProviderAccountStore';

// test/unit/onlineMusic/playbackReportGate.test.ts
// The gate is the second half of the risk-control story: even a tracker that somehow produced a
// burst of reports must not be able to send them at a rate no listener could produce.

const reportPlayback = vi.fn(async () => {});

// The providers of this build as the gate sees them: 'reports' takes listening reports, 'plain'
// does not, 'unconfigured' would but is not configured.
const providers = vi.hoisted(() => ({
    list: [
        { providerId: 'plain', availability: { configured: true }, reports: false },
        { providerId: 'reports', availability: { configured: true }, reports: true },
        { providerId: 'unconfigured', availability: { configured: false }, reports: true },
    ],
}));

vi.mock('../../../src/services/onlineMusic/omni', () => ({
    omni: {
        reportPlayback: (...args: unknown[]) => reportPlayback(...(args as [])),
        canReportPlayback: () => true,
        getProviderSummaries: () => providers.list,
        getProviderCapabilities: (providerId: string) => ({
            playbackReports: providers.list.find(provider => provider.providerId === providerId)!.reports,
        }),
    },
}));

const { MAX_REPORTS_PER_HOUR, MIN_REPORT_GAP_MS, isPlaybackReportReady, resetPlaybackReportGate, sendPlaybackReport } = await import(
    '../../../src/services/onlineMusic/playbackReportGate'
);

const song = {
    id: 1,
    name: 'Song',
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: '1' },
} as unknown as SongResult;

const report = { playedSeconds: 45, totalSeconds: 240 };

describe('whether listening reports can be turned on', () => {
    const signIn = (...providerIds: string[]) => useOnlineProviderAccountStore.setState({
        accounts: Object.fromEntries(providerIds.map(providerId => [providerId, { status: 'authenticated' }])) as never,
    });
    const songOf = (providerId: string) => ({ id: 1, sourceRef: { kind: 'online', providerId, mediaId: '1' } }) as unknown as SongResult;

    it('is yes only while the account of a provider that takes reports is signed in', () => {
        signIn();
        expect(isPlaybackReportReady()).toBe(false);
        signIn('plain', 'unconfigured');
        expect(isPlaybackReportReady()).toBe(false);
        signIn('reports');
        expect(isPlaybackReportReady()).toBe(true);
    });

    it('answers for the provider a song belongs to when given one', () => {
        signIn('plain', 'reports');
        expect(isPlaybackReportReady(songOf('reports'))).toBe(true);
        expect(isPlaybackReportReady(songOf('plain'))).toBe(false);
        expect(isPlaybackReportReady({ id: 1, sourceRef: { kind: 'local', mediaId: 'a' } } as unknown as SongResult)).toBe(false);
        signIn('plain');
        expect(isPlaybackReportReady(songOf('reports'))).toBe(false);
    });
});

describe('playback report gate', () => {
    beforeEach(() => {
        resetPlaybackReportGate();
        reportPlayback.mockClear();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('sends a report through to the owning provider', async () => {
        await expect(sendPlaybackReport(song, report, 0)).resolves.toBe(true);
        expect(reportPlayback).toHaveBeenCalledWith(song, report);
    });

    it('drops a second report that arrives faster than a listener could play', async () => {
        await sendPlaybackReport(song, report, 0);

        await expect(sendPlaybackReport(song, report, MIN_REPORT_GAP_MS - 1)).resolves.toBe(false);
        expect(reportPlayback).toHaveBeenCalledTimes(1);
    });

    it('allows the next report once the minimum gap has passed', async () => {
        await sendPlaybackReport(song, report, 0);

        await expect(sendPlaybackReport(song, report, MIN_REPORT_GAP_MS)).resolves.toBe(true);
        expect(reportPlayback).toHaveBeenCalledTimes(2);
    });

    it('stops at the hourly ceiling and resumes once the window rolls past', async () => {
        for (let index = 0; index < MAX_REPORTS_PER_HOUR; index += 1) {
            await sendPlaybackReport(song, report, index * MIN_REPORT_GAP_MS);
        }
        expect(reportPlayback).toHaveBeenCalledTimes(MAX_REPORTS_PER_HOUR);

        const stillInsideTheHour = MAX_REPORTS_PER_HOUR * MIN_REPORT_GAP_MS;
        await expect(sendPlaybackReport(song, report, stillInsideTheHour)).resolves.toBe(false);
        expect(reportPlayback).toHaveBeenCalledTimes(MAX_REPORTS_PER_HOUR);

        await expect(sendPlaybackReport(song, report, 60 * 60 * 1000 + 1)).resolves.toBe(true);
    });

    it('refuses a report while another one is still in flight', async () => {
        let release = () => {};
        reportPlayback.mockImplementationOnce(() => new Promise<void>(resolve => { release = () => resolve(); }));

        const first = sendPlaybackReport(song, report, 0);
        const second = await sendPlaybackReport(song, report, MIN_REPORT_GAP_MS);
        release();

        expect(second).toBe(false);
        await expect(first).resolves.toBe(true);
    });

    it('releases the slot when a request never settles, instead of wedging the session', async () => {
        vi.useFakeTimers();
        // A dead proxy: the transport has no timeout of its own, so this promise never settles.
        reportPlayback.mockImplementationOnce(() => new Promise<void>(() => {}));

        const wedged = sendPlaybackReport(song, report, 0);
        await vi.advanceTimersByTimeAsync(15_000);
        await expect(wedged).resolves.toBe(false);
        vi.useRealTimers();

        // The gate must still accept the next report rather than dropping it as "still in flight".
        await expect(sendPlaybackReport(song, report, MIN_REPORT_GAP_MS)).resolves.toBe(true);
    });

    it('reports a provider failure as a dropped record rather than throwing', async () => {
        reportPlayback.mockRejectedValueOnce(new Error('rejected'));

        await expect(sendPlaybackReport(song, report, 0)).resolves.toBe(false);
    });
});
