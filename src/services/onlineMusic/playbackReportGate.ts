import type { SongResult } from '../../types';
import type { OmniPlaybackReport, OmniProviderId } from '../../types/onlineMusic';
import { getPlaybackSourceRef } from '../../utils/appPlaybackGuards';
import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';
import { omni } from './omni';

// src/services/onlineMusic/playbackReportGate.ts
// The last thing between a listening report and the user's account.
//
// A listening report is a write to a real music account, and a burst of implausible ones is what
// trips a provider's risk control. The tracker upstream already refuses to count audio that was not
// played; this refuses to SEND at a rate no listener could produce, whatever the tracker believed.

/** No listener finishes two songs inside this. A second report that soon is a bug, not a listen. */
export const MIN_REPORT_GAP_MS = 5000;

/** An hour of back-to-back two-minute tracks is 30. Twice that is already generous. */
export const MAX_REPORTS_PER_HOUR = 60;

/**
 * How long a report may stay in flight before the gate stops waiting for it.
 *
 * A provider's transport may have no timeout of its own, so a dead proxy, a sleeping serverless backend
 * or a black-holing firewall leaves the request pending forever. Without a deadline `inFlight` would
 * never clear and every later report in the session would be dropped as "still in flight" - the
 * feature would switch itself off silently. Losing the race does not cancel the request; it only
 * gives up the slot, which is the part that must not leak.
 */
const REPORT_TIMEOUT_MS = 15_000;

const HOUR_MS = 60 * 60 * 1000;

// In memory only: restarting the app clears the hourly window. Persisting it would buy little,
// since every report still needs 30 seconds of real audio behind it, but the ceiling is a guard
// against bursts within a session rather than a durable quota.
let recentReportTimes: number[] = [];
let inFlight = false;

export const resetPlaybackReportGate = (): void => {
    recentReportTimes = [];
    inFlight = false;
};

type Accounts = ReturnType<typeof useOnlineProviderAccountStore.getState>['accounts'];

/** The providers that take a listening report: registered, declaring the capability, configured on this build. */
const reportingProviderIds = (): OmniProviderId[] => omni.getProviderSummaries()
    .filter(provider => provider.availability.configured && omni.getProviderCapabilities(provider.providerId).playbackReports)
    .map(provider => provider.providerId);

// With a song, only the song's own provider is asked.
const isReadyIn = (accounts: Accounts, song?: SongResult): boolean => {
    const source = song ? getPlaybackSourceRef(song) : null;
    return reportingProviderIds().some(providerId => (
        (!source || (source.kind === 'online' && source.providerId === providerId))
        && accounts[providerId]?.status === 'authenticated'
    ));
};

/**
 * A provider takes listening reports AND its account is signed in. Anonymous reports mean nothing
 * to an account feature, so the settings panel and the command palette both gate on this - through
 * this one function, so neither can offer a state the other refuses. Given a song, the answer is
 * for the provider that song belongs to.
 */
export const isPlaybackReportReady = (song?: SongResult): boolean => (
    isReadyIn(useOnlineProviderAccountStore.getState().accounts, song)
);

/** The same answer for a component: it follows an account signing in or out while it is shown. */
export const usePlaybackReportReady = (): boolean => useOnlineProviderAccountStore(state => isReadyIn(state.accounts));

/**
 * Sends one report if the rate allows it. Returns whether it was sent.
 *
 * Dropping is deliberately silent to the listener and loud in the console: the feature is a
 * background courtesy, and failing it must never cost more than the record it dropped.
 */
export const sendPlaybackReport = async (
    song: SongResult,
    report: OmniPlaybackReport,
    nowMs = Date.now(),
): Promise<boolean> => {
    if (inFlight) {
        console.warn('[Scrobble] dropped a listening report: another one is still in flight');
        return false;
    }

    recentReportTimes = recentReportTimes.filter(time => nowMs - time < HOUR_MS);
    const lastReportTime = recentReportTimes[recentReportTimes.length - 1];
    if (lastReportTime !== undefined && nowMs - lastReportTime < MIN_REPORT_GAP_MS) {
        console.warn('[Scrobble] dropped a listening report: reports are arriving faster than a listener could play');
        return false;
    }
    if (recentReportTimes.length >= MAX_REPORTS_PER_HOUR) {
        console.warn(`[Scrobble] dropped a listening report: over ${MAX_REPORTS_PER_HOUR} reports in the last hour`);
        return false;
    }

    // Counted before the request rather than after it, so a slow or failing endpoint cannot be
    // retried into a burst - a dropped record is always cheaper than a flagged account.
    recentReportTimes.push(nowMs);
    inFlight = true;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            omni.reportPlayback(song, report),
            new Promise<never>((_resolve, reject) => {
                deadline = setTimeout(
                    () => reject(new Error(`listening report timed out after ${REPORT_TIMEOUT_MS}ms`)),
                    REPORT_TIMEOUT_MS,
                );
            }),
        ]);
        const source = getPlaybackSourceRef(song);
        console.log('[Scrobble] reported a play', {
            provider: source.kind === 'online' ? source.providerId : source.kind,
            id: source.kind === 'online' ? source.mediaId : null,
            seconds: report.playedSeconds,
        });
        return true;
    } catch (error) {
        console.warn('[Scrobble] listening report failed', error);
        return false;
    } finally {
        clearTimeout(deadline);
        inFlight = false;
    }
};
