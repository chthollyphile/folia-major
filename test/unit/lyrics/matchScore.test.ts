import { describe, expect, it } from 'vitest';
import { calculateMatchScore, calculateMatchScoreDetails, normalizeLyricMatchText } from '@/utils/lyrics/matchScore';

// test/unit/lyrics/matchScore.test.ts

describe('calculateMatchScore', () => {
    it('keeps non-Chinese international letters while removing punctuation', () => {
        expect(normalizeLyricMatchText('さよならの夏 - Café!')).toBe('sayonarano夏 café');
        expect(normalizeLyricMatchText('안녕, мир?')).toBe('안녕 мир');
    });

    it('normalizes accidental ms * 1000 durations before scoring', () => {
        const score = calculateMatchScore(
            {
                title: 'Night of Bloom (feat. nayuta)',
                artist: 'Kirara Magic/Xomu/nayuta',
                durationMs: 286000000
            },
            {
                id: 201,
                name: 'Night of Bloom',
                artists: [
                    { id: 1, name: 'Kirara Magic' },
                    { id: 2, name: 'Xomu' },
                    { id: 3, name: 'nayuta' }
                ],
                album: { id: 1, name: 'Night of Bloom' },
                durationMs: 286000
            }
        );

        expect(score).toBeGreaterThanOrEqual(85);
    });

    it('keeps same-title same-duration candidates below the threshold when both artist and album miss', () => {
        const score = calculateMatchScore(
            {
                title: 'Night of Bloom (feat. nayuta)',
                artist: 'Kirara Magic/Xomu/nayuta',
                album: 'Night of Bloom',
                durationMs: 286000
            },
            {
                id: 202,
                name: 'Night of Bloom',
                artists: [{ id: 1, name: 'Ayrex' }],
                album: { id: 1, name: 'First Love' },
                durationMs: 286000
            }
        );

        expect(score).toBeLessThan(75);
    });

    it('allows a strong album hit to identify providers with unreliable artist fields', () => {
        const details = calculateMatchScoreDetails(
            {
                title: 'SAKURAスキップ',
                artist: '高田憂希/山口愛/戸田めぐみ/竹尾歩美',
                album: 'TVアニメ「NEW GAME!」オープニングテーマ「SAKURAステップ」',
                durationMs: 249000
            },
            {
                id: 401,
                name: 'SAKURAスキップ',
                artists: [{ id: 1, name: 'fourfolium' }],
                album: { id: 1, name: 'TVアニメ「NEW GAME!」オープニングテーマ「SAKURAステップ」' },
                durationMs: 249000
            }
        );

        expect(details.titleMatched).toBe(true);
        expect(details.artistMatched).toBe(false);
        expect(details.albumMatched).toBe(true);
        expect(details.durationMatched).toBe(true);
        expect(details.score).toBeGreaterThanOrEqual(75);
    });

    it('treats parenthesized title translations as aliases but keeps version markers significant', () => {
        const aliasDetails = calculateMatchScoreDetails(
            {
                title: 'SAKURAスキップ',
                artist: '高田憂希/山口愛/戸田めぐみ/竹尾歩美',
                album: 'TVアニメ「NEW GAME!」オープニングテーマ「SAKURAステップ」',
                durationMs: 249000
            },
            {
                id: 402,
                name: 'SAKURAスキップ (樱花跳)',
                artists: [{ id: 1, name: 'fourfolium' }],
                album: { id: 1, name: 'TVアニメ「NEW GAME!」オープニングテーマ「SAKURAステップ」' },
                durationMs: 249000
            }
        );
        const instrumentalDetails = calculateMatchScoreDetails(
            {
                title: 'SAKURAスキップ',
                artist: '高田憂希/山口愛/戸田めぐみ/竹尾歩美',
                album: 'TVアニメ「NEW GAME!」オープニングテーマ「SAKURAステップ」',
                durationMs: 249000
            },
            {
                id: 403,
                name: 'SAKURAスキップ (instrumental)',
                artists: [{ id: 1, name: 'fourfolium' }],
                album: { id: 1, name: 'TVアニメ「NEW GAME!」オープニングテーマ「SAKURAステップ」' },
                durationMs: 249000
            }
        );

        expect(aliasDetails.titleMatched).toBe(true);
        expect(aliasDetails.score).toBeGreaterThanOrEqual(75);
        expect(instrumentalDetails.score).toBeLessThan(aliasDetails.score);
    });

    it('gives duration enough weight to penalize otherwise similar wrong-length results', () => {
        const exactDurationScore = calculateMatchScore(
            {
                title: 'Song Title',
                artist: 'Artist Name',
                album: 'Album Name',
                durationMs: 200000
            },
            {
                id: 301,
                name: 'Song Title',
                artists: [{ id: 1, name: 'Artist Name' }],
                album: { id: 1, name: 'Album Name' },
                durationMs: 200000
            }
        );
        const wrongDurationScore = calculateMatchScore(
            {
                title: 'Song Title',
                artist: 'Artist Name',
                album: 'Album Name',
                durationMs: 200000
            },
            {
                id: 302,
                name: 'Song Title',
                artists: [{ id: 1, name: 'Artist Name' }],
                album: { id: 1, name: 'Album Name' },
                durationMs: 245000
            }
        );

        expect(exactDurationScore).toBe(100);
        expect(wrongDurationScore).toBeLessThan(75);
    });

    it('marks duration as matched only when the difference is at most three seconds', () => {
        const target = {
            title: 'Song Title',
            artist: 'Artist Name',
            durationMs: 200000
        };
        const result = {
            id: 303,
            name: 'Song Title',
            artists: [{ id: 1, name: 'Artist Name' }],
            album: { id: 1, name: 'Album Name' }
        };

        expect(calculateMatchScoreDetails(target, { ...result, durationMs: 203000 }).durationMatched).toBe(true);
        expect(calculateMatchScoreDetails(target, { ...result, durationMs: 203001 }).durationMatched).toBe(false);
    });

    it('strips feat. tags from album and handles partial artist arrays safely', () => {
        const details = calculateMatchScoreDetails(
            {
                title: 'イグニッション',
                artist: '*Luna, ゆある, ねんね',
                album: 'イグニッション',
                durationMs: 200000
            },
            {
                id: 501,
                name: 'イグニッション (feat. Yuaru、Nenne)',
                artists: [{ id: 1, name: '*Luna' }],
                album: { id: 1, name: 'イグニッション (feat. Yuaru、Nenne)' },
                durationMs: 200000
            }
        );

        expect(details.titleMatched).toBe(true);
        expect(details.artistMatched).toBe(true);
        expect(details.albumMatched).toBe(true);
        expect(details.score).toBeGreaterThanOrEqual(90);
    });

    it('normalizes traditional chinese to simplified and katakana to romaji', () => {
        const details = calculateMatchScoreDetails(
            {
                title: '深藍',
                artist: 'ルルティア',
                album: 'NODE from R',
                durationMs: 200000
            },
            {
                id: 601,
                name: '深蓝',
                artists: [{ id: 1, name: 'RURUTIA' }],
                album: { id: 1, name: 'NODE from R' },
                durationMs: 200000
            }
        );

        expect(details.titleMatched).toBe(true);
        expect(details.artistMatched).toBe(true);
        expect(details.score).toBeGreaterThanOrEqual(95);
    });
});

