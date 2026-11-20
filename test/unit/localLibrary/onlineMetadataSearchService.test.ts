// @builtin-sources
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { UnifiedSong } from '@/types';
import type { OnlineMusicProvider } from '@/types/onlineMusic';
import { neteaseApi } from '../../../sources/netease/core/netease';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import {
    findAutomaticOnlineMetadataCandidate,
    searchOnlineMetadata,
} from '@/services/onlineMetadataSearchService';

// test/unit/localLibrary/onlineMetadataSearchService.test.ts
// Verifies metadata-only provider selection and exact manual query forwarding.

// The module's own pure helpers stay real (the source reads songs through them); the search is mocked.
vi.mock('../../../sources/netease/core/netease', async (importOriginal) => {
    const original = await importOriginal<{ neteaseApi: object }>();
    return { ...original, neteaseApi: { ...original.neteaseApi, cloudSearch: vi.fn() } };
});

const song = {
    id: 'local-song',
    fileName: 'Target Song.flac',
    filePath: 'Library/Target Song.flac',
    title: 'Target Song',
    titleOrigin: 'import' as const,
    importedMetadata: { title: 'Target Song', titleSource: 'filename' as const, artistNames: ['Target Artist'], albumName: 'Target Album' },
    duration: 200000,
    fileSize: 1,
    mimeType: 'audio/flac',
    addedAt: 1,
};

describe('onlineMetadataSearchService', () => {
    // QQ is a source mod: the metadata search asks its provider's search.searchSongs.
    let searchQQLyrics: MockInstance<NonNullable<NonNullable<OnlineMusicProvider['search']>['searchSongs']>>;
    const qqResults = (items: UnifiedSong[]) => ({ items, hasMore: false, nextOffset: items.length });

    beforeEach(() => {
        vi.resetAllMocks();
        searchQQLyrics = vi.spyOn(getOnlineMusicProvider('qq')!.search!, 'searchSongs').mockResolvedValue(qqResults([]));
    });

    it('keeps a title-compatible NetEase candidate without querying QQ', async () => {
        vi.mocked(neteaseApi.cloudSearch).mockResolvedValue({ result: { songs: [
            { id: 1, name: 'Target Song', dt: 200000, ar: [{ id: 2, name: 'Target Artist' }], al: { id: 3, name: 'Target Album' } },
        ] } });
        const candidate = await findAutomaticOnlineMetadataCandidate(song);
        expect(candidate?.source).toBe('netease');
        expect(candidate?.durationMatched).toBe(true);
        expect(searchQQLyrics).not.toHaveBeenCalled();
    });

    it('falls back to QQ when NetEase has no title-compatible candidate', async () => {
        vi.mocked(neteaseApi.cloudSearch).mockResolvedValue({ result: { songs: [
            { id: 1, name: 'Completely Unrelated Melody', dt: 200000, ar: [{ name: 'Someone Else' }] },
        ] } });
        searchQQLyrics.mockResolvedValue(qqResults([
            {
                id: 'qq-mid',
                qqMid: 'qq-mid',
                name: 'Target Song',
                durationMs: 200000,
                artists: [{ id: 7, name: 'Target Artist' }],
                album: { id: 8, name: 'Target Album', coverUrl: 'https://example.test/qq-cover.jpg' },
                sourceRef: { kind: 'online', providerId: 'qq', mediaId: 'qq-mid', providerData: { songId: 9 } },
            },
        ]));
        const candidate = await findAutomaticOnlineMetadataCandidate(song);
        expect(candidate).toMatchObject({
            source: 'qq',
            songId: 'qq-mid',
            titleMatched: true,
            coverUrl: 'https://example.test/qq-cover.jpg',
        });
    });

    it('falls back to provider-backed KuGou when NetEase and QQ have no title-compatible candidate', async () => {
        vi.mocked(neteaseApi.cloudSearch).mockResolvedValue({ result: { songs: [] } });
        const kugouProvider = getOnlineMusicProvider('kugou')!;
        vi.spyOn(kugouProvider.search!, 'searchSongs').mockResolvedValue({
            items: [{
                id: 'HASH',
                kgHash: 'HASH',
                name: 'Target Song',
                durationMs: 200000,
                artists: [{ id: 7, name: 'Target Artist' }],
                album: { id: 8, name: 'Target Album', coverUrl: 'https://example.test/kugou-cover.jpg' },
                sourceRef: { kind: 'online', providerId: 'kugou', mediaId: 'HASH' },
            }],
            hasMore: false,
            nextOffset: 1,
        });

        const candidate = await findAutomaticOnlineMetadataCandidate(song);

        expect(candidate).toMatchObject({
            source: 'kugou',
            songId: 'HASH',
            titleMatched: true,
            coverUrl: 'https://example.test/kugou-cover.jpg',
        });
    });

    it('passes a manual query only to the selected source', async () => {
        await searchOnlineMetadata('qq', 'custom user text', {
            title: 'Target Song', artist: '', durationMs: 0,
        });
        expect(searchQQLyrics).toHaveBeenCalledWith('custom user text', 10, 0);
        expect(neteaseApi.cloudSearch).not.toHaveBeenCalled();
    });

    it('stops waiting for a provider request when cancelled', async () => {
        let resolveRequest!: (value: { result: { songs: never[] } }) => void;
        vi.mocked(neteaseApi.cloudSearch).mockReturnValue(new Promise(resolve => {
            resolveRequest = resolve;
        }));
        const controller = new AbortController();
        const pending = searchOnlineMetadata('netease', 'Target Song', {
            title: 'Target Song', artist: '', durationMs: 0,
        }, { signal: controller.signal });
        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        resolveRequest({ result: { songs: [] } });
    });
});
