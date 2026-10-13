import { LyricData, OnlineLyricsState, ReplayGainInfo, SongResult } from '../types';
import { saveToCache } from './db';
import { PrefetchedSongData, isUrlValid, updatePrefetchedAudioUrl } from './prefetchService';
import { isPureMusicLyricText } from '../utils/lyrics/pureMusic';
import { migrateLyricDataRenderHints } from '../utils/lyrics/renderHints';
import { loadOnlineLyricsState, markOnlineLyricsPureMusic, resolveOnlineLyrics, resolveOnlineLyricsPureMusic, saveOnlineLyricsState } from '../utils/onlineLyricsState';
import { autoMatchBestLyric } from '../utils/lyrics/autoMatchBestLyric';
import { createSafeObjectUrl } from '../utils/blobGuards';
import type { AudioQualityPreference, MediaId, OmniAudioSource } from '../types/onlineMusic';
import type { OnlineAudioSourceResult, PlaybackFailure } from '../types/playbackFailure';
import { omni } from './onlineMusic/omni';
import { getSongResourceCacheKey } from './onlineMusic/resourceKeys';
import { getCachedSongAudioBlob, getCachedSongReplayGain, getSongCacheWithLegacyMigration } from './onlineMusic/resourceCache';
import { toPlayableAudioUrl } from '../utils/appPlaybackHelpers';
import { getPlaybackSourceRef } from '../utils/appPlaybackGuards';
import { getProviderSongMetadata } from './onlineMusic/songMetadata';
import { useLyricSettingsStore } from '../stores/useLyricSettingsStore';
import { useOnlineProviderAccountStore } from '../stores/useOnlineProviderAccountStore';
import { saveLyricCacheSongMetadata } from './lyricExport/lyricCacheMetadata';
import { classifyMissingAudioUrl, classifyPlaybackError } from './playbackRecovery/onlinePlaybackFailure';
import { resolvePlaybackFailurePolicy, sleepForPlaybackRetry } from './playbackRecovery/playbackFailurePolicy';
import { getProviderPlaybackCooldown, noteProviderFailure } from './playbackRecovery/providerPlaybackCooldown';
import { isCachedSongAudioDistrusted } from './playbackRecovery/mediaCacheGuard';

export interface LoadOnlineAudioSourceOptions {
    stage?: 'resolve-url' | 'refresh' | 'restore';
    bypassMediaCache?: boolean;
    retry?: {
        isCurrent: () => boolean;
        onRetrying?: (failure: PlaybackFailure, attempt: number) => void;
        sleep?: (ms: number) => Promise<void>;     // 测试注入；默认 sleepForPlaybackRetry
    };
}

/**
 * 解析一首在线歌曲的音源：媒体缓存 → 有效预取 → provider。
 * provider 失败时归一成 PlaybackFailure（不回写可用性、预取或缓存），按策略表对网络 / 超时做有限次静默重试，
 * 每次等待后检查请求是否仍是当前的；限流冷却期内不发请求。
 */
