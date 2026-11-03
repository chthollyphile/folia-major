import { describe, expect, it } from 'vitest';
import type { SongResult } from '@/types';
import { downloadRuleOf } from '@/services/automix/profileService';

// test/unit/automix/downloadRule.test.ts
// How much of a track's URL the analyser may read, and whether it is stored. Pinned on the library
// server's stream: it once counted as local because it is not an online song, so it was read whole,
// a second download of every track alongside the stream playing it. What each rule reads is pinned
// in libraryDownload.test.ts.

const song = (sourceRef: SongResult['sourceRef']): SongResult => ({
    id: 'x',
    name: 'X',
    artists: [],
    album: { id: 'album', name: 'Album' },
    durationMs: 1000,
    sourceRef,
});

describe('downloadRuleOf', () => {
    it('reads anything already on this machine whole', () => {
        expect(downloadRuleOf(song({ kind: 'online', providerId: 'netease', mediaId: 'x' }), 'blob:abc')).toBe('free');
        expect(downloadRuleOf(song({ kind: 'local', mediaId: 'x' }), 'file:///music/x.flac')).toBe('free');
        expect(downloadRuleOf(song({ kind: 'local', mediaId: 'x' }), 'https://anything.test/x')).toBe('free');
    });

    it('treats a library server stream as a download that is never cached, read only in part', () => {
        expect(downloadRuleOf(song({ kind: 'navidrome', mediaId: 'x' }), 'https://navi.test/rest/stream?id=x')).toBe('library');
    });

    it('treats an online song as a download the media cache keeps', () => {
        expect(downloadRuleOf(song({ kind: 'online', providerId: 'netease', mediaId: 'x' }), 'https://cdn.test/x.mp3')).toBe('online');
    });
});
