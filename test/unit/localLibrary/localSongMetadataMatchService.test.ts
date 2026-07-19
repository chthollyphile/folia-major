import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalSong } from '@/types';
import { findAutomaticOnlineMetadataCandidate } from '@/services/onlineMetadataSearchService';
import { applyLocalSongMatchSelection } from '@/services/localSongMatchSelectionService';
import {
    applyOnlineMetadataCandidate,
    batchAutoMatchLocalSongMetadata,
    useImportedSnapshotForLocalSong,
} from '@/services/localSongMetadataMatchService';

// test/unit/localLibrary/localSongMetadataMatchService.test.ts
// Covers shared-command routing, cover policy, cancellation, and the two-worker limit.

vi.mock('@/services/localSongMatchSelectionService', () => ({ applyLocalSongMatchSelection: vi.fn() }));
vi.mock('@/services/onlineMetadataSearchService', () => ({ findAutomaticOnlineMetadataCandidate: vi.fn() }));

const song = (id: string, patch: Partial<LocalSong> = {}): LocalSong => ({
    id,
    fileName: `${id}.flac`,
    filePath: `Library/${id}.flac`,
    title: id,
    titleOrigin: 'import',
    importedMetadata: { title: id, titleSource: 'filename', artistNames: [] },
    duration: 1,
    fileSize: 1,
    mimeType: 'audio/flac',
    addedAt: 1,
    ...patch,
});

const candidate = {
    source: 'qq' as const,
    songId: 'qq-mid',
    title: 'Song',
    artists: [{ name: 'Artist' }],
    album: { id: 'album-id', name: 'Album' },
    coverUrl: 'https://example.test/cover.jpg',
    durationMs: 1,
    score: 90,
    titleMatched: true,
    durationMatched: true,
    raw: {
        id: 1,
        name: 'Song',
        artists: [{ id: 2, name: 'Artist' }],
        album: { id: 3, name: 'Album' },
        durationMs: 1,
    },
};

describe('localSongMetadataMatchService', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(applyLocalSongMatchSelection).mockResolvedValue({
            coverAttempted: true,
            coverCached: true,
            lyricsApplied: true,
            partialLyricsFailure: false,
        });
    });

    it('routes manual metadata and cover selection through the shared command', async () => {
        await applyOnlineMetadataCandidate(song('manual'), candidate, {
            mode: 'manual',
            useOnlineMetadata: true,
            useOnlineCover: true,
        });
        expect(applyLocalSongMatchSelection).toHaveBeenCalledWith({
            songId: 'manual',
            candidate,
            metadata: 'online',
            cover: 'online',
            lyrics: 'keep',
            setNoAutoMatch: false,
            matchMode: 'manual',
            protectOrigins: undefined,
        });
    });

    it('keeps an embedded cover during automatic metadata matching', async () => {
        await applyOnlineMetadataCandidate(song('embedded', { embeddedCover: new Blob(['cover']) }), candidate, {
            mode: 'automatic',
            protectOrigins: ['manual', 'manual-match', 'split'],
        });
        expect(applyLocalSongMatchSelection).toHaveBeenCalledWith(expect.objectContaining({
            metadata: 'online',
            cover: 'keep',
            setNoAutoMatch: undefined,
            matchMode: 'automatic',
            protectOrigins: ['manual', 'manual-match', 'split'],
        }));
    });

    it('restores imported metadata while allowing an independently selected online cover', async () => {
        await applyOnlineMetadataCandidate(song('cover-only'), candidate, {
            mode: 'manual',
            useOnlineMetadata: false,
            useOnlineCover: true,
        });
        expect(applyLocalSongMatchSelection).toHaveBeenCalledWith(expect.objectContaining({
            metadata: 'imported',
            cover: 'online',
            lyrics: 'keep',
        }));
    });

    it('restores local info and disables future automatic matching', async () => {
        await useImportedSnapshotForLocalSong('local-info');
        expect(applyLocalSongMatchSelection).toHaveBeenCalledWith({
            songId: 'local-info',
            metadata: 'imported',
            cover: 'embedded',
            lyrics: 'automatic',
            setNoAutoMatch: true,
        });
    });

    it('skips noAutoMatch songs and never exceeds two searches', async () => {
        let active = 0;
        let maxActive = 0;
        vi.mocked(findAutomaticOnlineMetadataCandidate).mockImplementation(async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise(resolve => setTimeout(resolve, 5));
            active -= 1;
            return candidate;
        });
        const result = await batchAutoMatchLocalSongMetadata([
            song('skip', { noAutoMatch: true }), song('one'), song('two'), song('three'),
        ]);
        expect(maxActive).toBe(2);
        expect(result.updates.find(update => update.songId === 'skip')?.status).toBe('skipped');
        expect(findAutomaticOnlineMetadataCandidate).toHaveBeenCalledTimes(3);
    });

    it('stops before applying an in-flight result after cancellation', async () => {
        const controller = new AbortController();
        vi.mocked(findAutomaticOnlineMetadataCandidate).mockImplementation(async () => {
            controller.abort();
            return candidate;
        });
        const result = await batchAutoMatchLocalSongMetadata([song('cancelled')], { signal: controller.signal });
        expect(result.cancelled).toBe(true);
        expect(applyLocalSongMatchSelection).not.toHaveBeenCalled();
    });
});
