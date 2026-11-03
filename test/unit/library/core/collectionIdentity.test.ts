import { describe, expect, it } from 'vitest';
import {
    collectionHashPath,
    collectionKey,
    collectionRevision,
} from '@/library/core/collection/collectionIdentity';
import { collectionKey as adapterCollectionKey } from '@/components/app/home/gridViewCollectionAdapters';

// test/unit/library/core/collectionIdentity.test.ts
// 集合身份：在线集合必须带 provider，否则两个 provider 下同 id 的歌单会共用网格实例和恢复记录。

describe('collection identity', () => {
    it('keys online collections by provider, type and id', () => {
        expect(collectionKey({ source: 'online', providerId: 'netease', type: 'playlist', id: 42 }))
            .toBe('online:netease:playlist:42');
        expect(collectionKey({ source: 'online', providerId: 'kugou', type: 'playlist', id: '42' }))
            .not.toBe(collectionKey({ source: 'online', providerId: 'netease', type: 'playlist', id: '42' }));
    });

    it('keeps the local and Navidrome format unchanged', () => {
        expect(collectionKey({ source: 'local', type: 'folder', id: 'folder-__all-songs__' }))
            .toBe('local:folder:folder-__all-songs__');
        expect(collectionKey({ source: 'navidrome', type: 'album', id: 'al-1' })).toBe('navidrome:album:al-1');
    });

    it('compares ids as strings and returns an empty key for no collection', () => {
        expect(collectionKey({ source: 'online', providerId: 'netease', type: 'album', id: 7 }))
            .toBe(collectionKey({ source: 'online', providerId: 'netease', type: 'album', id: '7' }));
        expect(collectionKey(null)).toBe('');
        expect(collectionKey(undefined)).toBe('');
    });

    it('is the same function the home adapters export', () => {
        expect(adapterCollectionKey).toBe(collectionKey);
    });

    it('puts the provider into the online hash path and encodes ids', () => {
        expect(collectionHashPath({ source: 'online', providerId: 'netease', type: 'playlist', id: 'a/b' }))
            .toBe('#collection/online/netease/playlist/a%2Fb');
        expect(collectionHashPath({ source: 'local', type: 'album', id: 'entity 1' }))
            .toBe('#collection/local/album/entity%201');
    });

    it('changes the revision when any field that invalidates loaded tracks changes', () => {
        const base = { tracksUpdatedAt: 1, updatedAt: 2, trackCount: 3 };
        expect(collectionRevision(base)).toBe('1|2|3');
        expect(collectionRevision({ ...base, trackCount: 4 })).not.toBe(collectionRevision(base));
        expect(collectionRevision({ ...base, tracksUpdatedAt: 5 })).not.toBe(collectionRevision(base));
        expect(collectionRevision({})).toBe('||');
        expect(collectionRevision(null)).toBe('');
    });
});
