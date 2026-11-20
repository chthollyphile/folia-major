import { describe, expect, it } from 'vitest';
import { toSafePlaybackUrl, toSafeRemoteUrl } from '@/utils/appPlaybackHelpers';

// test/unit/onlineMusic/audioUrlNormalization.test.ts
// The host's normalization of remote and playback URLs. A platform's own rule for its audio hosts is the source's
// (the http/https rule of one source's file hosts: kugouProvider.test.ts).

describe('online audio URL normalization', () => {
    it('keeps one candidate of a cached comma-joined URL', () => {
        expect(toSafeRemoteUrl('http://audio.example.test/primary.mp3,http://audio.example.test/backup.mp3'))
            .toBe('http://audio.example.test/primary.mp3');
        expect(toSafePlaybackUrl('https://audio.example.test/primary.mp3, https://audio.example.test/backup.mp3'))
            .toBe('https://audio.example.test/primary.mp3');
    });

    it('keeps valid HTTPS URLs unchanged', () => {
        expect(toSafeRemoteUrl('https://audio.example.test/song.mp3'))
            .toBe('https://audio.example.test/song.mp3');
    });

    it('leaves an http URL of any other host as it is, on the desktop and on the web alike', () => {
        const url = 'http://fs.example.test/path/song.mp3';
        expect(toSafeRemoteUrl(url)).toBe(url);
        expect(toSafePlaybackUrl(url)).toBe(url);
    });

    it('continues upgrading NetEase media URLs to HTTPS', () => {
        expect(toSafeRemoteUrl('http://m10.music.126.net/song.mp3'))
            .toBe('https://m10.music.126.net/song.mp3');
        expect(toSafePlaybackUrl('http://m10.music.126.net/song.mp3'))
            .toBe('https://m10.music.126.net/song.mp3');
    });
});
