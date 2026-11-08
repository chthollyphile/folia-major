import { readdir, readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listOnlineMusicProviders } from '@/services/onlineMusic/providerRegistry';
import { OnlineProviderError } from '@/types/onlineMusic';
import type { OnlineFailureDetail, ProviderErrorCode } from '@/types/onlineMusic';
import {
    ONLINE_FAILURE_CASE_IDS, autoRetryDelaysMs, logOnlineFailure, mediaFailureOf, noteOnlineFailure, offersRetry, onlineFailureOf, stopsPlayback,
} from '@/services/onlineMusic/failure/onlineFailureCase';
import { OnlineRequestTimeout } from '@/services/onlineMusic/failure/onlineRequestLimit';

// test/unit/onlineMusic/onlineFailureCase.test.ts
// The shared half of "why did this song or this playlist fail": the rules that sort the facts, their
// order, what is kept out of a fact, a media element's failure, and that the folder knows no platform.
// What each platform's own errors sort to is in onlineFailurePlatforms.test.ts.

const audio = (detail?: OnlineFailureDetail, error?: unknown) => onlineFailureOf({ operation: 'audio', providerId: 'netease' }, { detail, error });
const caseOf = (detail?: OnlineFailureDetail, code?: ProviderErrorCode) => (
    audio(detail, code ? new OnlineProviderError(code, 'x') : undefined).case
);

describe('the rules, in their order', () => {
    it('takes a refusal in the shared code before anything the provider said', () => {
        expect(caseOf({ case: 'refused', httpStatus: 500 }, 'auth-required')).toBe('sign-in-needed');
        expect(caseOf({ case: 'unknown' }, 'subscription-required')).toBe('subscription-required');
        expect(caseOf({}, 'preview-only')).toBe('preview-only');
        expect(caseOf({}, 'region-restricted')).toBe('region-restricted');
        expect(caseOf({}, 'not-public')).toBe('not-public');
    });

    it('takes a case the provider named next; a name not in the table is unknown', () => {
        expect(caseOf({ case: 'local-service-stopped', httpStatus: 429 }, 'network')).toBe('local-service-stopped');
        expect(caseOf({ case: 'gone' as never, code: '404' })).toBe('unknown');
    });

    it('then a wait the platform asked for or 429, 5xx, other 4xx', () => {
        expect(caseOf({ retryAfterMs: 30_000 })).toBe('retry-later');
        expect(caseOf({ httpStatus: 429 })).toBe('retry-later');
        expect(caseOf({ httpStatus: 503, code: '503' })).toBe('unreachable');
        expect(caseOf({ httpStatus: 403 }, 'network')).toBe('refused');
    });

    it('then a network error, no audio, the platform\'s words, and nothing to go by', () => {
        expect(caseOf({}, 'network')).toBe('unreachable');
        expect(caseOf({ code: '20018' }, 'not-playable')).toBe('no-audio');
        expect(caseOf({ code: '-462' })).toBe('refused');
        expect(caseOf({ message: '操作频繁' })).toBe('refused');
        expect(caseOf({}, 'invalid-response')).toBe('unknown');
        expect(audio(undefined, new Error('Failed to fetch')).case).toBe('unknown');
        expect(audio().case).toBe('unknown');
    });

    it('sorts a source that came back empty as no audio, with nothing to quote', () => {
        expect(audio({ case: 'no-audio' })).toEqual({ case: 'no-audio', operation: 'audio', providerId: 'netease', facts: { case: 'no-audio' } });
    });
});

describe('the facts', () => {
    it('keeps the words a platform said and its codes, and drops a status that is not a whole number', () => {
        expect(audio({ message: 'uin 2873651094 at 203.0.113.7' }).facts.message).toBe('uin 2873651094 at 203.0.113.7');
        expect(audio({ code: '800', upstreamCode: '50006', httpStatus: 50.5, retryAfterMs: -1 }).facts).toEqual({ code: '800', upstreamCode: '50006' });
        expect(audio(undefined, new OnlineProviderError('a code a mod made up' as 'network', 'x')).facts).toEqual({ errorCode: 'a code a mod made up' });
        expect(audio(undefined, new OnlineProviderError({} as never, 'x')).facts).toEqual({});
    });

    it('reads a provider\'s note only from the error it was noted on', () => {
        const noted = new Error('a');
        noteOnlineFailure(noted, { case: 'local-service-stopped' });
        expect(audio(undefined, noted).case).toBe('local-service-stopped');
        expect(audio(undefined, new Error('a')).case).toBe('unknown');
        // A detail handed over directly wins over the note.
        expect(audio({ case: 'no-audio' }, noted).case).toBe('no-audio');
        noteOnlineFailure('not an object', { case: 'refused' });
        noteOnlineFailure(new Error('b'), null);
    });
});

