import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// MPRIS 值的线上形状（a{sv} 解码成 [name, { signature, value }] 对）和活动播放器的挑选规则。
// 这两处都只做纯计算，播放器是否真的在放、Dux 选中谁，靠这两个结果。

const require = createRequire(import.meta.url);
const { isMprisName, normalizePlayer, playerTrackKey, propertyMap, selectActivePlayer } = require('../../../electron/dux/mprisClient.cjs') as {
    isMprisName: (name: string) => boolean;
    normalizePlayer: (input: { name: string; root?: unknown; player?: unknown }) => {
        name: string;
        identity: string;
        playbackStatus: string;
        canControl: boolean;
        positionSec: number;
        title: string;
        artists: string[];
        album: string;
        artUrl: string | null;
        lengthSec: number | null;
    };
    playerTrackKey: (player: { name: string; trackId: string | null; title: string; artists: string[]; album: string; lengthSec: number | null }) => string;
    propertyMap: (raw: unknown) => Record<string, unknown>;
    selectActivePlayer: (players: unknown[], previousName?: string | null) => { name: string } | null;
};

const variant = (value: unknown) => ({ signature: typeof value === 'bigint' ? 'x' : 's', value });
const player = (name: string, status: string, extra: Record<string, unknown> = {}) => ({
    name,
    playbackStatus: status,
    canControl: true,
    trackId: null,
    title: name,
    artists: [name],
    album: '',
    lengthSec: 200,
    ...extra,
});

describe('propertyMap', () => {
    it('unwraps variant entries', () => {
        expect(propertyMap([['Identity', variant('Apple Music')], ['CanControl', variant(true)]])).toEqual({
            Identity: 'Apple Music',
            CanControl: true,
        });
    });
});

describe('normalizePlayer', () => {
    it('converts the microsecond length and keeps the metadata together', () => {
        const normalized = normalizePlayer({
            name: 'org.mpris.MediaPlayer2.Valent.Player4',
            root: [['Identity', variant('Apple Music')]],
            player: [
                ['PlaybackStatus', variant('Playing')],
                ['CanControl', variant(true)],
                ['Position', variant(81000000n)],
                ['Metadata', variant([
                    ['xesam:title', variant('spiral')],
                    ['xesam:artist', variant(['LONGMAN'])],
                    ['xesam:album', variant('spiral - Single')],
                    ['mpris:length', variant(231000000n)],
                    ['mpris:artUrl', variant('file:///tmp/cover')],
                    ['mpris:trackid', variant('/track/1')],
                ])],
            ],
        });
        expect(normalized).toMatchObject({
            identity: 'Apple Music',
            playbackStatus: 'Playing',
            canControl: true,
            positionSec: 81,
            title: 'spiral',
            artists: ['LONGMAN'],
            album: 'spiral - Single',
            lengthSec: 231,
            artUrl: 'file:///tmp/cover',
            trackId: '/track/1',
        });
    });
});

describe('selectActivePlayer', () => {
    it('prefers a playing controllable player and keeps the current pick while it plays', () => {
        const players = [player('a', 'Paused'), player('b', 'Playing'), player('c', 'Playing')];
        expect(selectActivePlayer(players)?.name).toBe('b');
        expect(selectActivePlayer(players, 'c')?.name).toBe('c');
    });

    it('falls back to a paused player when nothing plays', () => {
        expect(selectActivePlayer([player('a', 'Stopped'), player('b', 'Paused')])?.name).toBe('b');
    });

    it('ignores players that cannot be controlled when another can', () => {
        const players = [player('a', 'Playing', { canControl: false }), player('b', 'Paused')];
        expect(selectActivePlayer(players)?.name).toBe('b');
    });

    it('is null without players or with only stopped ones', () => {
        expect(selectActivePlayer([])).toBeNull();
        expect(selectActivePlayer([player('a', 'Stopped')])).toBeNull();
    });
});

describe('isMprisName', () => {
    it('accepts ordinary players and rejects helper and Folia players', () => {
        expect(isMprisName('org.mpris.MediaPlayer2.Valent.Player4')).toBe(true);
        expect(isMprisName('org.mpris.MediaPlayer2.chromium.instance51')).toBe(true);
        expect(isMprisName('org.mpris.MediaPlayer2.playerctld')).toBe(false);
        expect(isMprisName('org.mpris.MediaPlayer2.folia')).toBe(false);
        expect(isMprisName('org.mpris.MediaPlayer2.folia.instance42')).toBe(false);
        // Folia's own web audio, as Chromium's media session registers it under the main process id.
        expect(isMprisName(`org.mpris.MediaPlayer2.chromium.instance${process.pid}`)).toBe(false);
        expect(isMprisName('org.freedesktop.DBus')).toBe(false);
    });
});

describe('playerTrackKey', () => {
    it('changes when any identity field changes', () => {
        const first = playerTrackKey({ ...player('a', 'Playing'), trackId: null });
        const second = playerTrackKey({ ...player('a', 'Playing'), trackId: null, title: 'other' });
        expect(first).not.toBe(second);
    });
});
