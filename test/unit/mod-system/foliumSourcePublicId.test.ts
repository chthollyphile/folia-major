import { describe, expect, it } from 'vitest';
import { toHostSong, toSourceSong } from '@/mods/folium/registries/sourceDtos';
import { toFoliumSong } from '@/mods/folium/dto';
import type { FoliumSourceSong } from '@/mods/folium/sources/contract';

// test/unit/mod-system/foliumSourcePublicId.test.ts
// FoliumSourceSong.publicId: the id other mods know a song by (folium.omni's FoliumSong.id) when it is not the source's
// own id. QQ Music gives its numeric songid there, so the id mods get stays the songid as since Folium 1.7 (the
// maintainer kept it so on 2026-11-20), while the host plays, keeps and looks the song up by the songmid.

const qqSong: FoliumSourceSong = {
    id: '0039MnYb0qxYhV',
    publicId: '97773',
    title: '晴天',
    artists: [{ id: '0025NhlN2yWrP4', name: '周杰伦' }],
    lyricIds: { qq: '0039MnYb0qxYhV' },
    data: { songId: 97773, songMid: '0039MnYb0qxYhV' },
};

describe('a source song\'s publicId', () => {
    it('is the host song\'s id and FoliumSong.id, while the mediaId stays the source\'s own id', () => {
        const host = toHostSong('qq', qqSong);
        expect(host.id).toBe('97773');
        expect(host.sourceRef).toMatchObject({ kind: 'online', providerId: 'qq', mediaId: '0039MnYb0qxYhV' });
        expect(toFoliumSong(host)).toMatchObject({ id: '97773', title: '晴天' });
    });

    it('comes back with the song the host hands the source, and is left out when the ids agree', () => {
        const back = toSourceSong(toHostSong('qq', qqSong));
        expect(back).toMatchObject({ id: '0039MnYb0qxYhV', publicId: '97773' });

        const plain = toSourceSong(toHostSong('kugou', { id: 'HASH', title: 'x', artists: [] }));
        expect(plain.id).toBe('HASH');
        expect(plain).not.toHaveProperty('publicId');
    });

    it('reads a QQ song kept before the move (numeric id, songmid as mediaId) the same way', () => {
        const kept = {
            id: 97773, name: '晴天', artists: [], album: { id: '', name: '' }, durationMs: 0, qqMid: '0039MnYb0qxYhV',
            sourceRef: { kind: 'online', providerId: 'qq', mediaId: '0039MnYb0qxYhV', providerData: { songId: 97773 } },
        };
        expect(toSourceSong(kept as never)).toMatchObject({ id: '0039MnYb0qxYhV', publicId: '97773' });
        expect(toFoliumSong(kept as never)).toMatchObject({ id: '97773' });
    });
});
