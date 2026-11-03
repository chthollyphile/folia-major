import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Piano } from 'lucide-react';
import type { LocalSong, SongResult } from '../../../types';
import { getLocalCoverAssetUrl } from '../../../services/localCoverAssetUrl';
import { setLocalSongPureMusicMark } from '../../../services/localSongMatchSelectionService';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';
import {
    getLyricMatchSourceLabel,
    getMatchResultAlbumName,
    getMatchResultArtists,
    getMatchResultCoverUrl,
    sourceProvidesSongMetadata,
    sourceSupportsCover,
} from '../../../utils/lyrics/matchResult';
import { formatSongName } from '../../../utils/songNameFormatter';
import { useConfirmDialog } from '../../shared/useConfirmDialog';
import { LyricMatchWindow } from './LyricMatchWindow';
import { getLocalSongMatchFailureKey, saveLocalSongMatch, saveLocalSongNoMatch } from './localSongMatch';
import { useLyricMatchSearch } from './useLyricMatchSearch';

// src/components/modal/lyric-match/LocalSongLyricMatch.tsx
// The lyric match window for a local file. Only a local file has the three switches: a result
// can also give it a cover and metadata, and each of the three can be left as the file has it.
// Only a local file can also be marked as instrumental, which stops lyrics being matched to it
// automatically.

interface LocalSongLyricMatchProps {
    song: LocalSong;
    onClose: () => void;
    /** The selection is saved. `failureMessage`: what of it could not be applied, when something could not. */
    onMatch: (failureMessage?: string) => void;
    /** The instrumental mark was switched. Not onMatch: the mark changes the lyrics only, nothing has to play again. */
    onPureMusicMarkChanged: (marked: boolean) => void | Promise<void>;
    isDaylight: boolean;
}

