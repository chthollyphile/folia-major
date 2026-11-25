import { describe, expect, it } from 'vitest';
import type { MprisPlayerSnapshot } from '@/types/mpris';
import { hasTimedLyricText, mprisLyricSignature, mprisPositionSec, mprisTrackFromPlayer, mprisTrackKey } from '@/utils/mpris';

// src/utils/mpris.ts 的纯换算：曲目标识、采样位置外推、播放器自带的歌词有没有时间轴。

const player = (overrides: Partial<MprisPlayerSnapshot> = {}): MprisPlayerSnapshot => ({
    busName: 'org.mpris.MediaPlayer2.a',
    identity: 'Player A',
    status: 'playing',
    trackId: '/track/1',
    title: '标题',
    artists: ['歌手'],
    album: '专辑',
    artUrl: null,
    durationSec: 200,
    positionSec: 10,
    rate: 1,
    lyricText: '',
    sampledAtMs: 1_000,
    activeAtMs: 1_000,
    ...overrides,
});

describe('mprisTrackKey', () => {
    it('uses the bus name and the track id', () => {
        expect(mprisTrackKey(player())).toBe('org.mpris.MediaPlayer2.a|/track/1');
        expect(mprisTrackKey(player({ trackId: '/track/2' }))).not.toBe(mprisTrackKey(player()));
    });

    it('falls back to the metadata when the player has no track id', () => {
        expect(mprisTrackKey(player({ trackId: null }))).toBe('org.mpris.MediaPlayer2.a|标题|歌手|专辑');
    });
});

describe('mprisPositionSec', () => {
    it('advances with the wall clock while playing', () => {
        expect(mprisPositionSec(player({ sampledAtMs: 1_000 }), 3_500)).toBeCloseTo(12.5);
    });

    it('freezes while paused and follows the playback rate', () => {
        expect(mprisPositionSec(player({ status: 'paused' }), 9_000)).toBe(10);
        expect(mprisPositionSec(player({ rate: 1.5 }), 2_000)).toBeCloseTo(11.5);
    });

    it('clamps to the duration', () => {
        expect(mprisPositionSec(player({ durationSec: 12 }), 10_000)).toBe(12);
        expect(mprisPositionSec(player({ durationSec: 0 }), 2_000)).toBeCloseTo(11);
    });
});

describe('hasTimedLyricText', () => {
    it('accepts LRC timestamps and rejects plain lyrics', () => {
        expect(hasTimedLyricText('[00:12.34]第一句\n[00:15.00]第二句')).toBe(true);
        expect(hasTimedLyricText('[1:02]第一句')).toBe(true);
        expect(hasTimedLyricText('第一句\n第二句')).toBe(false);
    });
});

describe('mprisLyricSignature', () => {
    it('changes when the metadata a lyric match depends on arrives late', () => {
        const bare = player({ artists: [], durationSec: 0, lyricText: '' });
        const withMetadata = player({
            artists: ['歌手'],
            durationSec: 200,
            lyricText: '[00:01.00]第一句',
        });
        expect(mprisLyricSignature(bare)).not.toBe(mprisLyricSignature(withMetadata));
        expect(mprisLyricSignature(player())).toBe(mprisLyricSignature(player()));
    });

    it('changes when the player switches songs', () => {
        expect(mprisLyricSignature(player())).not.toBe(mprisLyricSignature(player({ trackId: '/track/2' })));
    });

    it('separates plain lyrics from timed lyrics', () => {
        const plain = player({ lyricText: '第一句\n第二句' });
        const timed = player({ lyricText: '[00:01.00]第一句' });
        expect(mprisLyricSignature(plain)).not.toBe(mprisLyricSignature(timed));
    });
});

describe('mprisTrackFromPlayer', () => {
    it('joins the artists for display and keeps the bus identity', () => {
        const track = mprisTrackFromPlayer(player({ artists: ['甲', '乙'] }));
        expect(track.artist).toBe('甲, 乙');
        expect(track.identity).toBe('Player A');
        expect(track.title).toBe('标题');
    });

    it('shows the player name when the player reports no title', () => {
        expect(mprisTrackFromPlayer(player({ title: '' })).title).toBe('Player A');
    });
});
