import { beforeEach, describe, expect, it } from 'vitest';
import { askForSong, askedSongKeyRef, dropPlaysInFlight, makeSongCurrent, playsDroppedSoFar, replaceShownSong, showSong, startPlay, startRestore, withdrawAsk } from '@/components/app/playback/currentSong';
import { setCurrentSong, usePlaybackStore } from '@/stores/usePlaybackStore';
import type { SongResult } from '@/types';

// test/unit/playback/currentSongModule.test.ts
// Pins what each export of src/components/app/playback/currentSong.ts writes: the key of the song asked for, the
// store's song, or both, and in which order. Two routes that cannot be run in a unit test (they
// are functions inside the App component) are pinned here as the calls they make: cancelling a
// blend, and emptying the player.

const song = (id: string, name: string): SongResult => ({
    id, name, artists: [], album: { id: '', name: '' }, durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'bodian', mediaId: id },
});
const songA = song('1', 'A');
const songB = song('2', 'B');
const keyA = 'online:bodian:1';
const keyB = 'online:bodian:2';

const shown = () => usePlaybackStore.getState().currentSong;

beforeEach(() => {
    makeSongCurrent(null);
});

describe('the current song module', () => {
    it('makeSongCurrent writes the key, made from the song, and then the store', () => {
        const keyAtStoreWrite: Array<string | null> = [];
        const stop = usePlaybackStore.subscribe(() => keyAtStoreWrite.push(askedSongKeyRef.current));

        makeSongCurrent(songA);
        stop();

        expect(askedSongKeyRef.current).toBe(keyA);
        expect(shown()).toBe(songA);
        // The key had already moved when the store changed.
        expect(keyAtStoreWrite).toEqual([keyA]);
    });

    it('makeSongCurrent(null) empties both', () => {
        makeSongCurrent(songA);

        makeSongCurrent(null);

        expect(askedSongKeyRef.current).toBeNull();
        expect(shown()).toBeNull();
    });

    it('askForSong writes the key and leaves the store', () => {
        makeSongCurrent(songA);

        askForSong(songB);

        expect(askedSongKeyRef.current).toBe(keyB);
        expect(shown()).toBe(songA);
    });

    it('showSong writes the store and leaves the key, so an overtaken load cannot take the key back', () => {
        askForSong(songA);
        askForSong(songB);

        showSong(songA);

        expect(shown()).toBe(songA);
        expect(askedSongKeyRef.current).toBe(keyB);
    });

    it('replaceShownSong puts another song in the place of the shown one, and the key follows it', () => {
        makeSongCurrent(songA);

        replaceShownSong(songA, songB);

        expect([shown(), askedSongKeyRef.current]).toEqual([songB, keyB]);

        replaceShownSong(songB, null);

        expect([shown(), askedSongKeyRef.current]).toEqual([null, null]);
    });

    it('replaceShownSong leaves the key alone when another song was asked for in the meantime', () => {
        makeSongCurrent(songA);
        askForSong(songB);

        replaceShownSong(songA, { ...songA, name: 'A rebuilt' });

        expect(shown()).toMatchObject({ id: '1', name: 'A rebuilt' });
        expect(askedSongKeyRef.current).toBe(keyB);

        replaceShownSong(songA, null);

        expect([shown(), askedSongKeyRef.current]).toEqual([null, keyB]);
    });

    it('a patch of the song in place does not reach the key', () => {
        makeSongCurrent(songA);

        setCurrentSong(previous => (previous ? { ...previous, isPureMusic: true } : previous));

        expect(shown()).toMatchObject({ id: '1', isPureMusic: true });
        expect(askedSongKeyRef.current).toBe(keyA);
    });

    it('hands the key out for reading only', () => {
        makeSongCurrent(songA);

        expect(() => { (askedSongKeyRef as { current: unknown }).current = keyB; }).toThrow(TypeError);
        expect(askedSongKeyRef.current).toBe(keyA);
    });

    it('cancelling a blend: the outgoing song is shown again first, and the key moves back to it last', () => {
        // The blend's advance: the next song is asked for and shown.
        makeSongCurrent(songA);
        askForSong(songB);
        showSong(songB);

        showSong(songA);
        expect([shown(), askedSongKeyRef.current]).toEqual([songA, keyB]);
        askForSong(songA);
        expect([shown(), askedSongKeyRef.current]).toEqual([songA, keyA]);
    });

    it('switching the music platform: one call leaves no song asked for and none shown', () => {
        makeSongCurrent(songA);
        askForSong(songB);

        makeSongCurrent(null);

        expect([shown(), askedSongKeyRef.current]).toEqual([null, null]);
    });

    it('dropping the plays in flight raises the count a play started with, and touches neither the key nor the store', () => {
        makeSongCurrent(songA);
        const atStart = playsDroppedSoFar();

        dropPlaysInFlight();

        expect(playsDroppedSoFar()).toBe(atStart + 1);
        expect([shown(), askedSongKeyRef.current]).toEqual([songA, keyA]);
    });

    it('a withdrawn ask puts the key back on the song that is shown, and leaves a newer ask alone', () => {
        makeSongCurrent(songA);
        askForSong(songB);

        withdrawAsk(songB);
        expect([shown(), askedSongKeyRef.current]).toEqual([songA, keyA]);

        // B asked, then A was asked for again by another play: B's withdrawal changes nothing.
        makeSongCurrent(null);
        askForSong(songB);
        askForSong(songA);
        withdrawAsk(songB);
        expect([shown(), askedSongKeyRef.current]).toEqual([null, keyA]);
    });

    it('a play is still wanted until a newer play starts or the plays in flight are dropped', () => {
        const first = startPlay();
        expect(first()).toBe(true);

        const second = startPlay();
        expect([first(), second()]).toEqual([false, true]);

        dropPlaysInFlight();
        expect([first(), second()]).toEqual([false, false]);
        // A play that starts after the drop is wanted again.
        expect(startPlay()()).toBe(true);
    });

    it('a play whose song shows is no longer overtaken once every newer play gave up, a play still on its way stays overtaken', () => {
        const shown = startPlay();
        expect(shown.onceShown()).toBe(true);

        // A newer play starts (a click on a song whose file cannot be read) and gives up.
        const gaveUp = startPlay();
        expect([shown(), shown.onceShown()]).toEqual([false, false]);
        gaveUp.abandon();
        expect(shown.onceShown()).toBe(true);
        // The plain answer stays: a play that was still on its way when that one started is overtaken for good.
        expect(shown()).toBe(false);
        // The one that gave up keeps its own answers (a countdown to the next song still asks them).
        expect([gaveUp(), gaveUp.onceShown()]).toEqual([true, true]);
        gaveUp.abandon();
        expect(shown.onceShown()).toBe(true);

        // Two newer plays: while one of them stands, the play before both is overtaken.
        const handedOver = startPlay();
        const pending = startPlay();
        handedOver.abandon();
        expect(shown.onceShown()).toBe(false);
        expect(pending.onceShown()).toBe(true);
        pending.abandon();
        expect(shown.onceShown()).toBe(true);

        // A newer play that showed its song (it never abandons) leaves it overtaken; so does a drop.
        const landed = startPlay();
        expect(shown.onceShown()).toBe(false);
        landed.abandon();
        dropPlaysInFlight();
        expect([shown.onceShown(), landed.onceShown()]).toEqual([false, false]);
        expect(startPlay().onceShown()).toBe(true);
    });

    it('forgets the oldest plays past the newest 64: those stay overtaken, the newer ones answer as before', () => {
        dropPlaysInFlight();
        const oldest = startPlay();
        const newer = Array.from({ length: 64 }, () => startPlay());
        newer.forEach(play => play.abandon());
        expect(oldest.onceShown()).toBe(false);
        expect(newer[0].onceShown()).toBe(true);
    });

    it('a restore is still wanted until a song is asked for again, the same one too, or the plays in flight are dropped', () => {
        makeSongCurrent(songA);
        const restore = startRestore();
        // A play that has started and has not asked yet ends nothing of the restore.
        startPlay();
        expect(restore()).toBe(true);
        // The restore's own rebuilt song in the place of the shown one is the same ask.
        replaceShownSong(songA, { ...songA, name: 'A rebuilt' });
        expect(restore()).toBe(true);

        askForSong(songA);
        expect(restore()).toBe(false);

        makeSongCurrent(songA);
        const second = startRestore();
        dropPlaysInFlight();
        expect(second()).toBe(false);
    });
});