const LocalSongLyricMatch: React.FC<LocalSongLyricMatchProps> = ({ song, onClose, onMatch, onPureMusicMarkChanged, isDaylight }) => {
    const { t } = useTranslation();
    const { ask: askConfirm, dialog: confirmDialog } = useConfirmDialog(isDaylight);
    const [isMarkingPureMusic, setIsMarkingPureMusic] = useState(false);

    // Online data toggle state (dots)
    const [lyricsSource, setLyricsSource] = useState<'local' | 'embedded' | 'online' | undefined>(song.lyricsSource || 'online');
    const [useOnlineCover, setUseOnlineCover] = useState(song.useOnlineCover ?? !song.localCoverAssetId);
    const [useOnlineMetadata, setUseOnlineMetadata] = useState(song.titleOrigin !== 'import');

    // Derive song information for matching
    const songInfo = useMemo(() => {
        const title = song.title || song.fileName.replace(/\.(mp3|flac|m4a|wav|ogg|opus|aac)$/i, '');
        const artist = song.onlineMetadata?.artists.map(item => item.name).join(', ')
            || song.importedMetadata.artistNames.join(', ');
        const durationMs = song.duration || 0;
        const album = song.onlineMetadata?.album?.name || song.importedMetadata.albumName || '';
        return { title, artist, album, durationMs };
    }, [song]);

    const search = useLyricMatchSearch(song, songInfo);
    const { source, selectedResult } = search;

    // A chosen result turns the lyrics switch to the match.
    useEffect(() => {
        if (selectedResult) {
            setLyricsSource('online');
        }
    }, [selectedResult]);

    const previewCoverUrl = useMemo(() => {
        const localCoverUrl = getLocalCoverAssetUrl(song.localCoverAssetId, 512);
        if (!selectedResult) {
            return song.useOnlineCover ? song.onlineMetadata?.coverUrl || localCoverUrl : localCoverUrl;
        } else if (useOnlineCover) {
            const selectedCoverUrl = getMatchResultCoverUrl(selectedResult, source);
            return selectedCoverUrl || song.onlineMetadata?.coverUrl || localCoverUrl;
        }
        return localCoverUrl;
    }, [selectedResult, useOnlineCover, song, source]);

    // Derive lyrics source label
    const lyricsSourceLabel = useMemo(() => {
        if (lyricsSource === 'online') {
            if (!selectedResult && song.markedPureMusic) return t('localMusic.statusPureMusic');
            const src = selectedResult ? source : (song.matchedLyricsSource || 'netease');
            const platform = selectedResult?.amllDbPlatform ?? song.matchedLyricsProviderPlatform;
            return getLyricMatchSourceLabel(src, platform);
        }
        if (lyricsSource === 'embedded') return t('localMusic.statusEmbedded');
        if (lyricsSource === 'local') return t('localMusic.statusLocal');
        // Default: show what would be selected by priority
        if (song.hasLocalLyrics) return t('localMusic.statusLocal');
        if (song.hasEmbeddedLyrics) return t('localMusic.statusEmbedded');
        return t('localMusic.statusNone');
    }, [lyricsSource, song, t, source, selectedResult]);

    const save = async (result: SongResult) => {
        try {
            const applied = await saveLocalSongMatch({
                song,
                source,
                selectedResult: result,
                choice: { useOnlineCover, useOnlineMetadata, lyricsSource },
                confirmReplace: () => askConfirm({
                    title: t('localMusic.save'),
                    description: t('localMusic.replaceProtectedEntityConfirm'),
                    confirmText: t('localMusic.save'),
                    confirmVariant: 'danger',
                }),
            });
            if (!applied) return;
            // What was not applied goes with the hand-over: whoever takes over shows one message, and
            // one set here would be replaced by its 'match successful'.
            const failureKey = getLocalSongMatchFailureKey(applied);
            onMatch(failureKey ? t(failureKey) : undefined);
        } catch (error) {
            console.error('Failed to match or save song:', error);
            setStatusMessage({ type: 'error', text: t('localMusic.matchFailed') });
        }
    };

    // Marks or unmarks the song as instrumental: only the automatic lyric matching changes, the
    // metadata and the cover stay.
    const togglePureMusicMark = async () => {
        const marked = !song.markedPureMusic;
        setIsMarkingPureMusic(true);
        try {
            await setLocalSongPureMusicMark(song.id, marked);
            await onPureMusicMarkChanged(marked);
        } catch (error) {
            console.error('[LyricMatch] Failed to switch the instrumental mark:', error);
            setStatusMessage({ type: 'error', text: t('localMusic.pureMusicMarkFailed') });
        } finally {
            setIsMarkingPureMusic(false);
        }
    };

    const saveNoMatch = async () => {
        try {
            await saveLocalSongNoMatch(song.id);
            onMatch(); // Trigger refresh so the change applies
        } catch (error) {
            console.error('Failed to save song:', error);
            setStatusMessage({ type: 'error', text: t('localMusic.matchFailed') });
        }
    };

    const dotBase = isDaylight ? 'bg-zinc-300' : 'bg-zinc-600';
    const dotActive = isDaylight ? 'bg-blue-500' : 'bg-blue-400';
    const switchOn = isDaylight ? 'text-blue-600 font-medium' : 'text-blue-300 font-medium';
    const switchOff = isDaylight ? 'text-zinc-500' : 'text-zinc-400';
    // One of the three switches: a dot and its name.
    const dotSwitch = (label: string, isOn: boolean, onToggle: () => void, disabled?: boolean) => (
        <button
            onClick={onToggle}
            disabled={disabled}
            className="flex items-center gap-1.5 group disabled:opacity-40 disabled:cursor-not-allowed"
            title={label}
        >
            <div className={`w-2 h-2 rounded-full transition-all duration-200 ${isOn ? dotActive + ' shadow-sm shadow-blue-400/50' : dotBase} group-hover:scale-150`} />
            <span className={`text-[11px] ${isOn ? switchOn : switchOff} transition-colors`}>
                {label}
            </span>
        </button>
    );
    const resultHasCover = sourceSupportsCover(source, selectedResult);
    // A source with no song metadata of its own (AMLL DB) leaves the song's names as they are.
    const resultHasMetadata = sourceProvidesSongMetadata(source);

    const showsResult = useOnlineMetadata && resultHasMetadata && selectedResult;
    const pureMusicTone = song.markedPureMusic
        ? (isDaylight ? 'bg-violet-500/15 hover:bg-violet-500/20 border-violet-500/30 text-violet-700' : 'bg-violet-500/25 hover:bg-violet-500/30 border-violet-400/40 text-violet-200')
        : (isDaylight ? 'bg-violet-500/5 hover:bg-violet-500/10 border-violet-500/15 text-violet-600' : 'bg-violet-500/10 hover:bg-violet-500/20 border-violet-400/25 text-violet-300');

    return (
        <LyricMatchWindow
            search={search}
            isDaylight={isDaylight}
            onClose={onClose}
            songLine={song.title || song.importedMetadata.title}
            fileName={song.fileName}
            showsDurationMatch
            preview={{
                coverUrl: previewCoverUrl,
                title: showsResult ? formatSongName(selectedResult) : song.importedMetadata.title,
                artist: showsResult ? getMatchResultArtists(selectedResult) : song.importedMetadata.artistNames.join(', '),
                album: showsResult ? getMatchResultAlbumName(selectedResult) : song.importedMetadata.albumName || '',
            }}
            controls={(
                <div className="flex flex-row items-center justify-center gap-4 w-full mt-3 flex-shrink-0">
                    {dotSwitch(t('localMusic.coverSource'), useOnlineCover && resultHasCover, () => setUseOnlineCover(!useOnlineCover), !resultHasCover)}
                    {dotSwitch(t('localMusic.metadataSource'), useOnlineMetadata && resultHasMetadata, () => setUseOnlineMetadata(!useOnlineMetadata), !resultHasMetadata)}
                    {dotSwitch(t('localMusic.lyricsSource'), lyricsSource === 'online', () => setLyricsSource(lyricsSource === 'online' ? undefined : 'online'))}
                </div>
            )}
            status={{
                label: t('localMusic.lyricsSource'),
                text: lyricsSourceLabel,
                tone: lyricsSource === 'online' ? 'blue' : (song.hasLocalLyrics || song.hasEmbeddedLyrics) ? 'green' : 'muted',
            }}
            savingLabel={t('localMusic.matching')}
            onSave={save}
            noMatch={{ label: t('localMusic.dontUseOnlineMetadata'), run: saveNoMatch }}
            footerActions={(
                <button
                    type="button"
                    onClick={() => void togglePureMusicMark()}
                    disabled={isMarkingPureMusic}
                    aria-pressed={Boolean(song.markedPureMusic)}
                    title={t('localMusic.markPureMusicHint')}
                    className={`px-4 py-2 ${pureMusicTone} border rounded-lg transition-colors text-sm whitespace-nowrap flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                    {isMarkingPureMusic ? <Loader2 className="animate-spin" size={14} /> : <Piano size={14} />}
                    {t(song.markedPureMusic ? 'localMusic.unmarkPureMusic' : 'localMusic.markPureMusic')}
                </button>
            )}
        >
            {confirmDialog}
        </LyricMatchWindow>
    );
};

export default LocalSongLyricMatch;
