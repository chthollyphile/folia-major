import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// test/unit/ytm/ytmLikedCount.test.ts — the song count a playlist's page names in its header
// (webPages.cjs, `playlistCountOf`), which is how many songs the liked list holds. The pages
// below are shaped like the raw answer of the web client's /browse; every text is made up.

const require = createRequire(import.meta.url);
const webPages = require('../../../electron/ytm/webPages.cjs');

const runs = (...texts: string[]) => ({ runs: texts.map(text => ({ text })) });
// A playlist's page with this header beside its shelf of rows.
const pageWith = (header: Record<string, unknown>) => ({
    contents: {
        twoColumnBrowseResultsRenderer: {
            tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [header] } } } }],
            secondaryContents: { sectionListRenderer: { contents: [{ musicPlaylistShelfRenderer: { contents: [] } }] } },
        },
    },
});
const responsiveHeader = (secondSubtitle: unknown) => ({
    musicResponsiveHeaderRenderer: { title: runs('Liked music'), subtitle: runs('Auto playlist'), secondSubtitle },
});

describe('the song count of a playlist header', () => {
    it('reads the count, its thousands grouped by a comma or a point, in the three languages', () => {
        expect(webPages.playlistCountOf(pageWith(responsiveHeader(runs('1,234 songs', ' • ', '80+ hours'))))).toBe(1234);
        expect(webPages.playlistCountOf(pageWith(responsiveHeader(runs('1.234 lagu', ' • ', '80+ jam'))))).toBe(1234);
        expect(webPages.playlistCountOf(pageWith(responsiveHeader(runs('56 首歌曲', ' • ', '3 小时'))))).toBe(56);
        expect(webPages.playlistCountOf(pageWith(responsiveHeader(runs('1 song', ' • ', '3 minutes'))))).toBe(1);
        expect(webPages.playlistCountOf(pageWith(responsiveHeader(runs('0 songs'))))).toBe(0);
    });

    it('reads the count whole when a space groups its thousands', () => {
        expect(webPages.playlistCountOf(pageWith(responsiveHeader(runs('1 000 songs'))))).toBe(1000);
        expect(webPages.playlistCountOf(pageWith(responsiveHeader(runs('1 234 songs', ' • ', '80+ hours'))))).toBe(1234);
        expect(webPages.playlistCountOf(pageWith(responsiveHeader(runs('1 234 songs'))))).toBe(1234);
        expect(webPages.playlistCountOf(pageWith(responsiveHeader(runs('12 345 songs'))))).toBe(12345);
        expect(webPages.playlistCountOf(pageWith(responsiveHeader(runs('1,234+ songs'))))).toBeUndefined();
    });

    it('reads the count past the views before it, in the header the account may edit and in the older one', () => {
        expect(webPages.playlistCountOf(pageWith(responsiveHeader(runs('2.5K views', ' • ', '12 songs', ' • ', '40 minutes'))))).toBe(12);
        const editable = { musicEditablePlaylistDetailHeaderRenderer: { header: responsiveHeader(runs('2,001 songs', ' • ', '100+ hours')) } };
        expect(webPages.playlistCountOf(pageWith(editable))).toBe(2001);
        const older = { header: { musicDetailHeaderRenderer: { title: runs('Liked music'), secondSubtitle: runs('300 songs', ' • ', '18 hours') } } };
        expect(webPages.playlistCountOf(older)).toBe(300);
    });

    it('names no count where the header has none', () => {
        expect(webPages.playlistCountOf(pageWith(responsiveHeader(runs('80+ hours'))))).toBeUndefined();
        expect(webPages.playlistCountOf(pageWith({ musicResponsiveHeaderRenderer: { title: runs('Liked music'), subtitle: runs('42 songs') } }))).toBeUndefined();
        for (const nothing of [undefined, null, {}, [], pageWith({ messageRenderer: { text: runs('12 songs') } })]) {
            expect(webPages.playlistCountOf(nothing)).toBeUndefined();
        }
    });
});
