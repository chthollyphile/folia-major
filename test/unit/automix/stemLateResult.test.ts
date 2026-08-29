import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';

// test/unit/automix/stemLateResult.test.ts
// What happens to a window whose model finishes AFTER the pair it was for stopped being the pair a
// transition is coming for. It is KEPT, and this exists because the opposite was written first.
//
// The reasoning for discarding it sounded like a root-cause fix: `ensureStems` asks "is this still
// wanted" immediately before the model and never after, and the model is the only step slow enough
// for the answer to change. But the question in front of the model is "is this worth ten seconds",
// and after it those ten seconds are spent - all that is left is one cache slot, which is eviction's
// to decide. Discarding measured worse on a real session: seeking mid-blend cancels it and leaves
// the listener on the SAME track, so the pair being prepared is the pair arming again a minute
// later. Three cancels, three windows thrown away, three separations to build the same window back -
// seven model runs where keeping them needs four.
//
// Every assertion is about how many times the MODEL is entered, because that is what this costs in
// seconds and in gigabytes.

const { getCachedSongAudioBlob } = vi.hoisted(() => ({
    getCachedSongAudioBlob: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/services/audioCache', () => ({
    onAudioCached: () => () => { },
    getCachedAudioBlob: vi.fn(),
    hasCachedAudio: vi.fn().mockResolvedValue(false),
    saveAudioBlob: vi.fn(),
}));
vi.mock('@/services/onlineMusic/resourceCache', () => ({ getCachedSongAudioBlob }));

import { refreshModelAvailability } from '@/services/automix/modelAvailability';
import { ensureStems, setWantedStems, stemWindowKey } from '@/services/automix/stems';

const SAMPLES = 1024;
const rows = () => ({ left: new Float32Array(SAMPLES), right: new Float32Array(SAMPLES) });

/** Enough of a decoded track for `cutWindow`; the shape is all that is read. */
const decoded = {
    length: SAMPLES,
    numberOfChannels: 2,
    getChannelData: () => new Float32Array(SAMPLES),
};

const songNamed = (id: string): SongResult => ({
    id,
    name: `track ${id}`,
    sourceRef: { kind: 'online', providerId: 'kugou', mediaId: id },
} as unknown as SongResult);

/** Stands up the environment `ensureStems` needs and counts entries into the model. */
const deck = () => {
    // Called from inside the mocked model, which is where a listener's change of mind actually
    // lands: the check in front of the model has already passed by then, and that interval is the
    // whole subject of this file.
    let duringModel = () => { };
    const separateStems = vi.fn(async () => {
        duringModel();
        return { drums: rows(), bass: rows(), vocals: rows() };
    });
    (globalThis as { window?: object }).window = {
        electron: {
            separateStems,
            getAutomixModelsPresent: vi.fn().mockResolvedValue({ beat_this: true, htdemucs: true }),
        },
        OfflineAudioContext: class {
            decodeAudioData() { return Promise.resolve(decoded); }
        },
    };
    return {
        separateStems,
        ready: refreshModelAvailability(),
        separate: (song: SongResult, stillWanted: () => boolean, onModel = () => { }) => {
            duringModel = onModel;
            return ensureStems({
                song,
                role: 'tail' as const,
                readBytes: () => Promise.resolve(new ArrayBuffer(8)),
                stillWanted,
            });
        },
    };
};

describe('a window whose pair moved on while the model was running', () => {
    beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => { }); });

    it('is still stored, so a cancel loop costs one model run and not four', async () => {
        // The measured session, in the small: arm, seek, arm, seek, arm. Each seek cancels the
        // blend and leaves the listener on the track already playing, so `wanted` swings back to it
        // and the window being prepared is briefly unwanted - while its model is still running.
        const song = songNamed('loop');
        const playing = stemWindowKey(songNamed('playing'), 'tail');
        const { separateStems, ready, separate } = deck();
        await ready;

        for (let cancels = 0; cancels < 3; cancels += 1) {
            let paired = true;
            setWantedStems([stemWindowKey(song, 'tail')]);
            await separate(song, () => paired, () => {
                paired = false;
                setWantedStems([playing]);
            });
        }

        // Discarding it instead made this four, and every extra one is ten seconds of htdemucs and
        // a multi-gigabyte peak for a window that was already in hand.
        expect(separateStems).toHaveBeenCalledTimes(1);
    });

    it('still gives up before the model when the pair has already gone', async () => {
        // The check in FRONT of the model is untouched and is the one that saves the ten seconds.
        // Without this, "keep what is paid for" would read as "never cancel anything".
        const { separateStems, ready, separate } = deck();
        await ready;
        const song = songNamed('abandoned');
        setWantedStems([stemWindowKey(song, 'tail')]);

        await separate(song, () => false);

        expect(separateStems).not.toHaveBeenCalled();
    });
});
