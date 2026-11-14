import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    LX_PUBLIC_PLATFORM_KEYS,
    LX_PUBLIC_PLATFORMS,
    lxApiAlbumName,
    type LxPublicPlatform,
} from '../../../../../services/onlineMusic/lxmusic/lxFacade';
import { ensureLxLikedSongsHydrated, getLxLikedSongs, subscribeLxLikedSongs } from '../../../../../services/onlineMusic/lxmusic/lxLikedSongs';
import { getLxSavedPlaylists, subscribeLxSavedPlaylists, type LxSavedSong } from '../../../../../services/onlineMusic/lxmusic/lxSavedPlaylists';
import { lxSavedAlbumCollectionId } from '../../../../../services/onlineMusic/lxmusic/lxFacade';
import { Grid3DSlider, type Grid3DSliderItem } from '../Grid3DSlider';
import { LxPlatformPicker, type LxPlatformKey } from '../../../../../components/lxmusic/LxPlatformPicker';

// src/library/suites/grid/home/lx/LxAlbumWall.tsx
// 首页「专辑」页签在洛雪下的形态：洛雪没有「用户专辑库」，但用户确实收藏了歌，
// 那些歌各自属于某张专辑 —— 这一页就是把这些专辑拼成一面封面墙。
//
// 卡片流跟歌单页同一套：复用首页的 Grid3DSlider（居中放大、两侧渐小变暗、一样的卡大小与滑动），
// 平台选择也跟歌单页、推荐页共用同一颗「当前平台」胶囊 + 浮层，不再自绘封面墙。
//
// 数据来自两处本机收藏：点过喜欢的歌（lxLikedSongs）+ 自己建过的歌单里的歌（lxSavedPlaylists）。
// 按「平台 + 平台原生专辑 id」归并（没有 id 时退回专辑名），所以同一个平台上同一张专辑只出现一次。
// 点一张专辑直接打开那家的专辑页（曲目、播放都在那里），比在这里另造一个曲目表更实在。

const platformLabel = (key: string): string => (
    LX_PUBLIC_PLATFORMS.find((item) => item.key === key)?.label ?? key
);

const PLATFORM_KEYS: ReadonlyArray<LxPlatformKey> = ['all', ...LX_PUBLIC_PLATFORM_KEYS];

type AlbumEntry = {
    key: string;
    platform: string;
    albumId?: string;
    name: string;
    coverUrl?: string;
    count: number;
};

const collectSavedSongs = (): LxSavedSong[] => {
    const seen = new Set<string>();
    const out: LxSavedSong[] = [];
    const push = (song: LxSavedSong): void => {
        if (!song?.mediaId || seen.has(song.mediaId)) return;
        seen.add(song.mediaId);
        out.push(song);
    };
    getLxLikedSongs().forEach(push);
    getLxSavedPlaylists().forEach((playlist) => playlist.songs.forEach(push));
    return out;
};

const UNKNOWN_ALBUM = '未知专辑';

/**
 * 收藏时没拿到专辑名的（酷狗搜索接口常常只回专辑 id），卡面只能写「未知专辑」。
 * 补到的真名按「平台:专辑 id」缓存在本机，下次直接就有了，不用每次进专辑页都去问接口。
 */
const ALBUM_META_CACHE_KEY = 'folia.lx.album-meta.v1';
type AlbumMeta = { name?: string; coverUrl?: string };

const readAlbumMeta = (): Record<string, AlbumMeta> => {
    try {
        const raw = localStorage.getItem(ALBUM_META_CACHE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (!parsed || typeof parsed !== 'object') return {};
        const out: Record<string, AlbumMeta> = {};
        Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => {
            if (!value || typeof value !== 'object') return;
            const meta = value as AlbumMeta;
            const name = typeof meta.name === 'string' ? meta.name.trim() : '';
            const coverUrl = typeof meta.coverUrl === 'string' ? meta.coverUrl : '';
            if (name || coverUrl) out[key] = { ...(name ? { name } : {}), ...(coverUrl ? { coverUrl } : {}) };
        });
        return out;
    } catch {
        return {};
    }
};

