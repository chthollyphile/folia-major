import type {
    FoliumSourceAudio,
    FoliumSourceCollection,
    FoliumSourceDef,
    FoliumSourceLoginState,
    FoliumSourceSong,
    FoliumSourceSongAvailability,
    FoliumSourceUser,
    FoliumText,
} from '@folia/folium';
import type { BodianLyricsPayload } from 'bodian-music-api';
import { bodianError, requestBodian } from './bodianTransport';
import { describeBodianFailure } from './bodianFailure';
import { bodianPage, bodianRecord, getBodianLyricSearchAlias, normalizeBodianCollection, normalizeBodianSong } from './bodianNormalize';
import { bodianCatalog } from './bodianCatalog';
import { bodianCovers } from './bodianCovers';
import { bodianLibrary, clearBodianLibraryCache } from './bodianLibrary';
import { bodianMutations } from './bodianMutations';
import { toBodianLyrics } from './bodianLyrics';

// sources/bodian/client/bodianProvider.ts
// 波点音源的定义（folium.sources.register 收的那份）：每个能力族一组成员，形状是公开契约的。
// 宿主的开关由实现了哪些能力推导（适配层 parts.ts），和迁之前手写的开关表一致。

const BODIAN_DISCOVER_MODULE_ID = 1;

type BodianDiscoverDetail = { title?: unknown; subTitle?: unknown; musicList?: unknown[] };

/** What the definition needs of the host besides the transport: the mod's own texts and the host's lyric rule. */
export interface BodianSourceEnv {
    text(key: string): FoliumText;
    isPureMusicText(text: string): boolean;
}

const normalizeBodianDiscoverCollection = (detail: BodianDiscoverDetail, index: number, fallbackTitle?: unknown): FoliumSourceCollection => {
    const songs = Array.isArray(detail.musicList) ? detail.musicList.map(normalizeBodianSong) : [];
    const firstSong = songs.at(0);
    return {
        id: `discover-${index}`,
        type: 'playlist',
        name: String(detail.title || fallbackTitle || `Discover ${index + 1}`),
        coverUrl: firstSong?.album?.coverUrl || '',
        description: String(detail.subTitle || '「为你量身打造的专属歌单」'),
        trackCount: songs.length,
        data: { discoverIndex: index },
    };
};

/** A list Bodian answers, or none where it answered something else. */
const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value as unknown[] : []);

/** The cursor the main entry's package adds to a page it read past unavailable songs (bodian-music-api). */
type BodianCursor = { nextOffset: number; hasMore: boolean };

async function getBodianDiscoverCollections(): Promise<FoliumSourceCollection[]> {
    try {
        const module = await requestBodian<{ songList?: unknown }>('home_module', { moduleId: BODIAN_DISCOVER_MODULE_ID });
        const results = await Promise.allSettled(listOf(module.songList).map(async (raw) => {
            const card = bodianRecord(raw) as { id?: unknown; title?: unknown };
            const index = Number(card.id);
            if (!Number.isInteger(index) || index < 0) return null;
            const detail = await requestBodian<BodianDiscoverDetail>('ai_playlist_detail', { index });
            return normalizeBodianDiscoverCollection(detail, index, card.title);
        }));
        return results.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []);
    } catch {
        return [];
    }
}

/**
 * songs@1.getAvailability. 只有下架信号会给 unavailable / taken-down；播放限制交给运行时。缓存里旧的布尔 `unavailable`
 * 分不清下架还是限制，一律按 unknown。每次交回同样的几个对象：宿主每个对象只转一次形状（画行时问，热路径）。
 */
function bodianSongAvailability(): (song: FoliumSourceSong) => FoliumSourceSongAvailability {
    const takenDown = Object.freeze({ state: 'unavailable', reason: 'taken-down' } as const);
    const restricted = Object.freeze({ state: 'unknown', reason: 'restricted' } as const);
    const unknown = Object.freeze({ state: 'unknown' } as const);
    return (song) => {
        const availability = song.data?.availability;
        if (availability === 'off-shelf') return takenDown;
        if (availability === 'online-play-restricted') return restricted;
        return unknown;
    };
}

