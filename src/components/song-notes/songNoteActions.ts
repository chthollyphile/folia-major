import i18n from '../../i18n/config';
import type { SongResult } from '../../types';
import { setStatusMessage } from '../../stores/useStatusMessageStore';
import { SONG_NOTE_MAX_COMMENTS, SONG_NOTE_MAX_TAGS } from './songNotesModel';
import {
    addSongComment,
    addSongTag,
    deleteSongComment,
    deleteSongNoteTag,
    editSongComment,
    moveSongNoteTag,
    removeSongTag,
    renameSongNoteTag,
    tagSongs,
    untagSongs,
    type SongNoteResult,
    type SongNoteWriteError,
} from './songNotesService';

// src/components/song-notes/songNoteActions.ts
// 界面上的写操作：调 songNotesService，写不成时报一句（上限、没存上）。速记簿「时刻」页、播放条图钉、命令、标签整理与批量打标签共用。

const report = (error: SongNoteWriteError): void => {
    if (error === 'empty' || error === 'notFound' || error === 'conflict') return;
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

/** 改名；conflict（改成了另一个已有的标签）不报，调用方去问要不要合并。成了报一句。 */
export const renameTag = async (tagKey: string, name: string, merge = false) => {
    const result = await reported(renameSongNoteTag(tagKey, name, { merge }));
    if (result.ok) {
        setStatusMessage({ type: 'success', text: i18n.t(merge ? 'songNotes.tagMerged' : 'songNotes.tagRenamed', { tag: result.value.name }) });
    }
    return result;
};

export const deleteTag = async (tagKey: string, name: string) => {
    const result = await reported(deleteSongNoteTag(tagKey));
    if (result.ok) setStatusMessage({ type: 'success', text: i18n.t('songNotes.tagDeleted', { tag: name }) });
    return result;
};

export const moveTag = (tagKey: string, step: -1 | 1) => reported(moveSongNoteTag(tagKey, step));

/** 给一批歌打标签，报打上了几首、跳过了几首。 */
export const tagSongsReported = async (songs: readonly SongResult[], name: string) => {
    const result = await reported(tagSongs(songs, name));
    if (result.ok) {
        const { tag, tagged, skipped } = result.value;
        if (tagged === 0 && skipped > 0) {
            setStatusMessage({ type: 'error', text: i18n.t('songNotes.tagNoneTaken', { count: skipped }) });
        } else if (tagged === 0 && tag) {
            setStatusMessage({ type: 'info', text: i18n.t('songNotes.alreadyTagged', { tag: tag.name }) });
        } else if (tag) {
            const text = i18n.t('songNotes.taggedSongs', { count: tagged, tag: tag.name });
            setStatusMessage({ type: 'success', text: skipped > 0 ? `${text}${i18n.t('songNotes.taggedSkipped', { count: skipped })}` : text });
        }
    }
    return result;
};

/** 从一批歌上去掉一个标签，报去掉了几首。 */
export const untagSongsReported = async (songKeys: readonly string[], tagKey: string, name: string) => {
    const result = await reported(untagSongs(songKeys, tagKey));
    if (result.ok && result.value > 0) {
        setStatusMessage({ type: 'success', text: i18n.t('songNotes.untaggedSongs', { count: result.value, tag: name }) });
    }
    return result;
};
