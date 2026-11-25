import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// 钉住 MPRIS 属性的纯变换：微秒的 BigInt 换秒、Metadata 里的曲目/歌词/封面、多播放器里挑「正在放」的那个、
// 以及 activeAtMs 只在状态或曲目变化时更新（位置每秒都变，不能拿它当最近活动）。

const require = createRequire(import.meta.url);
const mpris = require('../../../electron/mpris/mprisMetadata.cjs') as {
    propertiesToObject: (entries: unknown) => Record<string, unknown>;
    microsecondsToSeconds: (value: unknown) => number;
    buildPlayerSnapshot: (options: Record<string, unknown>) => Record<string, unknown>;
    pickActiveBusName: (players: Record<string, unknown>[]) => string | null;
};

type Variant = { signature: string; value: unknown };
const variant = (signature: string, value: unknown): Variant => ({ signature, value });

const metadata = (overrides: Array<[string, Variant]> = []): Variant => variant('a{sv}', [
    ['mpris:trackid', variant('o', '/org/mpd/Tracks/86283')],
    ['mpris:length', variant('x', 251732000n)],
    ['xesam:title', variant('s', '还是好朋友')],
    ['xesam:artist', variant('as', ['古巨基', '梁静茹'])],
    ['xesam:album', variant('s', '我还是你的 - 情歌王')],
    ['mpris:artUrl', variant('s', 'http://p3.music.126.net/cover.jpg')],
    ['xesam:asText', variant('s', '[00:40.60]没有人要内疚 没需要缘由')],
    ...overrides,
]);

const playerProperties = (overrides: Array<[string, Variant]> = []): Array<[string, Variant]> => [
    ['PlaybackStatus', variant('s', 'Playing')],
    ['Position', variant('x', 163200000n)],
    ['Rate', variant('d', 1)],
    ...overrides,
];

const snapshot = (overrides: Record<string, unknown> = {}) => mpris.buildPlayerSnapshot({
    busName: 'org.mpris.MediaPlayer2.musicfox.instance55870',
    identity: 'musicfox',
    properties: mpris.propertiesToObject(playerProperties([['Metadata', metadata()]])),
    previous: undefined,
    nowMs: 1_000,
    ...overrides,
});

describe('microsecondsToSeconds', () => {
    it('reads the BigInt microseconds MPRIS sends', () => {
        expect(mpris.microsecondsToSeconds(251732000n)).toBeCloseTo(251.732);
    });

    it('treats missing, negative and non-numeric values as no length', () => {
        expect(mpris.microsecondsToSeconds(undefined)).toBe(0);
        expect(mpris.microsecondsToSeconds(-5n)).toBe(0);
        expect(mpris.microsecondsToSeconds('12')).toBe(0);
    });
});

