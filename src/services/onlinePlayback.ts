import { LyricData, OnlineLyricsState, SongResult } from '../types';
import { saveToCache } from './db';
import { PrefetchedSongData, isUrlValid, updatePrefetchedAudioUrl } from './prefetchService';
import { isPureMusicLyricText } from '../utils/lyrics/pureMusic';
import { migrateLyricDataRenderHints } from '../utils/lyrics/renderHints';
import { loadOnlineLyricsState, resolveOnlineLyrics, saveOnlineLyricsState } from '../utils/onlineLyricsState';
import { useSettingsUiStore } from '../stores/useSettingsUiStore';
import { autoMatchBestLyric } from '../utils/lyrics/autoMatchBestLyric';
import { createSafeObjectUrl } from '../utils/blobGuards';
import type { AudioQualityPreference, MediaId } from '../types/onlineMusic';
import { omni } from './onlineMusic/omni';
import { getSongResourceCacheKey } from './onlineMusic/resourceKeys';
import { getCachedSongAudioBlob, getSongCacheWithLegacyMigration } from './onlineMusic/resourceCache';
import { toSafeRemoteUrl } from '../utils/appPlaybackHelpers';
import { getProviderSongMetadata } from './onlineMusic/songMetadata';

export async function loadOnlineSongAudioSource(
    song: SongResult,
    audioQuality: AudioQualityPreference,
    prefetched: PrefetchedSongData | null
): Promise<
    | { kind: 'ok'; audioSrc: string; blobUrl?: string }
    | { kind: 'unavailable' }
> {
    const audioCacheKey = getSongResourceCacheKey('audio', song);
    const cachedAudioBlob = await getCachedSongAudioBlob(song);
    if (cachedAudioBlob) {
        const blobUrl = createSafeObjectUrl(cachedAudioBlob);
        if (blobUrl) return { kind: 'ok', audioSrc: blobUrl, blobUrl };
    }

    if (prefetched?.audioUrl && prefetched.audioUrl !== 'CACHED_IN_DB' && isUrlValid(prefetched.audioUrlFetchedAt)) {
        return { kind: 'ok', audioSrc: prefetched.audioUrl };
    }

    let source = null;
    try {
        source = await omni.getAudioSource(song, audioQuality);
    } catch (error) {
        console.warn('[OnlinePlayback] Provider audio source is temporarily unavailable', error);
        return { kind: 'unavailable' };
    }
    const url = toSafeRemoteUrl(source?.url);
    if (!url) {
        return { kind: 'unavailable' };
    }

    updatePrefetchedAudioUrl(song, url, audioQuality);
    return { kind: 'ok', audioSrc: url };
}