export async function loadOnlineSongAudioSource(
    song: SongResult,
    audioQuality: AudioQualityPreference,
    prefetched: PrefetchedSongData | null,
    options: LoadOnlineAudioSourceOptions = {},
): Promise<OnlineAudioSourceResult> {
    // 缓存 blob 解码失败过（distrust）或调用方要求绕过时不读缓存；读缓存出错只记日志，继续走 provider。
    if (!options.bypassMediaCache && !isCachedSongAudioDistrusted(song)) {
        let cachedAudioBlob: Blob | null = null;
        try {
            cachedAudioBlob = await getCachedSongAudioBlob(song);
        } catch (error) {
            console.warn('[OnlinePlayback] Failed to read the cached audio; asking the provider instead', error);
        }
        if (cachedAudioBlob) {
            const blobUrl = createSafeObjectUrl(cachedAudioBlob);
            if (blobUrl) {
                // Nothing on this path ever asks the provider again, so the stored gain is the only
                // one a cached track can have. Without it every cached track reaches the fader at 0dB.
                let replayGain = song.replayGain ?? prefetched?.replayGain;
                if (!replayGain) {
                    replayGain = await getCachedSongReplayGain(song);
                    if (replayGain) console.log(`[Cache] ReplayGain recovered for "${song.name}" from the store, not the provider`);
                }
                return { kind: 'ok', audioSrc: blobUrl, blobUrl, replayGain };
            }
        }
    }

    if (prefetched?.audioUrl && prefetched.audioUrl !== 'CACHED_IN_DB' && isUrlValid(prefetched.audioUrlFetchedAt)) {
        return {
            kind: 'ok',
            audioSrc: prefetched.audioUrl,
            replayGain: song.replayGain ?? prefetched.replayGain,
        };
    }

    const sourceRef = getPlaybackSourceRef(song);
    const providerId = sourceRef.kind === 'online' ? sourceRef.providerId : undefined;
    const stage = options.stage ?? 'resolve-url';
    const sleep = options.retry?.sleep ?? sleepForPlaybackRetry;

    for (let attempt = 0; ; attempt += 1) {
        const cooldown = providerId ? getProviderPlaybackCooldown(providerId, 'play') : null;
        if (cooldown) {
            return {
                kind: 'failed',
                failure: { reason: 'rate-limited', stage: 'cooldown', providerId, retryAfterMs: cooldown.remainingMs },
            };
        }

        // 必须在请求之前读：鉴权失败后 transport 可能已经清理了会话，事后读会把“已失效”误判成“未登录”。
        const account = providerId ? useOnlineProviderAccountStore.getState().accounts[providerId] : undefined;

        let source: OmniAudioSource | null = null;
        let failure: PlaybackFailure | null = null;
        try {
            source = await omni.getAudioSource(song, audioQuality);
        } catch (error) {
            console.warn('[OnlinePlayback] Provider audio source is temporarily unavailable', error);
            failure = classifyPlaybackError(error, {
                stage,
                providerId,
                account: { status: account?.status, error: account?.error },
            });
        }

        if (!failure) {
            const url = toPlayableAudioUrl(source?.url);
            if (url) {
                const replayGain = applyOnlineAudioSourceMetadata(song, source?.replayGain).replayGain;
                // 预取条目只在成功时更新；失败永不回写。
                updatePrefetchedAudioUrl(song, url, audioQuality, replayGain);
                return { kind: 'ok', audioSrc: url, replayGain };
            }
            failure = classifyMissingAudioUrl(source?.url, { stage, providerId });
            console.warn('[OnlinePlayback] Provider returned no playable audio URL', failure.reason);
        }

        noteProviderFailure(failure);

        const delays = resolvePlaybackFailurePolicy(failure, 'play').autoRetryDelaysMs;
        const retry = options.retry;
        if (retry && attempt < delays.length && retry.isCurrent()) {
            retry.onRetrying?.(failure, attempt + 1);
            await sleep(delays[attempt]);
            if (!retry.isCurrent()) return { kind: 'failed', failure };
            continue;
        }
        return { kind: 'failed', failure };
    }
}

