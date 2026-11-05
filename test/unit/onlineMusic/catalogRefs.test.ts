import { describe, expect, it } from 'vitest';
import type { UnifiedSong } from '@/types';
import {
    canResolveSongCatalogRef,
    resolveCollectionArtistCatalogId,
    resolveSongCatalogRef,
} from '@/services/onlineMusic/catalogRefs';

const onlineSongWithoutCatalogMetadata = {
    sourceRef: { kind: 'online', providerId: 'missing-provider' },
} as unknown as UnifiedSong;

describe('online catalog references', () => {
    it('does not throw when deployed provider data omits album metadata', async () => {
        expect(canResolveSongCatalogRef(
            onlineSongWithoutCatalogMetadata,
            'album',
            undefined,
        )).toBe(false);

        await expect(resolveSongCatalogRef(
            onlineSongWithoutCatalogMetadata,
            'album',
            undefined,
        )).resolves.toBeNull();
    });
});

// #1058：专辑页头的歌手只有真能打开的才可点；各平台拿不到真实 id 时填的占位 id 不当真。
describe('collection artist catalog ids', () => {
    it('opens a provider that keeps catalog refs only through its ref', () => {
        // QQ 用 catalogRef；没有 mid 的歌手拿下标当 id。
        expect(resolveCollectionArtistCatalogId('qq', { id: 'mid', catalogRef: { providerId: 'qq', kind: 'artist', id: 'mid' } })).toBe('mid');
        expect(resolveCollectionArtistCatalogId('qq', { id: 1 })).toBeUndefined();
        expect(resolveCollectionArtistCatalogId('kugou', { id: 'kugou-artist-0-Name' })).toBeUndefined();
        expect(resolveCollectionArtistCatalogId('qq', { id: 'x', catalogRef: { providerId: 'kugou', kind: 'artist', id: 'x' } })).toBeUndefined();
    });

    it('opens a provider without catalog refs by its own id, where 0 means none', () => {
        expect(resolveCollectionArtistCatalogId('netease', { id: 12138 })).toBe(12138);
        expect(resolveCollectionArtistCatalogId('netease', { id: 0 })).toBeUndefined();
        expect(resolveCollectionArtistCatalogId('netease', { id: '' })).toBeUndefined();
    });
});
