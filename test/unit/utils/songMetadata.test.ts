import { describe, expect, it } from 'vitest';
import { createProviderSongMetadata, getSongAlbumCoverUrl } from '../../../src/utils/songMetadata';

// Keeps provider-normalized album covers canonical.

describe('songMetadata', () => {
    it('reads the canonical album cover', () => {
        expect(getSongAlbumCoverUrl({ album: { id: 1, name: 'Album', coverUrl: 'canonical.jpg' } }))
            .toBe('canonical.jpg');
    });

    it('copies canonical cover fields into provider metadata', () => {
        const metadata = createProviderSongMetadata({
            id: 1,
            name: 'Song',
            artists: [{ id: 2, name: 'Artist' }],
            album: { id: 3, name: 'Album', coverUrl: 'qq.jpg' },
            durationMs: 1000,
        });

        expect(metadata.coverUrl).toBe('qq.jpg');
        expect(metadata.album.coverUrl).toBe('qq.jpg');
    });
});
