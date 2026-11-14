// @builtin-sources
import { describe, expect, it } from 'vitest';
import { COVER_MAX_SIZE, COVER_SIZE_STEPS, describeCoverUrl, getCoverIdentity, getOriginalCoverUrl, getSizedCoverUrl, resolveCoverSizeStep } from '@/utils/coverUrl';

// test/unit/utils/coverUrl.test.ts

describe('coverUrl utilities', () => {
    it('keeps blob cover URLs unchanged', () => {
        const blobUrl = 'blob:http://localhost:3000/1a56d3d0-2d9d-4f99-be5b-93f3dede5938';

        expect(getSizedCoverUrl(blobUrl, 50)).toBe(blobUrl);
    });

    it('adds Netease CDN size parameters', () => {
        expect(getSizedCoverUrl('https://p1.music.126.net/abc/109951.jpg?param=300y300', 50))
            .toBe('https://p1.music.126.net/abc/109951.jpg?param=50y50');
    });

    it('uses exact KuGou CDN sizes for official album cover hosts', () => {
        const imgeCover = 'https://imge.kugou.com/stdmusic/400/20251014/cover.jpg';
        const kgimgCover = 'https://c1.kgimg.com/stdmusic/1024/20251014/cover.jpg';

        expect(getSizedCoverUrl(imgeCover, 120))
            .toBe('https://imge.kugou.com/stdmusic/120/20251014/cover.jpg');
        expect(getSizedCoverUrl(imgeCover, 512))
            .toBe('https://imge.kugou.com/stdmusic/512/20251014/cover.jpg');
        expect(getSizedCoverUrl(kgimgCover, 1024))
            .toBe('https://c1.kgimg.com/stdmusic/1024/20251014/cover.jpg');
    });

    it('does not rewrite KuGou-shaped paths from unrelated hosts', () => {
        const coverUrl = 'https://example.test/stdmusic/400/20251014/cover.jpg';

        expect(getSizedCoverUrl(coverUrl, 1024)).toBe(coverUrl);
    });

    it('uses QQ Music CDN size buckets for album covers', () => {
        const coverUrl = 'https://y.gtimg.cn/music/photo_new/T002R300x300M000album-mid.jpg?max_age=2592000';

        expect(getSizedCoverUrl(coverUrl, 120))
            .toBe('https://y.gtimg.cn/music/photo_new/T002R300x300M000album-mid.jpg?max_age=2592000');
        expect(getSizedCoverUrl(coverUrl, 512))
            .toBe('https://y.gtimg.cn/music/photo_new/T002R800x800M000album-mid.jpg?max_age=2592000');
        // The original album asset runs to 3000×3000; the 1200 bucket answers instead.
        expect(getSizedCoverUrl(coverUrl, 1024))
            .toBe('https://y.gtimg.cn/music/photo_new/T002R1200x1200M000album-mid.jpg?max_age=2592000');
    });

    it('restores the canonical QQ Music original without a display-size sentinel', () => {
        expect(getOriginalCoverUrl('https://y.gtimg.cn/music/photo_new/T002R800x800M000album-mid.jpg?max_age=2592000'))
            .toBe('https://y.gtimg.cn/music/photo_new/T002M000album-mid.jpg?max_age=2592000');
    });

    it('caps large QQ Music singer image requests at the 1200 bucket', () => {
        expect(getSizedCoverUrl('https://y.qq.com/music/photo_new/T001R150x150M000singer-mid.jpg', 1024))
            .toBe('https://y.qq.com/music/photo_new/T001R1200x1200M000singer-mid.jpg');
        expect(getOriginalCoverUrl('https://y.qq.com/music/photo_new/T001R150x150M000singer-mid.jpg'))
            .toBe('https://y.qq.com/music/photo_new/T001M000singer-mid.jpg');
    });

    it('restores the Netease original by dropping the resize parameter', () => {
        expect(getOriginalCoverUrl('https://p1.music.126.net/abc/109951.jpg?param=1024y1024'))
            .toBe('https://p1.music.126.net/abc/109951.jpg');
        expect(getOriginalCoverUrl('https://p1.music.126.net/abc/109951.jpg'))
            .toBe('https://p1.music.126.net/abc/109951.jpg');
    });

    it('derives QQ Music thumbnails from an original cover URL', () => {
        expect(getSizedCoverUrl('https://y.gtimg.cn/music/photo_new/T002M000album-mid.jpg', 512))
            .toBe('https://y.gtimg.cn/music/photo_new/T002R800x800M000album-mid.jpg');
    });

    it('does not rewrite QQ-shaped paths from unrelated hosts', () => {
        const coverUrl = 'https://example.test/music/photo_new/T002R300x300M000album-mid.jpg';

        expect(getSizedCoverUrl(coverUrl, 512)).toBe(coverUrl);
    });

    it('sets Navidrome cover art size parameters', () => {
        expect(getSizedCoverUrl('https://music.test/rest/getCoverArt.view?id=cover-1&v=1', 150))
            .toBe('https://music.test/rest/getCoverArt.view?id=cover-1&v=1&size=150');
    });

    it('uses bounded thumbnail buckets for Electron local covers', () => {
        expect(getSizedCoverUrl(`folia-cover://asset/sha256%3A${'a'.repeat(64)}`, 300))
            .toBe(`folia-cover://asset/sha256%3A${'a'.repeat(64)}?size=512`);
    });

    it('keeps Web local cover thumbnails at least 512px', () => {
        expect(getSizedCoverUrl(`/__folia_cover/sha256%3A${'b'.repeat(64)}`, 50))
            .toBe(`/__folia_cover/sha256%3A${'b'.repeat(64)}?size=512`);
    });

    it('rounds a box up to the smallest step that still covers it', () => {
        expect(resolveCoverSizeStep(1)).toBe(256);
        expect(resolveCoverSizeStep(256)).toBe(256);
        expect(resolveCoverSizeStep(257)).toBe(512);
        expect(resolveCoverSizeStep(1024)).toBe(1024);
    });

    it('leaves boxes past the top step without a bucket, so callers ask for the cap', () => {
        expect(resolveCoverSizeStep(1025)).toBe(Number.POSITIVE_INFINITY);
        expect(getSizedCoverUrl('https://p1.music.126.net/abc/109951.jpg', COVER_MAX_SIZE))
            .toBe('https://p1.music.126.net/abc/109951.jpg?param=1200y1200');
        expect(getSizedCoverUrl('https://y.gtimg.cn/music/photo_new/T002M000album-mid.jpg', COVER_MAX_SIZE))
            .toBe('https://y.gtimg.cn/music/photo_new/T002R1200x1200M000album-mid.jpg');
    });

    it('keeps every step on a variant the providers actually serve', () => {
        const netease = 'https://p1.music.126.net/abc/109951.jpg';
        const qq = 'https://y.gtimg.cn/music/photo_new/T002M000album-mid.jpg';
        const local = `folia-cover://asset/sha256%3A${'a'.repeat(64)}`;

        expect(COVER_SIZE_STEPS.map(step => getSizedCoverUrl(netease, step))).toEqual([
            'https://p1.music.126.net/abc/109951.jpg?param=256y256',
            'https://p1.music.126.net/abc/109951.jpg?param=512y512',
            'https://p1.music.126.net/abc/109951.jpg?param=1024y1024',
        ]);
        // QQ has no 1024 bucket (R1024 answers 404); the top step rounds up to its 1200 one rather
        // than to the original, whose decode is what the wall cannot afford.
        expect(COVER_SIZE_STEPS.map(step => getSizedCoverUrl(qq, step))).toEqual([
            'https://y.gtimg.cn/music/photo_new/T002R300x300M000album-mid.jpg',
            'https://y.gtimg.cn/music/photo_new/T002R800x800M000album-mid.jpg',
            'https://y.gtimg.cn/music/photo_new/T002R1200x1200M000album-mid.jpg',
        ]);
        expect(COVER_SIZE_STEPS.map(step => getSizedCoverUrl(local, step))).toEqual([
            `${local}?size=512`,
            `${local}?size=512`,
            `${local}?size=1024`,
        ]);
    });

    it('reads back the size a cover URL asks each provider for', () => {
        expect(describeCoverUrl('https://p1.music.126.net/abc/1.jpg?param=512y512'))
            .toEqual({ provider: 'netease', requestedSize: 512 });
        expect(describeCoverUrl('https://c1.kgimg.com/stdmusic/480/20251014/cover.jpg'))
            .toEqual({ provider: 'kugou', requestedSize: 480 });
        expect(describeCoverUrl('https://y.gtimg.cn/music/photo_new/T002R800x800M000album-mid.jpg'))
            .toEqual({ provider: 'qq', requestedSize: 800 });
        expect(describeCoverUrl('https://music.test/rest/getCoverArt.view?id=cover-1&size=256'))
            .toEqual({ provider: 'navidrome', requestedSize: 256 });
        expect(describeCoverUrl(`folia-cover://asset/sha256%3A${'a'.repeat(64)}?size=1024`))
            .toEqual({ provider: 'local', requestedSize: 1024 });
        expect(describeCoverUrl(`/__folia_cover/sha256%3A${'b'.repeat(64)}?size=512`))
            .toEqual({ provider: 'local', requestedSize: 512 });
    });

    it('reports no requested size when the URL carries none, which is a request for the original', () => {
        expect(describeCoverUrl('https://p1.music.126.net/abc/1.jpg'))
            .toEqual({ provider: 'netease', requestedSize: null });
        expect(describeCoverUrl('https://y.gtimg.cn/music/photo_new/T002M000album-mid.jpg'))
            .toEqual({ provider: 'qq', requestedSize: null });
    });

    it('describes every size the ladder can produce, so the audit never sees an unparsed URL', () => {
        const netease = 'https://p1.music.126.net/abc/109951.jpg';
        for (const step of COVER_SIZE_STEPS) {
            expect(describeCoverUrl(getSizedCoverUrl(netease, step)))
                .toEqual({ provider: 'netease', requestedSize: step });
        }
    });

    it('ignores what cannot be audited', () => {
        expect(describeCoverUrl('blob:http://localhost:3000/1a56d3d0')).toBeNull();
        expect(describeCoverUrl('')).toBeNull();
        expect(describeCoverUrl('not a url')).toBeNull();
        expect(describeCoverUrl('https://example.test/art.jpg'))
            .toEqual({ provider: 'other', requestedSize: null });
    });

    it('gives one identity to the same artwork however the CDN names it', () => {
        const same = (...urls: string[]) => expect(new Set(urls.map(getCoverIdentity)).size).toBe(1);
        same(
            'https://p2.music.126.net/A8cekRECAnzfAG1TbKWoew==/109951171002613452.jpg',
            'https://p1.music.126.net/A8cekRECAnzfAG1TbKWoew==/109951171002613452.jpg?param=128y128',
            'http://p3.music.126.net/A8cekRECAnzfAG1TbKWoew==/109951171002613452.jpg#x',
        );
        same(
            'https://y.gtimg.cn/music/photo_new/T002R300x300M000album-mid.jpg?max_age=2592000',
            'https://y.gtimg.cn/music/photo_new/T002R800x800M000album-mid.jpg',
            'https://y.qq.com/music/photo_new/T002M000album-mid.jpg',
        );
        same('https://imge.kugou.com/stdmusic/400/20251014/cover.jpg', 'https://c1.kgimg.com/stdmusic/1024/20251014/cover.jpg');
        same('https://img1.kuwo.cn/star/albumcover/240/12/34/cover.jpg', 'https://img4.kuwo.cn/star/albumcover/800/12/34/cover.jpg');
        same('/__folia_cover/abc?size=512', '/__folia_cover/abc?size=1024');
    });

    it('keeps different artwork apart', () => {
        expect(getCoverIdentity('https://p1.music.126.net/a/1.jpg')).not.toBe(getCoverIdentity('https://p1.music.126.net/a/2.jpg'));
        expect(getCoverIdentity('https://y.gtimg.cn/music/photo_new/T002R300x300M000a.jpg'))
            .not.toBe(getCoverIdentity('https://y.gtimg.cn/music/photo_new/T001R300x300M000a.jpg'));
        expect(getCoverIdentity('https://example.test/a.jpg')).not.toBe(getCoverIdentity('https://other.test/a.jpg'));
        expect(getCoverIdentity(undefined)).toBe('');
    });

    describe('size rules for the hosts measured on 2026-11-11', () => {
        it('resizes KuGou playlist covers like song art', () => {
            const cover = 'http://imge.kugou.com/soft/collection/150/20260414/20260414170554928435.png';
            expect(getSizedCoverUrl(cover, 1024))
                .toBe('http://imge.kugou.com/soft/collection/1024/20260414/20260414170554928435.png');
            expect(getCoverIdentity(cover)).toBe(getCoverIdentity(getSizedCoverUrl(cover, 256)));
        });

        it('recognises the sycdn and kwcdn Kuwo hosts and serves 1024 and the cap past 800', () => {
            expect(getSizedCoverUrl('http://img2.sycdn.kuwo.cn/star/albumcover/120/s3s22/95/1.jpg', 256))
                .toBe('http://img2.sycdn.kuwo.cn/star/albumcover/240/s3s22/95/1.jpg');
            expect(getSizedCoverUrl('http://img1.kwcdn.kuwo.cn/star/albumcover/240/s3s22/95/1.jpg', 1024))
                .toBe('http://img1.kwcdn.kuwo.cn/star/albumcover/1024/s3s22/95/1.jpg');
            expect(getSizedCoverUrl('https://img1.kuwo.cn/star/albumcover/240/s3s22/95/1.jpg', COVER_MAX_SIZE))
                .toBe('https://img1.kuwo.cn/star/albumcover/1200/s3s22/95/1.jpg');
            expect(getSizedCoverUrl('https://img1.kuwo.cn/star/albumcover/240/s3s22/95/1.jpg', 4000))
                .toBe('https://img1.kuwo.cn/star/albumcover/1200/s3s22/95/1.jpg');
        });

        it('puts QQ playlist covers on their 150, 300 and 600 buckets', () => {
            const cover = 'https://qpic.y.qq.com/music_cover/abcdef/300?n=1';
            expect(COVER_SIZE_STEPS.map(step => getSizedCoverUrl(cover, step))).toEqual([
                'https://qpic.y.qq.com/music_cover/abcdef/300?n=1',
                'https://qpic.y.qq.com/music_cover/abcdef/600?n=1',
                'https://qpic.y.qq.com/music_cover/abcdef/600?n=1',
            ]);
            expect(getSizedCoverUrl(cover, 120)).toBe('https://qpic.y.qq.com/music_cover/abcdef/150?n=1');
            expect(describeCoverUrl(cover)).toEqual({ provider: 'qq', requestedSize: 300 });
        });

        it('writes the size into an Apple artwork file name, keeping its box and format', () => {
            const cover = 'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/90/79/ce/x/cover.jpg/512x512bb.jpg';
            expect(getSizedCoverUrl(cover, 1024))
                .toBe('https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/90/79/ce/x/cover.jpg/1024x1024bb.jpg');
            expect(getSizedCoverUrl(cover.replace('bb.jpg', 'bb.webp'), 256))
                .toBe('https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/90/79/ce/x/cover.jpg/256x256bb.webp');
            expect(getCoverIdentity(cover)).toBe(getCoverIdentity(getSizedCoverUrl(cover, 256)));
            expect(describeCoverUrl(cover)).toEqual({ provider: 'apple', requestedSize: 512 });
        });

        it('writes the size into a square Google picture ending and leaves wide ones alone', () => {
            const cover = 'https://lh3.googleusercontent.com/abc_DEF-1=w544-h544-l90-rj';
            expect(getSizedCoverUrl(cover, 1024)).toBe('https://lh3.googleusercontent.com/abc_DEF-1=w1024-h1024-l90-rj');
            expect(getSizedCoverUrl('https://yt3.ggpht.com/abc=w60-h60', 256)).toBe('https://yt3.ggpht.com/abc=w256-h256');
            const banner = 'https://lh3.googleusercontent.com/abc=w1440-h600-p-l90-rj';
            expect(getSizedCoverUrl(banner, 512)).toBe(banner);
            expect(getCoverIdentity(cover)).toBe(getCoverIdentity(getSizedCoverUrl(cover, 256)));
            expect(describeCoverUrl(cover)).toEqual({ provider: 'google', requestedSize: 544 });
        });

        it('leaves look-alike paths it has no rule for untouched', () => {
            const avatar = 'https://imge.kugou.com/kugouicon/165/20200101/a.jpg';
            const wideApple = 'https://is1-ssl.mzstatic.com/image/thumb/x/cover.jpg/1200x630bb.jpg';
            const suffixedApple = 'https://is1-ssl.mzstatic.com/image/thumb/x/cover.jpg/512x512bb-60.jpg';
            const still = 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg';
            const other = 'https://img1.kuwo.cn.example.test/star/albumcover/240/1.jpg';
            for (const url of [avatar, wideApple, suffixedApple, still, other]) {
                expect(getSizedCoverUrl(url, 1024)).toBe(url);
            }
        });

        it('serves Kuwo singer pictures past 800 like album covers', () => {
            expect(getSizedCoverUrl('https://img1.kuwo.cn/star/starheads/240/s4s1/1.jpg', 1024))
                .toBe('https://img1.kuwo.cn/star/starheads/1024/s4s1/1.jpg');
        });

        it('reads the new hosts back to their originals', () => {
            expect(getOriginalCoverUrl('https://is1-ssl.mzstatic.com/image/thumb/x/cover.jpg/512x512bb.jpg'))
                .toBe('https://is1-ssl.mzstatic.com/image/thumb/x/cover.jpg/5000x5000bb.jpg');
            expect(getOriginalCoverUrl('https://lh3.googleusercontent.com/abc=w544-h544-l90-rj'))
                .toBe('https://lh3.googleusercontent.com/abc=s0');
            expect(getOriginalCoverUrl('https://img1.kuwo.cn/star/albumcover/240/1.jpg'))
                .toBe('https://img1.kuwo.cn/star/albumcover/1200/1.jpg');
        });
    });
});
