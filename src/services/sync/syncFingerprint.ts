import type { SongResult, UnifiedSong } from '../../types';

// src/services/sync/syncFingerprint.ts
// Stable song fingerprints keep synced theme keys independent from local API ids.

const normalizeText = (value: unknown) => (
    typeof value === 'string'
        ? value.trim().toLowerCase().replace(/\s+/g, ' ')
        : ''
);

const normalizeArtists = (song: SongResult) => {
    const unified = song as UnifiedSong;
    const navidromeArtist = typeof unified.navidromeData?.artist === 'string'
        ? unified.navidromeData.artist
        : typeof unified.navidromeData?.artistName === 'string'
            ? unified.navidromeData.artistName
            : '';
    const artists = song.ar?.length ? song.ar : song.artists;
    const artistText = artists?.map(artist => artist.name).filter(Boolean).join(', ') || navidromeArtist;
    return normalizeText(artistText);
};

const getSongSourceKind = (song: SongResult) => {
    const unified = song as UnifiedSong;
    if (unified.isLocal || unified.localRef) {
        return 'local';
    }
    if (unified.isNavidrome || unified.navidromeData) {
        return 'navidrome';
    }
    return song.sourceType || 'netease';
};

const getSongTitle = (song: SongResult) => {
    const unified = song as UnifiedSong;
    return normalizeText(
        song.name
        || unified.navidromeData?.title
    );
};

const getDurationMs = (song: SongResult) => {
    const unified = song as UnifiedSong;
    const candidate = song.dt ?? song.duration ?? unified.navidromeData?.durationMs;
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return candidate < 1000 ? candidate * 1000 : candidate;
    }
    return 0;
};

export const createNeteaseSongIdFingerprint = (songId: unknown) => {
    if (typeof songId === 'number' && Number.isFinite(songId)) {
        return `netease:id:${songId}`;
    }
    if (typeof songId === 'string' && songId.trim()) {
        return `netease:id:${songId.trim()}`;
    }
    return null;
};

const createSongMetadataFingerprint = (song: SongResult, sourceKind = getSongSourceKind(song)) => {
    const title = getSongTitle(song);
    const artists = normalizeArtists(song);
    if (!title && !artists) {
        return null;
    }

    const roundedDurationSec = Math.round(getDurationMs(song) / 1000 / 5) * 5;
    return [
        sourceKind,
        title || 'unknown-title',
        artists || 'unknown-artist',
        String(roundedDurationSec || 0),
    ].join('|');
};

export const createSongSyncFingerprint = (song: SongResult | null) => {
    if (!song) {
        return null;
    }

    const sourceKind = getSongSourceKind(song);
    if (sourceKind === 'netease') {
        const stableIdFingerprint = createNeteaseSongIdFingerprint(song.id);
        if (stableIdFingerprint) {
            return stableIdFingerprint;
        }
    }

    return createSongMetadataFingerprint(song, sourceKind);
};

export const createSongSyncFingerprintCandidates = (song: SongResult | null) => {
    if (!song) {
        return [];
    }

    const sourceKind = getSongSourceKind(song);
    const candidates = [
        createSongSyncFingerprint(song),
        createSongMetadataFingerprint(song, sourceKind),
    ];
    return Array.from(new Set(candidates.filter((value): value is string => Boolean(value))));
};