export const applyOnlineAudioSourceMetadata = (
    song: SongResult,
    replayGain?: ReplayGainInfo,
): SongResult => replayGain
    ? { ...song, replayGain: { ...song.replayGain, ...replayGain } }
    : song;

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
  const initialSettingsLyricSettings = useLyricSettingsStore.getState();

    if (!isCurrent()) return;
    onStateChange?.(onlineLyricsState);

    const cachedLyrics = await getSongCacheWithLegacyMigration<LyricData>('lyric', song, migrateLyricDataRenderHints);
    if (!isCurrent()) return;
    const preferredCachedLyrics = resolveOnlineLyrics(onlineLyricsState, cachedLyrics);
    const hasAuthoritativeLyricsSelection = onlineLyricsState?.lyricsSource === 'imported'
        || Boolean(onlineLyricsState?.hasOnlineOverride);
    if (preferredCachedLyrics && (hasAuthoritativeLyricsSelection || !initialSettingsLyricSettings.autoUseBestLyric)) {
        const cachedText = preferredCachedLyrics.lines.map(line => line.fullText).join('\n');
        onPureMusicChange?.(resolveOnlineLyricsPureMusic(onlineLyricsState, cachedText));
        onLyrics(preferredCachedLyrics);
        onDone();
        return;
    }

    if (prefetched?.lyricRaw?.isPureMusic && !prefetched.lyrics
        && (hasAuthoritativeLyricsSelection || !initialSettingsLyricSettings.autoUseBestLyric)) {
        onPureMusicChange?.(true);
        onLyrics(null);
        onDone();
        return;
    }

    if (prefetched?.lyrics) {
        const preferredPrefetchedLyrics = resolveOnlineLyrics(onlineLyricsState, prefetched.lyrics);
        const effectiveLyrics = preferredPrefetchedLyrics ?? prefetched.lyrics;

  const settingsLyricSettings = useLyricSettingsStore.getState();
        const shouldAutoMatch = settingsLyricSettings.autoUseBestLyric && !onlineLyricsState?.hasOnlineOverride;

        if (!shouldAutoMatch) {
            const effectiveText = effectiveLyrics?.lines.map(line => line.fullText).join('\n') ?? '';
            onPureMusicChange?.(
                onlineLyricsState?.lyricsSource === 'online' && typeof onlineLyricsState.matchedIsPureMusic === 'boolean'
                    ? onlineLyricsState.matchedIsPureMusic
                    : (prefetched.lyricRaw?.isPureMusic || isPureMusicLyricText(effectiveText) || isPureMusicLyricText(prefetched.lyricRaw?.mainLrc))
            );
            onLyrics(effectiveLyrics);
            saveToCache(lyricCacheKey, prefetched.lyrics);
            saveLyricCacheSongMetadata(song);
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

  const settingsLyricSettings = useLyricSettingsStore.getState();
    const shouldAutoMatch = settingsLyricSettings.autoUseBestLyric && !onlineLyricsState?.hasOnlineOverride;

    if (shouldAutoMatch) {
        // The lyrics in hand are already displayable, so hand them over and report done BEFORE the
        // search below. `onDone` is what releases the audio: playback waits on it, and this search
        // asks every provider for a better lyric file - seconds when it finds none, which is
        // exactly what an instrumental interlude does. Holding the audio for an OPTIONAL upgrade
        // is what turned a song change into several seconds of silence, and with blended changes
        // the outgoing track has already ended by then, so the silence is all the listener gets.
        // A better match, if one turns up, replaces these below.
        if (resolvedLyrics) onLyrics(resolvedLyrics);
        onDone();

        try {
            onAutoMatchStart?.();
            const metadata = getProviderSongMetadata(song);
            const artistName = metadata.artists.map(a => a.name).join(', ');
            const bestMatch = await autoMatchBestLyric(song.name, artistName, metadata.durationMs, {
                album: metadata.album?.name,
                preferredSource: settingsLyricSettings.preferredAlternativeLyricSource,
                providerCandidate: song.sourceRef?.kind === 'online'
                    && (song.sourceRef.providerId === 'netease' || song.sourceRef.providerId === 'kugou' || song.sourceRef.providerId === 'qq')
                    ? {
                        providerId: song.sourceRef.providerId as 'netease' | 'kugou' | 'qq',
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
            } else if (bestMatch?.isPureMusic) {
                // Checked against `true`, not with `in`: a MATCH object also carries
                // `isPureMusic: false`, so `'isPureMusic' in bestMatch` was true for it too - and
                // a best match from the track's own provider (which fails the branch above) then
                // landed here and had its perfectly good lyrics thrown away as instrumental.
                const pureMusic = markOnlineLyricsPureMusic(onlineLyricsState);
                await saveOnlineLyricsState(song, pureMusic);
                resolvedLyrics = null;
                finalState = pureMusic;
                onStateChange?.(pureMusic);
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
    saveLyricCacheSongMetadata(song);
    onDone();
}
