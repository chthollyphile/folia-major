import { SongResult } from '../../types';
import { normalizeLyricMatchDurationMs } from './duration';
import { createProviderSongMetadata } from '../songMetadata';

import * as wanakana from 'wanakana';
import * as OpenCC from 'opencc-js/t2cn';

// src/utils/lyrics/matchScore.ts

const t2sConverter = OpenCC.Converter({ from: 't', to: 'cn' });

const SCORE_WEIGHTS = {
    title: 45,
    artist: 25,
    album: 30
} as const;
const AUTO_MATCH_COMPONENT_MISS_SCORE_CAP = 74;

export type MatchScoreDetails = {
    score: number;
    titleScore: number;
    artistScore: number;
    albumScore: number;
    durationScore: number;
    durationMultiplier: number;
    titleSimilarity: number;
    artistSimilarity: number;
    albumSimilarity: number | null;
    titleMatched: boolean;
    artistMatched: boolean;
    albumMatched: boolean | null;
    durationMatched: boolean | null;
};

/**
 * Removes punctuation and symbols while preserving letters across languages.
 */
export function normalizeLyricMatchText(value: string): string {
    const romajiValue = wanakana.toRomaji(value);
    const simpValue = t2sConverter(romajiValue);

    return simpValue
        .toLowerCase()
        .replace(/[\p{P}\p{S}]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeTitleForMatch(value: string): string {
    const versionMarkerPattern = /(instrumental|inst|off\s*vocal|karaoke|remix|mix|version|ver\.?|cover|live|edit|arrange|伴奏|カラオケ|インスト|リミックス|remaster|remastered)/iu;
    return normalizeLyricMatchText(
        value
            .replace(/[\(\[（【]\s*(feat|featuring|ft)\.?\s+[^\)\]）】]+[\)\]）】]/giu, '')
            .replace(/\b(feat|featuring|ft)\.?\s+.+$/iu, '')
            .replace(/[\(\[（【]([^\)\]）】]+)[\)\]）】]/gu, (match, content: string) => {
                return versionMarkerPattern.test(content) ? match : '';
            })
    );
}

/**
 * Calculates Jaccard character similarity between two normalized strings.
 */
function stringSimilarity(s1: string, s2: string, normalizer: (value: string) => string = normalizeLyricMatchText): number {
    const n1 = normalizer(s1);
    const n2 = normalizer(s2);
    if (!n1 || !n2) return 0;
    if (n1 === n2) return 1.0;
    if (n1.includes(n2) || n2.includes(n1)) return Math.min(n1.length, n2.length) / Math.max(n1.length, n2.length);
    
    const set1 = new Set(n1);
    const set2 = new Set(n2);
    let intersection = 0;
    for (const char of set1) {
        if (set2.has(char)) {
            intersection++;
        }
    }
    const union = new Set([...set1, ...set2]).size;
    return union > 0 ? intersection / union : 0;
}

function getArtistText(result: SongResult): string {
    return createProviderSongMetadata(result).artists.map(a => a.name).join(', ');
}

function getAlbumText(result: SongResult): string {
    const album = createProviderSongMetadata(result).album?.name || '';
    return /^unknown album$/i.test(album.trim()) ? '' : album;
}

function calculateDurationScore(targetDurationMs: number, searchDurationMs: number): {
    multiplier: number;
    matched: boolean | null;
} {
    if (targetDurationMs <= 0 || searchDurationMs <= 0) {
        return { multiplier: 0.9, matched: null };
    }

    const diff = Math.abs(targetDurationMs - searchDurationMs);
    if (diff <= 1000) {
        return { multiplier: 1, matched: true };
    }
    if (diff <= 3000) {
        return { multiplier: 0.95, matched: true };
    }
    if (diff <= 5000) {
        return { multiplier: 0.75, matched: false };
    }
    if (diff <= 10000) {
        return { multiplier: 0.35, matched: false };
    }
    return { multiplier: 0.1, matched: false };
}

/**
 * Calculates component scores so automatic matching can distinguish title, artist, album, and duration misses.
 */