describe('a media element that cannot play an online song', () => {
    it('is unreachable for MediaError 2 and unplayable for 3, 4 or no code', () => {
        expect(mediaFailureOf({ code: 2, message: 'net::ERR' }, 'qq')).toEqual({ case: 'unreachable', operation: 'media', providerId: 'qq', facts: { code: '2', message: 'net::ERR' } });
        expect(mediaFailureOf({ code: 3 }).case).toBe('audio-unplayable');
        expect(mediaFailureOf({ code: 4 }).case).toBe('audio-unplayable');
        expect(mediaFailureOf(null)).toEqual({ case: 'audio-unplayable', operation: 'media', facts: {} });
    });

    it('keeps the browser\'s own words', () => {
        expect(mediaFailureOf({ code: 4, message: 'Format error at https://cdn.example.com/a.mp3' }).facts.message).toBe('Format error at https://cdn.example.com/a.mp3');
    });
});

describe('the table', () => {
    it('stops playback for exactly the refusals the listener can act on, and a platform not configured here', () => {
        const stopping = ONLINE_FAILURE_CASE_IDS.filter(id => stopsPlayback(audio({ case: id })));
        expect(stopping.sort()).toEqual([
            'account-refused', 'entitlement-required', 'not-configured', 'preview-only', 'purchase-required', 'region-restricted', 'sign-in-needed', 'subscription-required',
        ]);
    });

    it('counts down past the refusals of only this song once 「无法播放时自动跳过」 is on, not past a sign-in or a platform not configured', () => {
        const stopping = ONLINE_FAILURE_CASE_IDS.filter(id => stopsPlayback(audio({ case: id }), true));
        expect(stopping.sort()).toEqual(['account-refused', 'not-configured', 'sign-in-needed']);
    });

    it('asks again by itself only where the platform could not be reached, once where the request ran out of time', () => {
        expect(autoRetryDelaysMs(audio({ case: 'unreachable' }))).toEqual([1000, 3000]);
        expect(autoRetryDelaysMs(audio(undefined, new OnlineRequestTimeout(60_000)))).toEqual([2000]);
        expect(ONLINE_FAILURE_CASE_IDS.filter(id => autoRetryDelaysMs(audio({ case: id })).length > 0)).toEqual(['unreachable']);
    });

    it('offers a retry where asking again may help', () => {
        const retrying = ONLINE_FAILURE_CASE_IDS.filter(id => offersRetry(audio({ case: id })));
        expect(retrying.sort()).toEqual(['local-service-stopped', 'refused', 'unknown', 'unreachable']);
    });
});

describe('the line for maintainers', () => {
    afterEach(() => vi.restoreAllMocks());

    it('holds the case, the platform, the facts, and after them the thrown error itself', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const thrown = new Error('GET https://music.example.com/song/url failed');
        logOnlineFailure(audio({ code: '-462', message: 'risk 203.0.113.7', httpStatus: 200 }), thrown);
        expect(warn).toHaveBeenCalledOnce();
        const [head, fields, error] = warn.mock.calls[0];
        expect(head).toBe('[OnlineFailure] audio netease refused');
        expect(fields).toMatchObject({ operation: 'audio', provider: 'netease', case: 'refused', code: '-462', message: 'risk 203.0.113.7', httpStatus: 200 });
        // The error goes on whole: the session log records its stack.
        expect(error).toBe(thrown);
        logOnlineFailure(audio({ code: '-462' }));
        expect(warn.mock.calls[1]).toHaveLength(2);
    });
});

describe('the shared folder knows no platform', () => {
    // One platform's rule stays with the platform: what a platform's own code means is said in its folder.
    it('names no built-in platform and imports nothing from a platform', async () => {
        const ids = listOnlineMusicProviders().map(provider => provider.id);
        expect(ids.length).toBeGreaterThanOrEqual(6);
        const folder = 'src/services/onlineMusic/failure';
        const files = await readdir(folder);
        expect(files.length).toBeGreaterThanOrEqual(2);
        const imports: string[] = [];
        for (const name of files) {
            const source = await readFile(`${folder}/${name}`, 'utf8');
            const named = ids.filter(id => new RegExp(`(?<![A-Za-z])${id}(?![a-z])`, 'i').test(source));
            expect(named, name).toEqual([]);
            expect(source, name).not.toMatch(/网易|酷狗|波点|QQ|Spotify|YouTube/i);
            imports.push(...[...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(match => match[1]));
        }
        expect(imports.length).toBeGreaterThan(0);
        expect(imports.filter(path => /services|onlineMusic\/[a-z]+\//i.test(path))).toEqual([]);
    });
});
