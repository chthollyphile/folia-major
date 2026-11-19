import type { FoliumSourceCollection, FoliumSourceNamedRef, FoliumSourceSong, FoliumSourceUser } from '@folia/folium';
import { qishuiError } from './qishuiTransport';

// sources/qishui/client/qishuiNormalize.ts
// 汽水车机接口的原始记录 → 公开契约的 DTO。宿主的形状由适配层转：歌单的 `data` 就是迁之前的 providerData。
// 64 位的媒体 id 一律当文字，不转成数；能不能播不从付费标签猜。

export type QishuiRecord = Record<string, any>;
export const record = (raw: unknown): QishuiRecord => raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
const text = (value: unknown) => value == null ? '' : String(value);

export function qishuiImage(raw: unknown): string {
    if (typeof raw === 'string') return raw.startsWith('https://') ? raw : '';
    const value = record(raw);
    const url = Array.isArray(value.urls) ? value.urls.find((item: unknown) => typeof item === 'string' && item.startsWith('https://')) : '';
    if (!url) return '';
    return value.uri && url.endsWith('/') ? `${url}${value.uri}${value.template_prefix ? `~${value.template_prefix}-image.image` : ''}` : url;
}

// An artist opens in the catalogue only where Qishui names its id (the built-in provider made no catalogue ref otherwise).
const artistOf = (artist: QishuiRecord): FoliumSourceNamedRef => (
    { id: text(artist.id), name: text(artist.name), ...(artist.id ? {} : { ref: false }) }
);

export function normalizeQishuiSong(raw: unknown): FoliumSourceSong {
    const song = record(raw);
    const base = record(song.base_info);
    const id = text(base.id || song.id);
    if (!/^\d+$/.test(id)) throw qishuiError('invalid-response', 'Qishui track ID is missing');
    const related = record(song.related_info);
    const album = record(related.album_link);
    const composers: unknown = record(base.song_maker_team).composers;
    const listed: unknown = Array.isArray(related.artist_links) ? related.artist_links : composers;
    const artists = Array.isArray(listed) ? listed.map(record) : [];
    return {
        id, title: text(base.name), durationMs: Math.max(0, Number(base.duration_ms) || 0),
        artists: artists.filter(artist => artist.name).map(artistOf),
        // The car SDK has no album endpoint; retain metadata without an unusable album link.
        album: { id: text(album.id), name: text(album.name), coverUrl: qishuiImage(record(song.display_info).cover_url), ref: false },
    };
}

export function normalizeQishuiCollection(raw: unknown, type = 'playlist'): FoliumSourceCollection {
    const item = record(raw);
    const base = record(item.base_info);
    if (!base.id) throw qishuiError('invalid-response', 'Qishui collection ID is missing');
    const owner = record(record(item.relation_info).owner);
    const trackCount: unknown = record(item.resource_cnt).track_cnt;
    return {
        id: text(base.id), type, name: text(base.title || base.name),
        coverUrl: qishuiImage(type === 'artist' ? base.url_avatar : record(item.display_info).url_cover), description: text(base.desc || base.intro),
        ...(trackCount == null ? {} : { trackCount: Number(trackCount) }),
        ...(owner.id ? { creator: { id: text(owner.id), nickname: text(owner.nickname) } } : {}),
        ...(item.isOwned == null ? {} : { isOwned: Boolean(item.isOwned) }), data: { ownerId: text(base.owner_id || owner.id) },
        ...(Number(base.type) === 1 && item.isOwned === true ? { isLiked: true } : {}),
    };
}

export function normalizeQishuiUser(raw: unknown): FoliumSourceUser {
    const user = record(raw);
    if (!user.id) throw qishuiError('invalid-response', 'Qishui account ID is missing');
    return { id: text(user.id), nickname: text(user.nickname), avatarUrl: qishuiImage(user.avatar), vipType: user.isVip ? 1 : 0 };
}

/** The owner id a playlist was read with (`data.ownerId`), which its songs are asked with. */
export const qishuiOwnerOf = (collection?: FoliumSourceCollection): string => (
    typeof collection?.data?.ownerId === 'string' ? collection.data.ownerId : ''
);
