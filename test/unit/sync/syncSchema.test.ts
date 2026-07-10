import { describe, expect, it } from 'vitest';
import { buildThemeBucketSummaries, getThemeBucketId } from '@/services/sync/syncMerkle';
import {
    parseSyncRemoteState,
    parseSyncLibraryExportBundle,
    parseSyncThemeManifest,
    parseSyncedSettingsRecord,
    parseSyncedThemeRecord,
    parseSyncedThemeRecords,
} from '@/services/sync/syncSchema';

// test/unit/sync/syncSchema.test.ts
// Guards sync schema parsing against malformed sync server responses.

describe('sync schema parsing', () => {
    it('keeps only valid synced visual settings fields', () => {
        const record = parseSyncedSettingsRecord({
            schemaVersion: 1,
            updatedAt: '2026-07-08T00:00:00.000Z',
            data: {
                visualizerMode: 'classic',
                visualizerBackgroundMode: 'bad',
                backgroundOpacity: Number.NaN,
                visualizerOpacity: 0.7,
                hidePlayerTranslationSubtitle: 'false',
                showSubtitleTranslation: true,
                lyricsFontStyle: 'fantasy',
                subtitleFontStyle: 'serif',
                lyricsFontFallbackFamilies: ['Inter', 'Arial'],
                subtitleFontFallbackFamilies: ['Noto Sans'],
                homeLayoutStyle: 'desktop',
                grid3dCardStyle: 'image',
            },
        });

        expect(record?.data).toEqual({
            visualizerMode: 'classic',
            visualizerOpacity: 0.7,
            showSubtitleTranslation: true,
            subtitleFontStyle: 'serif',
            lyricsFontFallbackFamilies: ['Inter', 'Arial'],
            subtitleFontFallbackFamilies: ['Noto Sans'],
            grid3dCardStyle: 'image',
        });
    });

    it('parses theme records and normalizes invalid sources', () => {
        const record = parseSyncedThemeRecord({
            fingerprint: 'netease:id:123',
            updatedAt: '2026-07-08T00:00:00.000Z',
            source: 'unknown',
            theme: {
                light: { name: 'Light', backgroundColor: '#fff', primaryColor: '#111', secondaryColor: '#333', accentColor: '#555', fontStyle: 'sans', animationIntensity: 'normal' },
                dark: { name: 'Dark', backgroundColor: '#111', primaryColor: '#fff', secondaryColor: '#ddd', accentColor: '#aaa', fontStyle: 'sans', animationIntensity: 'normal' },
            },
        });

        expect(record?.fingerprint).toBe('netease:id:123');
        expect(record?.source).toBe('manual');
    });

    it('skips invalid theme records in arrays', () => {
        expect(parseSyncedThemeRecords([
            { fingerprint: '', updatedAt: '2026-07-08T00:00:00.000Z' },
            { fingerprint: 'netease:id:123', updatedAt: 'bad' },
        ])).toEqual([]);
    });

    it('validates every nested record in sync library exports', () => {
        const exportedAt = '2026-07-08T00:00:00.000Z';
        const bundle = parseSyncLibraryExportBundle({
            kind: 'folia-sync-export',
            schemaVersion: 1,
            exportedAt,
            settings: null,
            themes: [{
                fingerprint: 'netease:id:123',
                updatedAt: exportedAt,
                source: 'manual',
                theme: {
                    light: { name: 'Light', backgroundColor: '#fff', primaryColor: '#111', secondaryColor: '#333', accentColor: '#555', fontStyle: 'sans', animationIntensity: 'normal' },
                    dark: { name: 'Dark', backgroundColor: '#111', primaryColor: '#fff', secondaryColor: '#ddd', accentColor: '#aaa', fontStyle: 'sans', animationIntensity: 'normal' },
                },
            }],
        });

        expect(bundle?.themes).toHaveLength(1);
        expect(bundle?.themes[0].fingerprint).toBe('netease:id:123');
    });

    it('rejects sync library exports with malformed nested records', () => {
        const baseBundle = {
            kind: 'folia-sync-export',
            schemaVersion: 1,
            exportedAt: '2026-07-08T00:00:00.000Z',
            settings: null,
        };

        expect(parseSyncLibraryExportBundle({
            ...baseBundle,
            themes: [{ fingerprint: 'netease:id:123', updatedAt: '2026-07-08T00:00:00.000Z' }],
        })).toBeNull();
        expect(parseSyncLibraryExportBundle({
            ...baseBundle,
            settings: {},
            themes: [],
        })).toBeNull();
    });

    it('parses remote state watermarks', () => {
        expect(parseSyncRemoteState({
            schemaVersion: 1,
            settingsUpdatedAt: '2026-07-08T00:00:00.000Z',
            themesUpdatedAt: '2026-07-08T01:00:00.000Z',
            themeCount: 12.8,
        })).toEqual({
            schemaVersion: 1,
            settingsUpdatedAt: '2026-07-08T00:00:00.000Z',
            themesUpdatedAt: '2026-07-08T01:00:00.000Z',
            themeCount: 12,
        });
    });

    it('rejects malformed remote state watermarks', () => {
        expect(parseSyncRemoteState({
            schemaVersion: 1,
            settingsUpdatedAt: 'bad',
            themesUpdatedAt: null,
            themeCount: 1,
        })).toBeNull();
    });

    it('parses theme bucket manifests', () => {
        expect(parseSyncThemeManifest({
            schemaVersion: 1,
            bucketCount: 256,
            buckets: [{
                bucketId: 7,
                count: 2,
                hash: '12345',
                updatedAt: '2026-07-08T00:00:00.000Z',
            }],
        })?.buckets[0]).toEqual({
            bucketId: 7,
            count: 2,
            hash: '12345',
            updatedAt: '2026-07-08T00:00:00.000Z',
        });
    });

    it('builds deterministic theme bucket summaries', () => {
        const records = [
            { fingerprint: 'netease:id:123', updatedAt: '2026-07-08T00:00:00.000Z' },
            { fingerprint: 'netease:id:456', updatedAt: '2026-07-08T01:00:00.000Z' },
        ];
        const buckets = buildThemeBucketSummaries([...records].reverse());
        const firstBucketId = getThemeBucketId(records[0].fingerprint);

        expect(buckets[firstBucketId].count).toBeGreaterThanOrEqual(1);
        expect(buildThemeBucketSummaries(records)).toEqual(buckets);
    });
});
