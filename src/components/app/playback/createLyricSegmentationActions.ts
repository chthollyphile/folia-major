import i18n from '../../../i18n/config';
import type { LyricData, SongResult } from '../../../types';
import type { LyricSegmentationSource } from '../../../types/lyricSegmentation';
import { deleteSongSegmentation, saveSongSegmentation } from '../../../services/lyricSegmentation';
import { setLyricSegmentationRecord } from '../../../stores/useLyricSegmentationStore';
import { setStatusMessage as setStatusMsg } from '../../../stores/useStatusMessageStore';
import { createLyricSegmentationRecord } from '../../../utils/lyrics/lyricSegmentationRecord';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';

// src/components/app/playback/createLyricSegmentationActions.ts
// Save and reset for the current song's word segmentation.
//
// Same shape as createLyricFilterPatternSaver, and for the same reason: changing the setting is
// only half the job. The lines already on screen were built with the old split, so the song's
// lyrics have to be laid out again through the normal pipeline — which is what re-fetching the
// preview and handing it back to setLyrics does. Writing the store first means that pass picks the
// new record up.

type CreateLyricSegmentationActionsParams = {
    getCurrentSong: () => SongResult | null;
    loadCurrentSongLyricPreview: () => Promise<LyricData | null>;
    setLyrics: (lyrics: LyricData | null) => void;
};

export type LyricSegmentationSaveOptions = {
    /**
     * Playback key the lines were made for. When set and the current song no longer has it, the
     * save is dropped: a background run that resolves after a skip must not land on the next song.
     */
    songKey?: string;
    /** Saved by the automatic run rather than by the user, which the status line says. */
    auto?: boolean;
};

export type LyricSegmentationActions = {
    save: (lines: Record<string, string[]>, source: LyricSegmentationSource, options?: LyricSegmentationSaveOptions) => Promise<void>;
    reset: () => Promise<void>;
};

export const createLyricSegmentationActions = ({
    getCurrentSong,
    loadCurrentSongLyricPreview,
    setLyrics,
}: CreateLyricSegmentationActionsParams): LyricSegmentationActions => {
    const isStillPlaying = (songKey: string) => {
        const current = getCurrentSong();
        return current !== null && getPlaybackSongKey(current) === songKey;
    };

    /**
     * Lays `songKey`'s lyrics out again, unless another song started meanwhile: the preview load
     * can go to the network, and the setter does not check whose lyrics it is handed.
     */
    const relayoutCurrentLyrics = async (songKey: string) => {
        const preview = await loadCurrentSongLyricPreview();
        if (isStillPlaying(songKey)) {
            setLyrics(preview);
        }
    };

    return {
        save: async (lines, source, options = {}) => {
            const song = getCurrentSong();
            if (!song) {
                return;
            }
            const songKey = getPlaybackSongKey(song);
            if (options.songKey && options.songKey !== songKey) {
                return;
            }

            const record = createLyricSegmentationRecord(songKey, source, lines);
            await saveSongSegmentation(song, record);
            // The IndexedDB write is async too: a skip during it still keeps the record on disk
            // for the song it belongs to, but must not put it in the store or re-lay the new song.
            if (!isStillPlaying(songKey)) {
                return;
            }
            setLyricSegmentationRecord(record.songKey, record);
            await relayoutCurrentLyrics(songKey);
            setStatusMsg({
                type: 'success',
                text: i18n.t(options.auto ? 'lyricSegmentation.autoSaved' : 'lyricSegmentation.saved'),
            });
        },

        reset: async () => {
            const song = getCurrentSong();
            if (!song) {
                return;
            }

            const songKey = getPlaybackSongKey(song);
            await deleteSongSegmentation(song);
            if (!isStillPlaying(songKey)) {
                return;
            }
            setLyricSegmentationRecord(songKey, null);
            await relayoutCurrentLyrics(songKey);
            setStatusMsg({ type: 'success', text: i18n.t('lyricSegmentation.restored') });
        },
    };
};