export async function loadOnlineSongLyrics(
    song: SongResult,
    prefetched: PrefetchedSongData | null,
    userId: MediaId | null | undefined,
    callbacks: {
        isCurrent: () => boolean;
        onLyrics: (lyrics: LyricData | null) => void;
        onPureMusicChange?: (isPureMusic: boolean) => void;
        onStateChange?: (state: OnlineLyricsState | null) => void;
        onAutoMatchStart?: () => void;
        onDone: () => void;
    }
): Promise<void> {
    const { isCurrent, onLyrics, onPureMusicChange, onStateChange, onAutoMatchStart, onDone } = callbacks;
    const lyricCacheKey = getSongResourceCacheKey('lyric', song);
    const onlineLyricsState = await loadOnlineLyricsState(song);
    const initialSettings = useSettingsUiStore.getState();

    if (!isCurrent()) return;
    onStateChange?.(onlineLyricsState);

    const cachedLyrics = await getSongCacheWithLegacyMigration<LyricData>('lyric', song, migrateLyricDataRenderHints);
    if (!isCurrent()) return;
    const preferredCachedLyrics = resolveOnlineLyrics(onlineLyricsState, cachedLyrics);
    const hasAuthoritativeLyricsSelection = onlineLyricsState?.lyricsSource === 'imported'
        || Boolean(onlineLyricsState?.hasOnlineOverride);
    if (preferredCachedLyrics && (hasAuthoritativeLyricsSelection || !initialSettings.autoUseBestLyric)) {
        const cachedText = preferredCachedLyrics.lines.map(line => line.fullText).join('\n');
        onPureMusicChange?.(
            onlineLyricsState?.lyricsSource === 'online' && typeof onlineLyricsState.matchedIsPureMusic === 'boolean'
                ? onlineLyricsState.matchedIsPureMusic
                : isPureMusicLyricText(cachedText)
        );
        onLyrics(preferredCachedLyrics);
        onDone();
        return;
    }

    if (prefetched?.lyricRaw?.isPureMusic && !prefetched.lyrics
        && (hasAuthoritativeLyricsSelection || !initialSettings.autoUseBestLyric)) {
        onPureMusicChange?.(true);
        onLyrics(null);
        onDone();
        return;
    }

    if (prefetched?.lyrics) {
        const preferredPrefetchedLyrics = resolveOnlineLyrics(onlineLyricsState, prefetched.lyrics);
        const effectiveLyrics = preferredPrefetchedLyrics ?? prefetched.lyrics;

        const settings = useSettingsUiStore.getState();
        const shouldAutoMatch = settings.autoUseBestLyric && !onlineLyricsState?.hasOnlineOverride;

        if (!shouldAutoMatch) {
            const effectiveText = effectiveLyrics?.lines.map(line => line.fullText).join('\n') ?? '';
            onPureMusicChange?.(
                onlineLyricsState?.lyricsSource === 'online' && typeof onlineLyricsState.matchedIsPureMusic === 'boolean'
                    ? onlineLyricsState.matchedIsPureMusic
                    : (prefetched.lyricRaw?.isPureMusic || isPureMusicLyricText(effectiveText) || isPureMusicLyricText(prefetched.lyricRaw?.mainLrc))
            );
            onLyrics(effectiveLyrics);
            saveToCache(lyricCacheKey, prefetched.lyrics);
            onDone();
            return;
        }
    }

    const processed = prefetched?.lyrics
        ? {
            mainLrc: prefetched.lyricRaw?.mainLrc ?? null,
            yrcLrc: prefetched.lyricRaw?.yrcLrc ?? null,
            transLrc: prefetched.lyricRaw?.transLrc ?? null,
            isPureMusic: prefetched.lyricRaw?.isPureMusic ?? false,
            lyrics: prefetched.lyrics,
            chorusRanges: [],
          }
        : await (async () => {
            const result = await omni.getLyrics(song, { userId });
            return {
                mainLrc: result.mainText ?? null,
                yrcLrc: result.wordByWordText ?? null,
                transLrc: result.translationText ?? null,
                isPureMusic: result.isPureMusic,
                lyrics: result.lyrics,
                chorusRanges: result.chorusRanges || [],
            };
        })();
    const parsedLyrics = processed.lyrics;

    if (!isCurrent()) return;

    let resolvedLyrics = resolveOnlineLyrics(onlineLyricsState, parsedLyrics);
    let finalState = onlineLyricsState;

    const settings = useSettingsUiStore.getState();
    const shouldAutoMatch = settings.autoUseBestLyric && !onlineLyricsState?.hasOnlineOverride;

    if (shouldAutoMatch) {
        try {
            onAutoMatchStart?.();
            const metadata = getProviderSongMetadata(song);
            const artistName = metadata.artists.map(a => a.name).join(', ');
            const bestMatch = await autoMatchBestLyric(song.name, artistName, metadata.durationMs, {
                album: metadata.album?.name,
                preferredSource: settings.preferredAlternativeLyricSource,
                providerCandidate: song.sourceRef?.kind === 'online'
                    && (song.sourceRef.providerId === 'netease' || song.sourceRef.providerId === 'kugou')
                    ? {
                        providerId: song.sourceRef.providerId as 'netease' | 'kugou',
                        song,
                        lyricsResult: {
                            lyrics: parsedLyrics,
                            mainText: processed.mainLrc,
                            wordByWordText: processed.yrcLrc,
                            translationText: processed.transLrc,
                            isPureMusic: processed.isPureMusic,
                            chorusRanges: processed.chorusRanges,
                        },
                    }
                    : undefined
            });
            const ownProviderId = song.sourceRef?.kind === 'online' ? song.sourceRef.providerId : null;
            if (bestMatch && 'lyrics' in bestMatch && bestMatch.source !== ownProviderId) {
                const overrideState: OnlineLyricsState = {
                    lyricsSource: 'online',
                    matchedSongId: bestMatch.id,
                    hasOnlineOverride: true,
                    onlineOverrideLyrics: bestMatch.lyrics,
                    matchedLyricsSource: bestMatch.source,
                    matchedLyricsProviderPlatform: bestMatch.matchedLyricsProviderPlatform,
                };
                await saveOnlineLyricsState(song, overrideState);
                resolvedLyrics = bestMatch.lyrics;
                finalState = overrideState;
                onStateChange?.(overrideState);
            } else if (bestMatch && 'isPureMusic' in bestMatch) {
                resolvedLyrics = null;
                onPureMusicChange?.(true);
            }
        } catch (error) {
            console.warn('[OnlinePlayback] Failed to auto-match best lyric:', error);
        }
    }

    if (!isCurrent()) return;

    const resolvedText = resolvedLyrics?.lines.map(line => line.fullText).join('\n') ?? '';
    onPureMusicChange?.(
        finalState?.lyricsSource === 'online' && typeof finalState.matchedIsPureMusic === 'boolean'
            ? finalState.matchedIsPureMusic
            : (resolvedLyrics ? isPureMusicLyricText(resolvedText) : processed.isPureMusic)
    );

    if (!resolvedLyrics) {
        onLyrics(null);
        onDone();
        return;
    }

    onLyrics(resolvedLyrics);
    saveToCache(lyricCacheKey, resolvedLyrics);
    onDone();
}
