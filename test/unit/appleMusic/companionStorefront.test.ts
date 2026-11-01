import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// test/unit/appleMusic/companionStorefront.test.ts
// MusicKit plays a catalog id only against the page's storefront: a page opened in another region
// has to move to the account's before playback.

const require = createRequire(import.meta.url);
const { storefrontTarget } = require('../../../electron/appleMusic/companionStorefront.cjs') as {
    storefrontTarget: (currentUrl: unknown, storefront: unknown) => string | null;
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
