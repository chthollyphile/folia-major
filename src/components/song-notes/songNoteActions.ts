import i18n from '../../i18n/config';
import type { SongResult } from '../../types';
import { setStatusMessage } from '../../stores/useStatusMessageStore';
import { SONG_NOTE_MAX_COMMENTS, SONG_NOTE_MAX_TAGS } from './songNotesModel';
import {
    addSongComment,
    addSongTag,
    deleteSongComment,
    editSongComment,
    removeSongTag,
    type SongNoteResult,
    type SongNoteWriteError,
} from './songNotesService';

// src/components/song-notes/songNoteActions.ts
// 界面上的写操作：调 songNotesService，写不成时报一句（上限、没存上）。速记簿「评论」页、播放条图钉、命令共用。

const report = (error: SongNoteWriteError): void => {
    if (error === 'empty' || error === 'notFound') return;
    const text = error === 'tooManyComments'
        ? i18n.t('songNotes.tooManyComments', { count: SONG_NOTE_MAX_COMMENTS })
        : error === 'tooManyTags'
            ? i18n.t('songNotes.tooManyTags', { count: SONG_NOTE_MAX_TAGS })
            : error === 'stage'
                ? i18n.t('songNotes.stageSong')
                : i18n.t('songNotes.saveFailed');
    setStatusMessage({ type: 'error', text });
};

const reported = async <T>(work: Promise<SongNoteResult<T>>): Promise<SongNoteResult<T>> => {
    const result = await work;
    if (!result.ok) report(result.error);
    return result;
};

export const writeSongComment = (song: SongResult, text: string, at?: number | null) => reported(addSongComment(song, { text, at }));
export const rewriteSongComment = (id: string, text: string) => reported(editSongComment(id, text));
export const eraseSongComment = (id: string) => reported(deleteSongComment(id));
export const tagSong = (song: SongResult, name: string) => reported(addSongTag(song, name));
export const untagSong = (songKey: string, tagKey: string) => reported(removeSongTag(songKey, tagKey));