function splitArtistsForMatch(artistText: string): string[] {
    return artistText
        .split(/[,&、\/]|feat\.?|ft\.?|featuring|与/i)
        .map(a => normalizeLyricMatchText(a))
        .filter(a => a.length > 0);
}

function calculateArtistSimilarity(target: string, search: string): number {
    const tArtists = splitArtistsForMatch(target);
    const sArtists = splitArtistsForMatch(search);
    
    if (tArtists.length === 0 || sArtists.length === 0) {
        return stringSimilarity(target, search);
    }
    
    let matchCount = 0;
    for (const a1 of tArtists) {
        for (const a2 of sArtists) {
            if (a1 === a2 || (a1.length >= 3 && a2.includes(a1)) || (a2.length >= 3 && a1.includes(a2))) {
                matchCount++;
                break;
            }
        }
    }
    
    const tokenSim = matchCount / Math.max(tArtists.length, sArtists.length);
    const isMainArtistMatched = tArtists[0] && sArtists[0] && 
        (tArtists[0] === sArtists[0] || 
        (tArtists[0].length >= 3 && sArtists[0].includes(tArtists[0])) || 
        (sArtists[0].length >= 3 && tArtists[0].includes(sArtists[0])));
        
    const mainBonus = isMainArtistMatched ? Math.max(tokenSim, 0.7) : tokenSim;
    
    return Math.max(mainBonus, stringSimilarity(target, search));
}

export function calculateMatchScoreDetails(
    song: { title: string; artist: string; durationMs: number; album?: string },
    result: SongResult
): MatchScoreDetails {
    const searchTitle = result.name || '';
    const searchArtist = getArtistText(result);
    const searchAlbum = getAlbumText(result);
    const targetDurationMs = normalizeLyricMatchDurationMs(song.durationMs);
    const searchDurationMs = normalizeLyricMatchDurationMs(createProviderSongMetadata(result).durationMs);

    const titleSimilarity = stringSimilarity(song.title, searchTitle, normalizeTitleForMatch);
    const titleScore = titleSimilarity * SCORE_WEIGHTS.title;

    const artistSimilarity = song.artist.trim()
        ? calculateArtistSimilarity(song.artist, searchArtist)
        : 1;
    const artistScore = artistSimilarity * SCORE_WEIGHTS.artist;

    const hasTargetAlbum = Boolean(song.album?.trim());
    const hasSearchAlbum = Boolean(searchAlbum.trim());
    const albumSimilarity = hasTargetAlbum && hasSearchAlbum
        ? stringSimilarity(song.album || '', searchAlbum, normalizeTitleForMatch)
        : null;
    const albumScore = albumSimilarity === null
        ? (hasTargetAlbum ? 0 : SCORE_WEIGHTS.album)
        : albumSimilarity * SCORE_WEIGHTS.album;

    const duration = calculateDurationScore(targetDurationMs, searchDurationMs);
    const identityScore = titleScore + artistScore + albumScore;
    const titleMatched = titleSimilarity >= 0.65;
    const artistMatched = !song.artist.trim() || artistSimilarity >= 0.5;
    const albumMatched = !hasTargetAlbum ? null : (hasSearchAlbum ? (albumSimilarity ?? 0) >= 0.65 : null);
    const hasReliableIdentityMatch = artistMatched || albumMatched === true;
    const cappedIdentityScore = (!titleMatched || !hasReliableIdentityMatch)
        ? Math.min(identityScore, AUTO_MATCH_COMPONENT_MISS_SCORE_CAP)
        : identityScore;
    const finalScore = cappedIdentityScore * duration.multiplier;

    return {
        score: Math.min(100, Math.max(0, Math.round(finalScore))),
        titleScore,
        artistScore,
        albumScore,
        durationScore: duration.multiplier * 100,
        durationMultiplier: duration.multiplier,
        titleSimilarity,
        artistSimilarity,
        albumSimilarity,
        titleMatched,
        artistMatched,
        albumMatched,
        durationMatched: duration.matched
    };
}

/**
 * Calculates a match score between 0% and 100% for a search result compared to the target song.
 */
export function calculateMatchScore(
    song: { title: string; artist: string; durationMs: number; album?: string },
    result: SongResult
): number {
    return calculateMatchScoreDetails(song, result).score;
}
