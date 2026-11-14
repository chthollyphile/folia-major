import { describe, expect, it } from 'vitest';
import {
    describeCoverUrl,
    getCoverIdentity,
    getOriginalCoverUrl,
    getSizedCoverUrl,
    isCoverFetchedThroughProxy,
    registerCoverUrlRule,
    type CoverUrlRule,
} from '@/utils/coverUrl';

// test/unit/utils/coverUrlRules.test.ts
// Folium 2.0 plan §7 (utils/coverUrl.ts, coverCache.ts → covers@1): the picture hosts' rules are a registry the
// host asks, fed today from its own table. A rule a source registers is asked like the built-in ones and taken
// out again; the generic rules (local thumbnails, Navidrome) stay the host's. The built-in answers themselves are
// pinned in coverUrl.test.ts, which did not change.

const PICTURE_HOST = /^pics\.example\.test$/;

const exampleRule: CoverUrlRule = {
    provider: 'example',
    sized: (url, size) => (PICTURE_HOST.test(url.hostname) ? `${url.origin}${url.pathname}?w=${size}` : null),
    identity: url => (PICTURE_HOST.test(url.hostname) ? `example:${url.pathname}` : null),
    original: url => (PICTURE_HOST.test(url.hostname) ? `${url.origin}${url.pathname}` : null),
    requestedSize: url => (PICTURE_HOST.test(url.hostname) ? Number(url.searchParams.get('w')) || null : undefined),
    proxiedOnWeb: url => PICTURE_HOST.test(url.hostname),
};

describe('the cover rule registry', () => {
    it('asks a registered rule for its own URLs, and stops once it is taken out', () => {
        const url = 'https://pics.example.test/a/cover.jpg?w=100';
        const unregister = registerCoverUrlRule(exampleRule);
        try {
            expect(getSizedCoverUrl(url, 512)).toBe('https://pics.example.test/a/cover.jpg?w=512');
            expect(getCoverIdentity(url)).toBe('example:/a/cover.jpg');
            expect(getOriginalCoverUrl(url)).toBe('https://pics.example.test/a/cover.jpg');
            expect(describeCoverUrl(url)).toEqual({ provider: 'example', requestedSize: 100 });
            expect(isCoverFetchedThroughProxy(url)).toBe(true);
        } finally {
            unregister();
        }
        expect(getSizedCoverUrl(url, 512)).toBe(url);
        expect(getCoverIdentity(url)).toBe('https://pics.example.test/a/cover.jpg');
        expect(describeCoverUrl(url)).toEqual({ provider: 'other', requestedSize: null });
        expect(isCoverFetchedThroughProxy(url)).toBe(false);
    });

    it('keeps the web proxy hosts coverCache.ts used to name: QQ\'s and KuGou\'s picture hosts, by host alone', () => {
        expect(isCoverFetchedThroughProxy('https://y.gtimg.cn/music/photo_new/T002R300x300M000abc.jpg')).toBe(true);
        expect(isCoverFetchedThroughProxy('https://imge.kugou.com/anything.jpg')).toBe(true);
        expect(isCoverFetchedThroughProxy('https://kgimg.com/x.jpg')).toBe(true);
        expect(isCoverFetchedThroughProxy('https://p1.music.126.net/x.jpg')).toBe(false);
        expect(isCoverFetchedThroughProxy('not a url')).toBe(false);
    });

    it('leaves the generic rules to the host: local thumbnails and Navidrome', () => {
        expect(getSizedCoverUrl('/__folia_cover/abc.jpg', 300)).toBe('/__folia_cover/abc.jpg?size=512');
        expect(getSizedCoverUrl('https://navi.test/rest/getCoverArt?id=1', 256)).toBe('https://navi.test/rest/getCoverArt?id=1&size=256');
        expect(describeCoverUrl('https://navi.test/rest/getCoverArt?id=1&size=256')).toEqual({ provider: 'navidrome', requestedSize: 256 });
    });
});