const writeAlbumMeta = (patch: Record<string, AlbumMeta>): void => {
    try {
        localStorage.setItem(ALBUM_META_CACHE_KEY, JSON.stringify({ ...readAlbumMeta(), ...patch }));
    } catch {
        // 存不下就当没补到，卡面照旧。
    }
};

const albumMetaKey = (platform: string, albumId?: string): string => (albumId ? `${platform}:${albumId}` : '');

const buildAlbums = (songs: LxSavedSong[], meta: Record<string, AlbumMeta> = {}): AlbumEntry[] => {
    const map = new Map<string, AlbumEntry>();
    songs.forEach((song) => {
        const albumName = (song.albumName ?? '').trim();
        const albumId = (song.albumId ?? '').trim() || undefined;
        // 有原生专辑 id 的进平台那张专辑页；只有名字（甚至名字都空）的，按「平台 + 专辑名」
        // 自己归成一张，点进去看本机收藏的这几首——总比从墙上凭空消失强。
        const key = albumId ? `${song.platform}:${albumId}` : lxSavedAlbumCollectionId(song.platform, albumName);
        const cached = albumId ? meta[albumMetaKey(song.platform, albumId)] : undefined;
        const current = map.get(key);
        if (current) {
            current.count += 1;
            if (!current.coverUrl && song.coverUrl) current.coverUrl = song.coverUrl;
            return;
        }
        // 收藏时就写着「未知专辑」的（酷狗老收藏很多是这种），缓存里有真名就用真名。
        const shownName = (albumName && albumName !== UNKNOWN_ALBUM)
            ? albumName
            : (cached?.name || albumName || UNKNOWN_ALBUM);
        map.set(key, {
            key,
            platform: song.platform,
            albumId,
            name: shownName,
            coverUrl: song.coverUrl ?? cached?.coverUrl,
            count: 1,
        });
    });
    // 「未知专辑」这种占位名由后面一次异步补名替换掉（补不到就保留占位，不含糊）。
    // 收藏得多的专辑排前面：那才是用户真在听的。
    return Array.from(map.values())
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
};

type LxAlbumWallProps = {
    onOpenAlbum: (platform: LxPublicPlatform, albumId: string, name: string, coverUrl?: string) => void;
    /** 日间/夜间：跟首页同一个主题。 */
    isDaylight?: boolean;
    hasFloatingPlayer?: boolean;
    isInteractive?: boolean;
};

