import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// test/unit/ytm/ytmSongVersion.test.ts — which YouTube Music entries are official music videos,
// and which song a signed-in account's watch page pairs with one. The ids are as YouTube Music
// paired them for an account (2026-10-23).

const require = createRequire(import.meta.url);
const { songEntryOf, videoFieldsOf } = require('../../../electron/ytm/songVersion.cjs');

const endpointOf = (musicVideoType: string) => ({ watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { musicVideoType } } });
const entry = (videoId: string, musicVideoType: string) => ({ video_id: videoId, endpoint: { payload: endpointOf(musicVideoType) } });

describe('an official music video and its song', () => {
    it('is told by the kind its watch endpoint names', () => {
        expect(videoFieldsOf(endpointOf('MUSIC_VIDEO_TYPE_OMV'))).toEqual({ video: true, officialVideo: true });
        // Somebody else's upload (a cover) is a video, but no official one.
        expect(videoFieldsOf(endpointOf('MUSIC_VIDEO_TYPE_UGC'))).toEqual({ video: true });
        // A song and an endpoint that names no kind are neither.
        expect(videoFieldsOf(endpointOf('MUSIC_VIDEO_TYPE_ATV'))).toEqual({});
        expect(videoFieldsOf({})).toEqual({});
        expect(videoFieldsOf(undefined)).toEqual({});
    });

    it('is paired by the watch page entry of the video', () => {
        const wrappers = [
            { primary: entry('VX8sWR1m14Y', 'MUSIC_VIDEO_TYPE_ATV'), counterpart: [entry('PL9o0xj7RyM', 'MUSIC_VIDEO_TYPE_OMV')] },
            { primary: entry('GrAchTdepsU', 'MUSIC_VIDEO_TYPE_OMV'), counterpart: [entry('UNOtbkQxECI', 'MUSIC_VIDEO_TYPE_ATV')] },
        ];
        expect(songEntryOf(wrappers, 'GrAchTdepsU')?.video_id).toBe('UNOtbkQxECI');
        // A song's counterpart is its video, which is no song of it.
        expect(songEntryOf(wrappers, 'VX8sWR1m14Y')).toBeNull();
        // A video the page holds no pair for, or no entry of, has none.
        expect(songEntryOf([{ primary: entry('1yBjFEpG3xQ', 'MUSIC_VIDEO_TYPE_OMV') }], '1yBjFEpG3xQ')).toBeNull();
        expect(songEntryOf(wrappers, '1yBjFEpG3xQ')).toBeNull();
    });
});
