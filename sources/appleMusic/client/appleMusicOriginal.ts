import type { FoliumSourceLyricAlias, FoliumSourceSong } from '@folia/folium';
import { appleMusicCatalogSongId } from './appleMusicData';
import { requestAppleMusic } from './appleMusicTransport';

// The page owns the ID cache, so session and storefront changes are respected.
export async function getAppleMusicLyricSearchAlias(song: FoliumSourceSong): Promise<FoliumSourceLyricAlias | null> {
    if (!/^[\p{Script=Latin}\p{Number}\p{Punctuation}\p{Separator}\p{Symbol}]+$/u.test(song.title) || !/[A-Za-z]/.test(song.title)) return null;
    let catalogId: string;
    try { catalogId = appleMusicCatalogSongId(song); } catch { return null; }
    const original = await requestAppleMusic<{ name?: unknown; artistName?: unknown; albumName?: unknown } | null>('songOriginal', { catalogId }).catch(() => null);
    if (!original || typeof original.name !== 'string' || !original.name.trim() || original.name === song.title
        || typeof original.artistName !== 'string' || !original.artistName.trim()) return null;
    return { title: original.name, artist: original.artistName, ...(typeof original.albumName === 'string' && original.albumName ? { album: original.albumName } : {}) };
}