/** The source of the manifest's `sources[0]` (id `bodian`). */
export const createBodianSource = (env: BodianSourceEnv): FoliumSourceDef => ({
    id: 'bodian',
    // The full name stays as the built-in provider wrote it, in every language; the short one is the mod's own.
    displayName: '波点音乐',
    shortName: env.text('name.short'),
    mark: { letter: '波', color: '#0d9488' },
    describeFailure: describeBodianFailure,
    capabilities: {
        // Searching needs no account, but the federated search lists a source with sign-in only once signed in,
        // as it did the built-in provider (crossSource.ts: a platform with auth and no declaration).
        'search@1': {
            access: 'account',
            async searchSongs(query, limit, offset) {
                if (!query.trim()) return bodianPage([], 0, offset, limit);
                const data = await requestBodian<{ resultList?: unknown; total?: unknown; bodianPagination?: BodianCursor }>('search', { query, limit, offset });
                if (!Array.isArray(data.resultList)) throw bodianError('invalid-response', 'Bodian search list is missing');
                return bodianPage(listOf(data.resultList).map(normalizeBodianSong), data.total, offset, limit, data.bodianPagination);
            },
        },
        'songs@1': {
            async getSong(id) { return normalizeBodianSong(await requestBodian('song_detail', { id })); },
            getAvailability: bodianSongAvailability(),
        },
        'playback.audio@1': {
            async getAudioSource(song, quality) {
                // Where the account may play only a clip of the song, the answer comes with `preview` (the
                // clip's { startTime, endTime } in the song, bodian-music-api playback.cjs). The URL is
                // handed out marked as a preview: it plays with a notice, and is never cached as the song.
                const { preview, ...audio } = await requestBodian<FoliumSourceAudio & { preview?: unknown }>('audio', {
                    id: song.id, quality, freeSign: typeof song.data?.freeSign === 'string' ? song.data.freeSign : '',
                });
                return preview ? { ...audio, preview: true } : audio;
            },
        },
        'lyrics@1': {
            async getLyrics(song: FoliumSourceSong) {
                const data = await requestBodian<BodianLyricsPayload>('lyrics', { id: song.id });
                return toBodianLyrics(data, text => env.isPureMusicText(text));
            },
            getSearchAlias: getBodianLyricSearchAlias,
        },
        'auth@1': {
            getLoginTexts: () => ({ title: env.text('login.title'), note: env.text('login.note') }),
            getLoginStatus: () => requestBodian<FoliumSourceUser | null>('login_status'),
            async logout() { clearBodianLibraryCache(); await requestBodian('logout'); },
            async startLogin() { return (await requestBodian<{ key: string }>('login_qr_key')).key; },
            async createQr(key) { return (await requestBodian<{ imageUrl: string }>('login_qr_create', { key })).imageUrl; },
            checkLogin: key => requestBodian<FoliumSourceLoginState>('login_qr_check', { key }),
            async cancelLogin(key) { await requestBodian('login_qr_cancel', { key }); },
            getLoginTtlMs: () => 5 * 60 * 1000,
        },
        'catalog@1': bodianCatalog,
        'library@1': bodianLibrary,
        'mutations@1': bodianMutations,
        'recommendations@1': {
            async getRecommendedCollections(limit) {
                const [regular, discover] = await Promise.all([
                    requestBodian<{ lists?: unknown }>('recommendations').then(data => (
                        listOf(data.lists).flatMap(group => listOf(bodianRecord(group).playLists)).map(item => normalizeBodianCollection(item))
                    )).catch(() => [] as FoliumSourceCollection[]),
                    getBodianDiscoverCollections(),
                ]);
                const seen = new Set<string>();
                return [...discover, ...regular].filter((collection: FoliumSourceCollection) => {
                    if (seen.has(collection.id)) return false;
                    seen.add(collection.id);
                    return true;
                }).slice(0, limit);
            },
            async getPersonalFm() {
                return requestBodian<{ musicList?: unknown }>('personal_fm')
                    .then(data => listOf(data.musicList).map(normalizeBodianSong))
                    .catch(() => []);
            },
        },
        'covers@1': bodianCovers,
    },
});