describe('buildPlayerSnapshot', () => {
    it('maps playback state, track metadata, lyrics and cover', () => {
        const player = snapshot();
        expect(player.status).toBe('playing');
        expect(player.title).toBe('还是好朋友');
        expect(player.artists).toEqual(['古巨基', '梁静茹']);
        expect(player.album).toBe('我还是你的 - 情歌王');
        expect(player.durationSec).toBeCloseTo(251.732);
        expect(player.positionSec).toBeCloseTo(163.2);
        expect(player.rate).toBe(1);
        expect(player.trackId).toBe('/org/mpd/Tracks/86283');
        expect(player.artUrl).toBe('http://p3.music.126.net/cover.jpg');
        expect(player.lyricText).toContain('[00:40.60]');
        expect(player.activeAtMs).toBe(1_000);
    });

    it('keeps activeAtMs while the same track keeps playing, and moves it on a status change', () => {
        const first = snapshot();
        const later = snapshot({
            nowMs: 5_000,
            previous: first,
            properties: mpris.propertiesToObject(playerProperties([
                ['Position', variant('x', 167200000n)],
                ['Metadata', metadata()],
            ])),
        });
        expect(later.activeAtMs).toBe(1_000);

        const paused = snapshot({
            nowMs: 9_000,
            previous: later,
            properties: mpris.propertiesToObject(playerProperties([
                ['PlaybackStatus', variant('s', 'Paused')],
                ['Position', variant('x', 167200000n)],
                ['Metadata', metadata()],
            ])),
        });
        expect(paused.status).toBe('paused');
        expect(paused.activeAtMs).toBe(9_000);
    });

    it('moves activeAtMs when a player without a track id changes song', () => {
        const first = mpris.buildPlayerSnapshot({
            busName: 'org.mpris.MediaPlayer2.firefox',
            identity: 'firefox',
            properties: mpris.propertiesToObject(playerProperties([
                ['Metadata', variant('a{sv}', [['xesam:title', variant('s', '第一个视频')]])],
            ])),
            previous: undefined,
            nowMs: 1_000,
        });
        const second = mpris.buildPlayerSnapshot({
            busName: 'org.mpris.MediaPlayer2.firefox',
            identity: 'firefox',
            properties: mpris.propertiesToObject(playerProperties([
                ['Metadata', variant('a{sv}', [['xesam:title', variant('s', '第二个视频')]])],
            ])),
            previous: first,
            nowMs: 5_000,
        });
        expect(second.activeAtMs).toBe(5_000);
    });

    it('falls back to the bus name for the identity and skips covers the page cannot load', () => {
        const player = mpris.buildPlayerSnapshot({
            busName: 'org.mpris.MediaPlayer2.strawberry',
            identity: '',
            properties: mpris.propertiesToObject(playerProperties([
                ['Metadata', metadata([['mpris:artUrl', variant('s', 'file:///home/saki/cover.png')]])],
            ])),
            previous: undefined,
            nowMs: 1_000,
        });
        expect(player.identity).toBe('org.mpris.MediaPlayer2.strawberry');
        expect(player.artUrl).toBeNull();
    });

    it('shows an empty track rather than throwing when there is no metadata', () => {
        const player = mpris.buildPlayerSnapshot({
            busName: 'org.mpris.MediaPlayer2.vlc',
            identity: 'vlc',
            properties: mpris.propertiesToObject([['PlaybackStatus', variant('s', 'Stopped')]]),
            previous: undefined,
            nowMs: 1_000,
        });
        expect(player.status).toBe('stopped');
        expect(player.title).toBe('');
        expect(player.artists).toEqual([]);
        expect(player.durationSec).toBe(0);
        expect(player.positionSec).toBe(0);
    });
});

describe('pickActiveBusName', () => {
    const player = (busName: string, status: string, activeAtMs: number) => ({ busName, status, activeAtMs });

    it('prefers a playing player over a more recently used paused one', () => {
        expect(mpris.pickActiveBusName([
            player('org.mpris.MediaPlayer2.a', 'paused', 9_000),
            player('org.mpris.MediaPlayer2.b', 'playing', 1_000),
        ])).toBe('org.mpris.MediaPlayer2.b');
    });

    it('among playing players takes the most recent change, then the first by bus name', () => {
        expect(mpris.pickActiveBusName([
            player('org.mpris.MediaPlayer2.a', 'playing', 1_000),
            player('org.mpris.MediaPlayer2.b', 'playing', 2_000),
        ])).toBe('org.mpris.MediaPlayer2.b');
        expect(mpris.pickActiveBusName([
            player('org.mpris.MediaPlayer2.b', 'playing', 2_000),
            player('org.mpris.MediaPlayer2.a', 'playing', 2_000),
        ])).toBe('org.mpris.MediaPlayer2.a');
    });

    it('falls back to paused players, and to nothing when every player is stopped', () => {
        expect(mpris.pickActiveBusName([
            player('org.mpris.MediaPlayer2.a', 'paused', 1_000),
            player('org.mpris.MediaPlayer2.b', 'stopped', 9_000),
        ])).toBe('org.mpris.MediaPlayer2.a');
        expect(mpris.pickActiveBusName([
            player('org.mpris.MediaPlayer2.b', 'stopped', 9_000),
        ])).toBeNull();
        expect(mpris.pickActiveBusName([])).toBeNull();
    });
});
