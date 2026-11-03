import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { SongResult } from '../../../types';
import { getProviderSongMetadata } from '../../../services/onlineMusic/songMetadata';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';
import { getMatchResultAlbumName, getMatchResultArtists, getMatchResultCoverUrl } from '../../../utils/lyrics/matchResult';
import { formatSongName } from '../../../utils/songNameFormatter';
import { LyricMatchWindow } from './LyricMatchWindow';
import { pickOnlineResult, saveOnlineLyricMatch } from './onlineSongMatch';
import { useLyricMatchSearch } from './useLyricMatchSearch';

// src/components/modal/lyric-match/OnlineSongLyricMatch.tsx
// The lyric match window for a song of an online platform: only the lyrics are matched.

interface OnlineSongLyricMatchProps {
    song: SongResult;
    onClose: () => void;
    onMatch: () => void;
    isDaylight: boolean;
}

const OnlineSongLyricMatch: React.FC<OnlineSongLyricMatchProps> = ({ song, onClose, onMatch, isDaylight }) => {
    const { t } = useTranslation();
    const metadata = getProviderSongMetadata(song);

    const songInfo = useMemo(() => ({
        title: song.name || '',
        artist: metadata.artists.map(item => item.name).join(', '),
        album: metadata.album?.name || '',
        durationMs: metadata.durationMs,
    }), [song]);

    const search = useLyricMatchSearch(song, songInfo, { pickResult: pickOnlineResult, resetsQueryOnSourceChange: true });
    const { source, selectedResult } = search;

    const save = async (result: SongResult) => {
        try {
            if (!await saveOnlineLyricMatch(song, source, result)) {
                setStatusMessage({ type: 'error', text: t('localMusic.noLyricsAvailable') });
                return;
            }
            onMatch();
        } catch (error) {
            console.error('Online lyric match failed', error);
        }
    };

    return (
        <LyricMatchWindow
            search={search}
            isDaylight={isDaylight}
            onClose={onClose}
            songLine={song.name}
            preview={selectedResult ? {
                coverUrl: getMatchResultCoverUrl(selectedResult, source),
                title: formatSongName(selectedResult),
                artist: getMatchResultArtists(selectedResult),
                album: getMatchResultAlbumName(selectedResult),
            } : {
                coverUrl: metadata.coverUrl,
                title: song.name,
                artist: songInfo.artist,
                album: songInfo.album,
            }}
            savingLabel={t('localMusic.matching')}
            onSave={save}
            // The three below are how this window was before the three windows became one.
            overAllLayers
            keepsHotkeys
            closesOnBackdropClick
        />
    );
};

export default OnlineSongLyricMatch;
