import { describe, expect, it } from 'vitest';
import { normalizeAppleMusicPlaylist, normalizeAppleMusicSong, normalizeAppleMusicUser } from '../../../src/services/onlineMusic/appleMusic/appleMusicNormalize';

// Check catalog and library identities using synthetic versions of observed response shapes.
describe('Apple Music resource normalization', () => {
    it('keeps catalog song IDs as strings and expands artwork templates', () => {
        const song = normalizeAppleMusicSong({
            id: '12345678901234567890', type: 'songs',
            attributes: {
                name: 'Example', artistName: 'Artist', albumName: 'Album', durationInMillis: 123456,
                artwork: { url: 'https://example.test/{w}x{h}.jpg' },
                playParams: { id: '12345678901234567890', kind: 'song' },
            },
        });
        expect(song.id).toBe('12345678901234567890');
        expect(song.sourceRef).toMatchObject({ kind: 'online', providerId: 'appleMusic', mediaId: song.id });
        expect(song.album.coverUrl).toBe('https://example.test/512x512.jpg');
        expect(song.durationMs).toBe(123456);
        expect(normalizeAppleMusicSong(song)).toBe(song);
    });

    it('does not replace a library identity with its catalog identity', () => {
        const song = normalizeAppleMusicSong({
            id: 'i.library', type: 'library-songs',
            attributes: { playParams: { id: 'i.library', kind: 'song', isLibrary: true, catalogId: '100' } },
        });
        expect(song.sourceRef).toMatchObject({
            kind: 'online', providerId: 'appleMusic', mediaId: 'i.library',
            providerData: { resourceType: 'library-songs', playbackId: 'i.library', catalogId: '100', isLibrary: true },
        });
        expect(song.durationMs).toBe(0);
        expect(song.artists).toEqual([]);
    });

    it('preserves the playlist resource kind and leaves an unknown count unset', () => {
        const list = normalizeAppleMusicPlaylist({ id: 'p.example', type: 'library-playlists', attributes: { name: 'Example' } });
        expect(list).toMatchObject({ id: 'p.example', providerId: 'appleMusic', type: 'playlist', providerData: { resourceType: 'library-playlists' } });
        expect(list.trackCount).toBeUndefined();
        expect(normalizeAppleMusicPlaylist(list)).toBe(list);
    });

    it('rejects resources without a supported identity and handles invalid durations', () => {
        expect(() => normalizeAppleMusicSong({ type: 'songs', attributes: {} })).toThrow();
        expect(() => normalizeAppleMusicSong({ id: '123', type: 'music-videos' })).toThrow();
        expect(() => normalizeAppleMusicPlaylist({ id: '123', type: 'albums' })).toThrow();
        expect(normalizeAppleMusicSong({ id: '1', type: 'songs', attributes: { durationInMillis: -1 } }).durationMs).toBe(0);
    });

    it('expands a social profile avatar and leaves missing artwork unset', () => {
        expect(normalizeAppleMusicUser({ id: 'a'.repeat(64), avatarUrl: 'https://example.test/{w}x{h}.jpg' }).avatarUrl).toBe('https://example.test/128x128.jpg');
        expect(normalizeAppleMusicUser({ id: 'a'.repeat(64) }).avatarUrl).toBeUndefined();
    });

    it('requires an account-specific pseudonym before accepting a snapshot', () => {
        expect(normalizeAppleMusicUser({ id: 'a'.repeat(64), nickname: 'Example' })).toMatchObject({ id: 'a'.repeat(64) });
        expect(() => normalizeAppleMusicUser({ id: 'me' })).toThrow();
    });
});
