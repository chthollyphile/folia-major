import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// test/unit/appleMusic/companionStorefront.test.ts
// MusicKit takes its storefront from the page, and a page in another region than the account's
// plays only previews: the page moves to the account's region, or MusicKit follows it in place.

const require = createRequire(import.meta.url);
const { storefrontTarget, pageStorefront, alignStorefront } = require('../../../electron/appleMusic/companionStorefront.cjs') as {
    storefrontTarget: (currentUrl: unknown, storefront: unknown) => string | null;
    pageStorefront: (address: unknown) => string | null;
    alignStorefront: (mk: unknown) => Promise<void>;
};

// MusicKit's PlaybackMode, as the web page exposes it.
const PlaybackMode = { PREVIEW_ONLY: 0, MIXED_CONTENT: 1, FULL_PLAYBACK_ONLY: 2 };
// A signed-in player the web app put in `page`'s region, for an account in `account`'s.
const player = (page: string, account: string, subscribed: unknown = Promise.resolve(true)) => ({
    isAuthorized: true,
    storefrontId: page,
    storefrontCountryCode: account,
    playbackMode: page === account ? PlaybackMode.MIXED_CONTENT : PlaybackMode.PREVIEW_ONLY,
    hasMusicSubscription: vi.fn(() => subscribed),
});
// Runs the page function as the companion does: serialized, inside a page with its own window.
const pageWith = (timers: Record<string, unknown> = { setTimeout, clearTimeout }) => {
    const window: Record<string, unknown> = { MusicKit: { PlaybackMode } };
    return {
        window,
        align: (mk: unknown) => runInNewContext(`(${alignStorefront.toString()})(mk)`, { mk, window, ...timers }) as Promise<void>,
    };
};

describe('following the account storefront', () => {
    it('moves a page in another region to the account storefront', () => {
        expect(storefrontTarget('https://music.apple.com/cn/browse', 'us')).toBe('https://music.apple.com/us/');
        expect(storefrontTarget('https://music.apple.com/', 'gb')).toBe('https://music.apple.com/gb/');
    });

    it('leaves a page already on that storefront, and anything that is not the music page', () => {
        expect(storefrontTarget('https://music.apple.com/us/browse', 'us')).toBeNull();
        expect(storefrontTarget('https://example.com/us/browse', 'us')).toBeNull();
        expect(storefrontTarget('not a url', 'us')).toBeNull();
    });

    it('takes only a two-letter storefront code', () => {
        expect(storefrontTarget('https://music.apple.com/cn/', 'US')).toBeNull();
        expect(storefrontTarget('https://music.apple.com/cn/', 'usa')).toBeNull();
        expect(storefrontTarget('https://music.apple.com/cn/', null)).toBeNull();
    });
});

describe('the region a music page is in', () => {
    it('reads the two-letter region from a music page address only', () => {
        expect(pageStorefront('https://music.apple.com/cn/new')).toBe('cn');
        expect(pageStorefront('https://music.apple.com/us/album/x/1')).toBe('us');
        expect(pageStorefront('https://music.apple.com/')).toBeNull();
        expect(pageStorefront('https://music.apple.com/library/songs')).toBeNull();
        expect(pageStorefront('https://example.com/us/')).toBeNull();
        expect(pageStorefront('about:blank')).toBeNull();
    });
});

// From a mainland address Apple sends every page outside /cn back to /cn, so a page cannot always
// follow the account: MusicKit has to play in the account's region where it is (#1150, #1151).
describe('playing in the account region on a page kept in another', () => {
    it('points MusicKit at the account region and lifts previews for a subscriber', async () => {
        const mk = player('cn', 'us');
        const page = pageWith();
        await page.align(mk);
        expect(mk.storefrontId).toBe('us');
        expect(mk.playbackMode).toBe(PlaybackMode.MIXED_CONTENT);
        // The web app may choose previews again; the next start lifts them without asking again.
        mk.playbackMode = PlaybackMode.PREVIEW_ONLY;
        await page.align(mk);
        expect(mk.playbackMode).toBe(PlaybackMode.MIXED_CONTENT);
        expect(mk.hasMusicSubscription).toHaveBeenCalledOnce();
    });

    it('keeps previews for an account without a subscription, and asks once per page', async () => {
        const mk = player('cn', 'tr', Promise.resolve(false));
        const page = pageWith();
        await page.align(mk);
        await page.align(mk);
        expect(mk.storefrontId).toBe('tr');
        expect(mk.playbackMode).toBe(PlaybackMode.PREVIEW_ONLY);
        expect(mk.hasMusicSubscription).toHaveBeenCalledOnce();
    });

    it('leaves previews when the subscription does not answer in time, and keeps the late answer for the next start', async () => {
        let answer!: (value: boolean) => void;
        const mk = player('cn', 'us', new Promise(done => { answer = done; }));
        // The page's three seconds pass at the next turn.
        const page = pageWith({ setTimeout: (run: () => void) => setTimeout(run, 0), clearTimeout });
        await page.align(mk);
        expect(mk.storefrontId).toBe('us');
        expect(mk.playbackMode).toBe(PlaybackMode.PREVIEW_ONLY);
        answer(true);
        await page.align(mk);
        expect(mk.playbackMode).toBe(PlaybackMode.MIXED_CONTENT);
        expect(mk.hasMusicSubscription).toHaveBeenCalledOnce();
    });

    it('asks again on the next start when the question failed', async () => {
        const mk = player('cn', 'us', Promise.reject(new Error('offline')));
        const page = pageWith();
        await page.align(mk);
        expect(mk.playbackMode).toBe(PlaybackMode.PREVIEW_ONLY);
        mk.hasMusicSubscription.mockReturnValue(Promise.resolve(true));
        await page.align(mk);
        expect(mk.playbackMode).toBe(PlaybackMode.MIXED_CONTENT);
    });

    it('follows the region Folia read the catalog in, before the one MusicKit has', async () => {
        const mk = player('cn', 'cn');
        const page = pageWith();
        page.window.__foliaStorefront = { data: { data: [{ id: 'us' }] } };
        await page.align(mk);
        expect(mk.storefrontId).toBe('us');
    });

    it('changes nothing on a page already in the account region, or without a signed-in account', async () => {
        // A matching page keeps the web app's own mode, previews included (no subscription).
        const matching = { ...player('cn', 'cn'), playbackMode: PlaybackMode.PREVIEW_ONLY };
        await pageWith().align(matching);
        expect(matching).toMatchObject({ storefrontId: 'cn', playbackMode: PlaybackMode.PREVIEW_ONLY });
        expect(matching.hasMusicSubscription).not.toHaveBeenCalled();
        const signedOut = { ...player('cn', 'us'), isAuthorized: false };
        await pageWith().align(signedOut);
        expect(signedOut).toMatchObject({ storefrontId: 'cn', playbackMode: PlaybackMode.PREVIEW_ONLY });
        const unknown = player('cn', 'USA');
        await pageWith().align(unknown);
        expect(unknown.storefrontId).toBe('cn');
    });
});
