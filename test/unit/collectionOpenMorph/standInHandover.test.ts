import { describe, expect, it } from 'vitest';
import { sameArtwork, standInHandoverKind } from '@/library/suites/grid/transitions/standInHandover';

// test/unit/collectionOpenMorph/standInHandover.test.ts

describe('sameArtwork', () => {
    it('takes a NetEase cover at two sizes, from two of its hosts, for one picture', () => {
        const cover = 'https://p1.music.126.net/6y-UleORITEDbvrOLV0Q8A==/5639395138885805.jpg';
        expect(sameArtwork(`${cover}?param=300y300`, `${cover}?param=512y512`)).toBe(true);
        expect(sameArtwork(cover, `${cover}?param=512y512`)).toBe(true);
        expect(sameArtwork(`${cover}?param=300y300`, `${cover.replace('p1.', 'p2.')}?param=512y512`)).toBe(true);
        expect(sameArtwork(cover.replace('https:', 'http:'), `${cover}?param=512y512`)).toBe(true);
        expect(sameArtwork(`${cover}?param=300y300`, 'https://p1.music.126.net/6y-UleORITEDbvrOLV0Q8A==/109951163.jpg?param=300y300')).toBe(false);
    });

    it('takes a YouTube Music cover with any size ending for one picture', () => {
        const art = 'https://lh3.googleusercontent.com/AbC-dEf_123';
        expect(sameArtwork(`${art}=w226-h226-l90-rj`, `${art}=w544-h544-l90-rj`)).toBe(true);
        expect(sameArtwork(`${art}=w226-h226-l90-rj`, `${art}=s576`)).toBe(true);
        expect(sameArtwork(`${art}=w576`, art)).toBe(true);
        expect(sameArtwork('https://yt3.ggpht.com/avatar=s88-c-k-c0x00ffffff-no-rj', 'https://yt3.ggpht.com/avatar=s176-c-k-c0x00ffffff-no-rj')).toBe(true);
        expect(sameArtwork(`${art}=w226-h226-l90-rj`, 'https://lh3.googleusercontent.com/AbC-dEf_124=w226-h226-l90-rj')).toBe(false);
    });

    it('takes the stills of one YouTube video for one picture', () => {
        expect(sameArtwork('https://i.ytimg.com/vi/m9SMT5ipbxk/hqdefault.jpg?sqp=cut&rs=signature', 'https://i.ytimg.com/vi/m9SMT5ipbxk/mqdefault.jpg')).toBe(true);
        expect(sameArtwork('https://i.ytimg.com/vi_webp/m9SMT5ipbxk/hqdefault.webp', 'https://i9.ytimg.com/vi/m9SMT5ipbxk/hq720.jpg')).toBe(true);
        expect(sameArtwork('https://i.ytimg.com/vi/m9SMT5ipbxk/hqdefault.jpg', 'https://i.ytimg.com/vi/ZRtdQ81jPUQ/hqdefault.jpg')).toBe(false);
    });

    it('knows the size parts of the other providers the app resizes for', () => {
        expect(sameArtwork('https://y.gtimg.cn/music/photo_new/T002R300x300M000003abc.jpg', 'https://y.gtimg.cn/music/photo_new/T002R800x800M000003abc.jpg')).toBe(true);
        expect(sameArtwork('https://imge.kugou.com/stdmusic/150/20200101/abc.jpg', 'https://imge.kugou.com/stdmusic/512/20200101/abc.jpg')).toBe(true);
        expect(sameArtwork('https://music.example/rest/getCoverArt?id=al-7&size=300', 'https://music.example/rest/getCoverArt?id=al-7&size=512')).toBe(true);
        expect(sameArtwork('https://music.example/rest/getCoverArt?id=al-7&size=300', 'https://music.example/rest/getCoverArt?id=al-8&size=300')).toBe(false);
        expect(sameArtwork('folia-cover://local/abc?size=512', 'folia-cover://local/abc?size=1024')).toBe(true);
    });

    it('compares a data URI whole', () => {
        const blue = 'data:image/svg+xml,%3Csvg%20fill%3D%22blue%22%2F%3E';
        expect(sameArtwork(blue, blue)).toBe(true);
        expect(sameArtwork(blue, 'data:image/svg+xml,%3Csvg%20fill%3D%22green%22%2F%3E')).toBe(false);
    });

    it('is false where either picture is missing', () => {
        expect(sameArtwork(null, null)).toBe(false);
        expect(sameArtwork('', 'https://lh3.googleusercontent.com/art=w226')).toBe(false);
        expect(sameArtwork('https://lh3.googleusercontent.com/art=w226', undefined)).toBe(false);
    });
});

describe('standInHandoverKind', () => {
    const at = (x: number, y: number, height = 412.5) => ({ x, y, width: 275, height });
    const standIn = at(582.5, 343.75);

    it('turns the stand-in over into a hero that shows another picture at its place', () => {
        expect(standInHandoverKind(standIn, at(582.5, 343.75), false)).toBe('turn');
    });

    it('goes by the centres: a hero that is taller than the stand-in is still at its place', () => {
        expect(standInHandoverKind(standIn, at(582.5, 323.75, 452.5), false)).toBe('turn');
    });

    it('does not turn into a hero that shows the same picture', () => {
        expect(standInHandoverKind(standIn, at(582.5, 343.75), true)).toBe('plain');
    });

    it('does not turn into a hero that is more than 8 px away', () => {
        expect(standInHandoverKind(standIn, at(588.5, 348.75), false)).toBe('turn');
        expect(standInHandoverKind(standIn, at(589.5, 349.75), false)).toBe('plain');
        expect(standInHandoverKind(standIn, at(832.5, 343.75), false)).toBe('plain');
    });

    it('goes alone where there is no hero, whatever is said of its picture', () => {
        expect(standInHandoverKind(standIn, null, false)).toBe('alone');
        expect(standInHandoverKind(standIn, null, true)).toBe('alone');
    });
});