export const LxAlbumWall = ({
    onOpenAlbum,
    isDaylight = false,
    hasFloatingPlayer = false,
    isInteractive = true,
}: LxAlbumWallProps) => {
    const [albums, setAlbums] = useState<AlbumEntry[]>(() => buildAlbums(collectSavedSongs(), readAlbumMeta()));
    const [hydrating, setHydrating] = useState(false);
    const [platform, setPlatform] = useState<LxPlatformKey>('all');
    const [focusedIndex, setFocusedIndex] = useState(0);

    const rebuild = useCallback(() => {
        setAlbums(buildAlbums(collectSavedSongs(), readAlbumMeta()));
    }, []);

    useEffect(() => {
        const offLiked = subscribeLxLikedSongs(rebuild);
        const offPlaylists = subscribeLxSavedPlaylists(rebuild);
        return () => { offLiked(); offPlaylists(); };
    }, [rebuild]);

    // 老版本点喜欢时只存了 id：补一次元数据（内部异步，补到会触发上面的订阅重画）。
    // 水合没有 Promise 可等，用一个短计时兜住转圈：真实补到之后墙会自己重画。
    useEffect(() => {
        setHydrating(true);
        ensureLxLikedSongsHydrated();
        const timer = window.setTimeout(() => setHydrating(false), 1500);
        return () => { window.clearTimeout(timer); };
    }, []);

    // 「未知专辑」是占位不是答案：拿平台专辑接口补一次真名，按专辑 id 缓存在本机。
    // 只有名字确实缺了的才去问（通常也就一两张），补到之后墙会自己用缓存名字重画。
    // 问过的 id 记在 ref 里：接口那边拿不到名字时不能每次都重试，否则一屏未知专辑会一直打接口。
    const namingAsked = useRef(new Set<string>());
    useEffect(() => {
        const pending = albums
            .filter((album) => album.albumId && (album.name === UNKNOWN_ALBUM || !album.name))
            .filter((album) => !namingAsked.current.has(albumMetaKey(album.platform, album.albumId)));
        if (pending.length === 0) return;
        pending.slice(0, 6).forEach((album) => namingAsked.current.add(albumMetaKey(album.platform, album.albumId)));
        let cancelled = false;
        void (async () => {
            const patch: Record<string, AlbumMeta> = {};
            await Promise.all(pending.slice(0, 6).map(async (album) => {
                const meta = await lxApiAlbumName(album.platform as LxPublicPlatform, album.albumId as string);
                if (meta.name || meta.coverUrl) patch[albumMetaKey(album.platform, album.albumId)] = meta;
            }));
            if (cancelled || Object.keys(patch).length === 0) return;
            writeAlbumMeta(patch);
            setAlbums(buildAlbums(collectSavedSongs(), readAlbumMeta()));
        })();
        return () => { cancelled = true; };
    }, [albums]);

    const visible = useMemo(
        () => (platform === 'all' ? albums : albums.filter((album) => album.platform === platform)),
        [albums, platform],
    );

    // 换平台或收藏变了都是换了一条卡流：焦点回到正中第一张。
    useEffect(() => {
        setFocusedIndex(0);
    }, [platform, visible.length]);

    const items: Grid3DSliderItem[] = visible.map((album) => ({
        id: album.key,
        name: album.name,
        // 这里的数字是「你在这张专辑里收了几首」，不是专辑总曲目数：点进去看到的是整张专辑，
        // 写「1 首」会让人以为专辑只有一首，所以标明是收藏数。
        description: `收藏 ${album.count} 首 · ${platformLabel(album.platform)}`,
        coverUrl: album.coverUrl,
    }));

    const noFavorites = albums.length === 0;
    if (noFavorites && !hydrating) {
        return (
            <div className="w-full h-full flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center" data-lx-album-wall>
                <div className="text-xs opacity-50">
                    还没有收藏歌曲。在曲目上点心形收藏之后，它的专辑会出现在这里。
                </div>
            </div>
        );
    }

    return (
        <div className="w-full h-full flex-1 flex flex-col min-h-0" data-lx-album-wall>
            <div className="shrink-0 pt-1">
                <LxPlatformPicker
                    keys={PLATFORM_KEYS}
                    value={platform}
                    onSelect={(key) => setPlatform(key)}
                    isDaylight={isDaylight}
                />
            </div>
            <Grid3DSlider
                key={platform}
                items={items}
                focusedIndex={focusedIndex}
                onFocusedIndexChange={setFocusedIndex}
                onSelect={(item) => {
                    const album = visible.find((entry) => entry.key === String(item.id));
                    if (!album) return;
                    // 没有平台专辑 id 的卡，albumId 位置传虚拟 id（`saved:<专辑名>`），
                    // provider 认这个前缀，直接回本机收藏的那几首。
                    const targetId = album.albumId ?? album.key.slice(album.platform.length + 1);
                    onOpenAlbum(album.platform as LxPublicPlatform, targetId, album.name, album.coverUrl);
                }}
                isInteractive={isInteractive}
                isLoading={noFavorites && hydrating}
                emptyMessage={noFavorites
                    ? '还没有收藏歌曲。在曲目上点心形收藏之后，它的专辑会出现在这里。'
                    : '这家还没有收藏的专辑'}
                isDaylight={isDaylight}
                hasFloatingPlayer={hasFloatingPlayer}
            />
        </div>
    );
};

export default LxAlbumWall;
