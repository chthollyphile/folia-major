import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';

// test/unit/playback/previewNotice.test.ts
// A preview clip is told of when the player starts to play it (the active deck's `playing`), once
// per start of the song. `playing` comes again after every pause and every stall, the recovery
// gives a running song a new address, and a cancelled blend or a play that gave up puts the song
// back that was playing: none of these is a new start. And a `playing` of the source before, while
// a new song is being set up, is not the new song's start.

vi.mock('@/services/onlineMusic/omni', () => ({
    omni: {
        isPreviewAudioSource: (url: string) => url.includes('trial'),
        previewNoticeKey: () => 'status.songPreviewOnly',
    },
}));

const { notePreviewPlaying } = await import('@/components/app/playback/source/previewNotice');
const { askForSong, makeSongCurrent, showSong, withdrawAsk } = await import('@/components/app/playback/currentSong');
const { setAudioSrc } = await import('@/stores/usePlaybackStore');
const { setStatusMessage, useStatusMessageStore } = await import('@/stores/useStatusMessageStore');

const songOf = (id: string) => ({
    id, name: `Song ${id}`, artists: [], album: { id: '', name: '' }, durationMs: 200_000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: id },
}) as unknown as SongResult;
const clipOf = (id: string, n = 1) => `https://m701.music.126.net/trial-${id}-${n}.mp3`;
const wholeOf = (id: string) => `https://m701.music.126.net/whole-${id}.mp3`;
const t = (key: string) => key;
const told = () => {
    const message = useStatusMessageStore.getState().message;
    setStatusMessage(null);
    return message;
};
/** playSong as far as the player: asked for, shown, its address written, playing. */
const play = (song: SongResult, src: string) => {
    makeSongCurrent(song);
    setAudioSrc(src);
    notePreviewPlaying(src, t);
};

describe('notePreviewPlaying', () => {
    beforeEach(() => setStatusMessage(null));

    it('tells once per start of the song, with the platform\'s mark', () => {
        play(songOf('1'), clipOf('1'));
        expect(told()).toEqual({ type: 'info', text: 'status.songPreviewOnly', providerId: 'netease' });

        // A pause and a resume, then the recovery's new address for the same song.
        notePreviewPlaying(clipOf('1'), t);
        setAudioSrc(clipOf('1', 2));
        notePreviewPlaying(clipOf('1', 2), t);
        expect(told()).toBeNull();

        // The song played again.
        play(songOf('1'), clipOf('1', 2));
        expect(told()).toMatchObject({ text: 'status.songPreviewOnly' });
    });

    it('says nothing for a URL that is not a clip', () => {
        play(songOf('2'), wholeOf('2'));
        notePreviewPlaying('', t);
        expect(told()).toBeNull();
    });

    // A blend into the next song is cancelled by a pause or a seek: the outgoing clip goes on.
    it.each([['a whole song', wholeOf('4')], ['a clip', clipOf('4')]])('does not tell again of a clip a blend into %s was cancelled back onto', (_next, nextSrc) => {
        play(songOf('3'), clipOf('3'));
        expect(told()).not.toBeNull();
        play(songOf('4'), nextSrc);
        told();

        // What App.tsx's cancel does: the outgoing source, the outgoing song, put back.
        setAudioSrc(clipOf('3'));
        showSong(songOf('3'));
        askForSong(songOf('3'), { putBack: true });
        notePreviewPlaying(clipOf('3'), t);
        expect(told()).toBeNull();
    });

    it('does not tell again of a clip a play that gave up left playing', () => {
        play(songOf('5'), clipOf('5'));
        told();

        askForSong(songOf('6'));
        withdrawAsk(songOf('6'));
        notePreviewPlaying(clipOf('5'), t);
        expect(told()).toBeNull();
    });

    // playSong asks for the new song before it shows it and writes its address; the deck still plays
    // the source before in between, and can say `playing` for it.
    it('does not let a playing of the source before use up the new song\'s notice', () => {
        play(songOf('7'), clipOf('7'));
        told();

        askForSong(songOf('8'));
        notePreviewPlaying(clipOf('7'), t);
        showSong(songOf('8'));
        setAudioSrc(null);
        notePreviewPlaying(clipOf('7'), t);
        expect(told()).toBeNull();

        setAudioSrc(clipOf('8'));
        notePreviewPlaying(clipOf('8'), t);
        expect(told()).toMatchObject({ text: 'status.songPreviewOnly' });
    });
});
