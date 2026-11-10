import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SongResult } from '../../../types';
import { getNavidromeMatchCacheKey, type NavidromeMatchData, type NavidromeSong } from '../../../types/navidrome';
import { getFromCacheWithMigration } from '../../../services/db';
import { getProviderSongMetadata } from '../../../services/onlineMusic/songMetadata';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';
import { getMatchResultAlbumName, getMatchResultArtists, getMatchResultCoverUrl } from '../../../utils/lyrics/matchResult';
import { migrateMatchedLyricsCarrierRenderHints } from '../../../utils/lyrics/storageMigration';
import { formatSongName } from '../../../utils/songNameFormatter';
import { LyricMatchWindow } from './LyricMatchWindow';
import { pickNavidromeResult, saveNavidromeLyricMatch, saveNavidromeNoMatch } from './navidromeSongMatch';
import { useLyricMatchSearch } from './useLyricMatchSearch';

// src/components/modal/lyric-match/NavidromeSongLyricMatch.tsx
// The lyric match window for a song of a Navidrome server. Such a song has lyrics of its own on
// the server: the window says whether the match or the server's lyrics will be used.

interface NavidromeSongLyricMatchProps {
    song: NavidromeSong;
    onClose: () => void;
    onMatch: () => void;
    isDaylight: boolean;
}

const NavidromeSongLyricMatch: React.FC<NavidromeSongLyricMatchProps> = ({ song, onClose, onMatch, isDaylight }) => {
    const { t } = useTranslation();
    const [lyricsSource, setLyricsSource] = useState<'navi' | 'online'>('online');

    const metadata = getProviderSongMetadata(song);
    const artist = metadata.artists.map(a => a.name).join(', ');
    const album = metadata.album?.name || '';

    const songInfo = useMemo(() => ({
        title: song.name || '',
        artist,
        album,
        durationMs: metadata.durationMs,
    }), [song, artist, album]);

    // The lyric choice stored with an earlier match of this song.
    useEffect(() => {
        const loadExistingMatch = async () => {
            const data = await getFromCacheWithMigration<NavidromeMatchData>(
                getNavidromeMatchCacheKey(song),
                migrateMatchedLyricsCarrierRenderHints
            );
            setLyricsSource(data?.lyricsSource ?? 'online');
        };
        loadExistingMatch();
    }, [song]);

    const search = useLyricMatchSearch(song, songInfo, {
        pickResult: results => pickNavidromeResult(results, song.name),
        resetsQueryOnSourceChange: true,
    });
    const { source, selectedResult } = search;

    // When a search result is selected, update lyricsSource to 'online'
    useEffect(() => {
        if (selectedResult) {
            setLyricsSource('online');
        }
    }, [selectedResult]);

    const save = async (result: SongResult) => {
        try {
            if (!await saveNavidromeLyricMatch(song, source, result, lyricsSource)) {
                setStatusMessage({ type: 'error', text: t('localMusic.noLyricsAvailable') });
                return;
            }
            onMatch();
        } catch (error) {
            console.error('Failed to save Navidrome match:', error);
            setStatusMessage({ type: 'error', text: t('localMusic.matchFailed') });
        }
    };

    const saveNoMatch = async () => {
        try {
            await saveNavidromeNoMatch(song);
            onMatch();
        } catch (error) {
            console.error('Failed to save no match preference:', error);
        }
    };

    const coverUrl = metadata.coverUrl || song.navidromeData?.coverArtUrl || null;

    return (
        <LyricMatchWindow
            search={search}
            isDaylight={isDaylight}
            onClose={onClose}
            titleNote="(Navidrome)"
            preview={{
                coverUrl: getMatchResultCoverUrl(selectedResult, source) || coverUrl,
                title: selectedResult ? formatSongName(selectedResult) : song.name,
                artist: selectedResult ? getMatchResultArtists(selectedResult) : artist,
                album: selectedResult ? getMatchResultAlbumName(selectedResult) : album,
            }}
            status={selectedResult && {
                label: t('localMusic.matchStatus'),
                text: lyricsSource === 'online' ? t('localMusic.preferOnline') : t('localMusic.forceServer'),
                tone: lyricsSource === 'online' ? 'blue' : 'orange',
            }}
            savingLabel={t('localMusic.saving')}
            onSave={save}
            noMatch={{ label: t('localMusic.skipOnlineMatch'), run: saveNoMatch }}
        />
    );
};

export default NavidromeSongLyricMatch;
