import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// The companion must not give third-party top-level pages access to its persistent session.
const require = createRequire(import.meta.url);
const { isAllowedNavigation } = require('../../../electron/appleMusic/companionNavigation.cjs') as {
    isAllowedNavigation: (value: unknown) => boolean;
};

describe('Apple Music companion navigation', () => {
    it('allows the music website and Apple sign-in hosts over HTTPS', () => {
        expect(isAllowedNavigation('https://music.apple.com/')).toBe(true);
        expect(isAllowedNavigation('https://auth.music.apple.com/')).toBe(true);
        expect(isAllowedNavigation('https://idmsa.apple.com/')).toBe(true);
        expect(isAllowedNavigation('https://appleid.apple.com/')).toBe(true);
        expect(isAllowedNavigation('https://account.apple.com/')).toBe(true);
    });

    it('rejects unrelated, malformed, credential-bearing and insecure URLs', () => {
        for (const url of [
            'http://music.apple.com/', 'https://music.apple.com.evil.test/',
            'https://evil.test/?next=music.apple.com', 'https://user:secret@music.apple.com/',
            'https://music.apple.com:444/', 'file:///tmp/test', 'not a url', null,
        ]) expect(isAllowedNavigation(url)).toBe(false);
    });
});
