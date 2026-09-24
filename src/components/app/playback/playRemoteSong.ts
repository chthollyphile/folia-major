import type { SongResult, LyricData } from '../../../types';
import { PlayerState } from '../../../types';
import { setCurrentSong, setPlayQueue, setAudioSrc, setDuration, setPlayerState, setCurrentLineIndex, setCachedCoverUrl } from '../../../stores/usePlaybackStore';
import { currentTime } from '../../../stores/motionSignals';
import { startRemotePlayback, stopRemotePlayback } from '../../../services/remotePlayback';
import { useAudioSettingsStore } from '../../../stores/useAudioSettingsStore';
import { loadOnlineSongLyrics } from '../../../services/onlinePlayback';

// src/components/app/playback/playRemoteSong.ts

// A remote backend has no audio URL: keep the media element and its cache pipeline idle.
export async function playRemoteSong({ song, queue, audio, isCurrent, setLyrics, setLoading }: {
    song: SongResult; queue: SongResult[]; audio: HTMLAudioElement | null;
    isCurrent: () => boolean; setLyrics: (lyrics: LyricData | null) => void; setLoading: (loading: boolean) => void;
}): Promise<boolean> {
    audio?.pause();
    audio?.removeAttribute('src');
    audio?.load();
    setAudioSrc(null);
    setPlayerState(PlayerState.IDLE);
    try {
        if (!await startRemotePlayback(song, { quality: useAudioSettingsStore.getState().audioQuality }) || !isCurrent()) return false;
        setCurrentSong(song);
        setPlayQueue(queue);
        setDuration(song.durationMs / 1000);
        setCachedCoverUrl(null);
        setCurrentLineIndex(-1);
        currentTime.set(0);
        setLyrics(null);
        setLoading(true);
        void loadOnlineSongLyrics(song, null, undefined, {
            isCurrent,
            onLyrics: lyrics => { if (isCurrent()) setLyrics(lyrics); },
            onDone: () => { if (isCurrent()) setLoading(false); },
        }).catch(() => { if (isCurrent()) { setLyrics(null); setLoading(false); } });
        return true;
    } catch (error) {
        if (isCurrent()) {
            await stopRemotePlayback().catch(() => {});
            setPlayerState(PlayerState.PAUSED);
            setLoading(false);
        }
        throw error;
    }
}
