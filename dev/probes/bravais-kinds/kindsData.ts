import type { SongResult } from '../../../src/types';
import type { LibraryHomeCard } from '../../../src/library/core/home/homeModel.contract';
import type { BravaisItem } from '../../../src/library/suites/bravais/bravaisLayer';
import {
    projectCollectionTracks,
    projectHomeCardItem,
    type HomeCardLabels,
    type TrackDescription,
} from '../../../src/library/suites/bravais/bravaisProjection';

// dev/probes/bravais-kinds/kindsData.ts
// 磁贴种类区分探针（设计稿 §7.7）的合成数据：歌曲、专辑、歌单、歌手混排（首页 / 歌手页那种混合墙），外加几张
// 特殊集合（我喜欢的音乐、每日推荐、私人 FM）与一个文件夹。封面是画布生成的 JPEG（blob URL，同源，所以歌手头像能取色）；
// 歌手是程序画的人像。另有两位歌手专门测取色回退：一位没有头像，一位头像地址加载不出来。
// 卡片走 surface 用的同一个投影（projectHomeCardItem），曲目走 projectCollectionTracks。

const COVER_PX = 320;

const hsl = (hue: number, saturation: number, lightness: number, alpha = 1) => (
    `hsla(${((hue % 360) + 360) % 360},${saturation}%,${lightness}%,${alpha})`
);

const hashString = (value: string) => [...value].reduce((hash, character) => Math.imul(hash ^ character.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5);

const random = (seed: number) => {
    let state = seed >>> 0 || 1;
    return () => {
        state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
        return state / 4294967296;
    };
};

/** 一张假封面（专辑 / 歌单 / 歌曲）或一张假人像（歌手），JPEG blob URL。 */
const drawCover = (id: string, portrait: boolean): Promise<string> => new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = COVER_PX;
    canvas.height = COVER_PX;
    const g = canvas.getContext('2d')!;
    const next = random(hashString(id) + 7);
    const hue = Math.floor(next() * 360);
    const size = COVER_PX;
    if (portrait) {
        const backdrop = g.createRadialGradient(size * 0.5, size * 0.35, 10, size * 0.5, size * 0.5, size * 0.75);
        backdrop.addColorStop(0, hsl(hue, 38, 58));
        backdrop.addColorStop(1, hsl(hue + 20, 40, 14));
        g.fillStyle = backdrop;
        g.fillRect(0, 0, size, size);
        for (let index = 0; index < 7; index += 1) {
            g.fillStyle = hsl(hue + 40 + next() * 60, 80, 72, 0.35);
            g.beginPath();
            g.arc(next() * size, next() * size * 0.6, 8 + next() * 22, 0, Math.PI * 2);
            g.fill();
        }
        g.fillStyle = hsl(hue + 180, 18, 16);
        g.beginPath();
        g.ellipse(size * 0.5, size * 1.04, size * 0.4, size * 0.3, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = hsl(25 + next() * 10, 30, 48);
        g.fillRect(size * 0.455, size * 0.6, size * 0.09, size * 0.14);
        g.beginPath();
        g.ellipse(size * 0.5, size * 0.5, size * 0.13, size * 0.165, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = hsl(20, 25, 10);
        g.beginPath();
        g.ellipse(size * 0.5, size * 0.42, size * 0.155, size * 0.13, 0, Math.PI, 0);
        g.fill();
        g.fillRect(size * 0.345, size * 0.4, size * 0.04, size * 0.2);
        g.fillRect(size * 0.615, size * 0.4, size * 0.04, size * 0.2);
    } else {
        const style = hashString(id) % 3;
        if (style === 0) {
            const gradient = g.createLinearGradient(0, 0, size, size);
            gradient.addColorStop(0, hsl(hue, 62, 56));
            gradient.addColorStop(1, hsl(hue + 52, 58, 16));
            g.fillStyle = gradient;
            g.fillRect(0, 0, size, size);
            g.fillStyle = hsl(hue + 180, 72, 62, 0.85);
            g.beginPath();
            g.arc(size * (0.3 + next() * 0.4), size * (0.3 + next() * 0.4), size * (0.18 + next() * 0.14), 0, Math.PI * 2);
            g.fill();
        } else if (style === 1) {
            let y = 0;
            while (y < size) {
                const band = 20 + next() * 80;
                g.fillStyle = hsl(hue + next() * 50 - 25, 40 + next() * 40, 20 + next() * 55);
                g.fillRect(0, y, size, band);
                y += band;
            }
        } else {
            g.fillStyle = hsl(hue, 18, 86);
            g.fillRect(0, 0, size, size);
            g.fillStyle = hsl(hue + 180, 30, 12);
            g.fillRect(size * (0.15 + next() * 0.2), size * (0.2 + next() * 0.2), size * 0.4, size * 0.4);
            g.fillStyle = hsl(hue + 10, 75, 48);
            g.fillRect(size * 0.3, size * 0.62, size * 0.6, 20);
        }
    }
    canvas.toBlob(blob => resolve(blob ? URL.createObjectURL(blob) : ''), 'image/jpeg', 0.86);
});

const TRACKS: [string, string][] = [
    ['夜に駆ける', 'YOASOBI'], ['カタオモイ', 'Aimer'], ['Lemon', '米津玄師'], ['残響散歌', 'Aimer'], ['群青', 'YOASOBI'],
    ['晴天', '周杰伦'], ['稻香', '周杰伦'], ['KICK BACK', '米津玄師'], ['春泥棒', 'ヨルシカ'], ['ただ君に晴れ', 'ヨルシカ'],
    ['阿楚姑娘', '许巍'], ['蓝莲花', '许巍'], ['Pretender', 'Official髭男dism'], ['Subtitle', 'Official髭男dism'],
    ['水星', 'tofubeats'], ['白日', 'King Gnu'], ['逆夢', 'King Gnu'], ['花に亡霊', 'ヨルシカ'], ['勇者', 'YOASOBI'],
    ['平凡之路', '朴树'], ['那些花儿', '朴树'], ['Plastic Love', '竹内まりや'], ['真夜中のドア', '松原みき'], ['愛にできることはまだあるかい', 'RADWIMPS'],
];
const ALBUMS: [string, string, number][] = [
    ['THE BOOK', 'YOASOBI · 2021', 12], ['Walpurgis', 'Aimer · 2021', 14], ['STRAY SHEEP', '米津玄師 · 2020', 15],
    ['盗作', 'ヨルシカ · 2020', 14], ['CEREMONY', 'King Gnu · 2020', 13], ['叶惠美', '周杰伦 · 2003', 11],
    ['时光·漫步', '许巍 · 2002', 10], ['我去2000年', '朴树 · 1999', 10], ['Editorial', 'Official髭男dism · 2021', 14],
    ['VARIETY', '竹内まりや · 1984', 11], ['人間開花', 'RADWIMPS · 2016', 15], ['LOST CORNER', '米津玄師 · 2024', 20],
];
const ARTISTS = ['YOASOBI', 'Aimer', '米津玄師', 'ヨルシカ', '周杰伦', '许巍', 'King Gnu', '朴树'];
const PLAYLISTS: [string, number][] = [['深夜通勤', 48], ['雨の日に', 31], ['写代码', 112], ['City Pop 入门', 60], ['周末下午', 27], ['跑步 170 BPM', 44]];

/** 测取色回退的两位歌手：没有头像；头像地址加载不出来（同源 404）。 */
export const KINDS_ARTIST_NO_COVER = 'card:artist:no-cover';
export const KINDS_ARTIST_BROKEN_COVER = 'card:artist:broken-cover';
export const KINDS_BROKEN_COVER_URL = '/__bravais_kinds_missing__/portrait.jpg';
/** 默认正在播放的那首（第 2 首）。 */
export const KINDS_DEFAULT_CURRENT = 'kinds-track-1';

export type KindsCovers = { byId: ReadonlyMap<string, string> };

/** 整页只画一次。 */
let coversPromise: Promise<KindsCovers> | null = null;
export const loadKindsCovers = (): Promise<KindsCovers> => {
    coversPromise ??= (async () => {
        const entries: [string, Promise<string>][] = [
            ...TRACKS.map((_, index) => [`track-${index}`, drawCover(`t${index}`, false)] as [string, Promise<string>]),
            ...ALBUMS.map((_, index) => [`album-${index}`, drawCover(`a${index}`, false)] as [string, Promise<string>]),
            ...ARTISTS.map((_, index) => [`artist-${index}`, drawCover(`r${index}`, true)] as [string, Promise<string>]),
            ...PLAYLISTS.map((_, index) => [`playlist-${index}`, drawCover(`p${index}`, false)] as [string, Promise<string>]),
            ...['liked', 'daily', 'fm', 'folder'].map(id => [id, drawCover(id, false)] as [string, Promise<string>]),
        ];
        const urls = await Promise.all(entries.map(([, url]) => url));
        return { byId: new Map(entries.map(([id], index) => [id, urls[index]!])) };
    })();
    return coversPromise;
};

/**
 * 混排的条目：歌曲约一半，其余是专辑、歌手、歌单与几张特殊卡，按确定的乱序排开（无限拼贴会循环，墙上同一项会出现
 * 多次）。labels 是已翻译的种类与「N 首」。mix = 'artists' 时只有歌手（开销对比用）。
 */
export const buildKindsItems = (
    covers: KindsCovers,
    labels: HomeCardLabels,
    mix: 'mixed' | 'artists' = 'mixed',
    /** 再加一位歌手，头像是这个地址（用例拿它测「图片能显示、但没有 CORS 头读不了像素」的回退）。 */
    extraArtistCover?: string,
): BravaisItem[] => {
    const cover = (id: string) => covers.byId.get(id);
    const describe = (track: SongResult): TrackDescription => ({
        artists: track.artists.map(artist => artist.name),
        album: track.album?.name ?? '',
        coverUrl: cover(`track-${Number(track.id)}`),
        durationMs: 200_000 + Number(track.id) * 3000,
        playbackKey: `kinds:${track.id}`,
        unavailable: false,
    });
    const songs = TRACKS.map(([name, artist], index) => ({
        id: index,
        name,
        artists: [{ id: artist, name: artist }],
        album: { id: index, name: '' },
        durationMs: 200_000,
    }) as unknown as SongResult);
    const tracks = projectCollectionTracks(songs, index => `kinds-track-${index}`, describe, '?')
        .map(item => ({ ...item, badge: labels.kindLabel('track') }));

    const card = (extra: LibraryHomeCard, options: { direct?: boolean } = {}) => projectHomeCardItem(extra, labels, options);
    const albums = ALBUMS.map(([name, description, trackCount], index) => card({ id: `a${index}`, type: 'album', name, description, trackCount, coverUrl: cover(`album-${index}`) }));
    const artists = ARTISTS.map((name, index) => card({ id: `r${index}`, type: 'artist', name, description: 'Artist', trackCount: 20 + index, coverUrl: cover(`artist-${index}`) }));
    artists.push(
        card({ id: 'no-cover', type: 'artist', name: '无头像歌手', trackCount: 3 }),
        card({ id: 'broken-cover', type: 'artist', name: '坏头像歌手', trackCount: 4, coverUrl: KINDS_BROKEN_COVER_URL }),
    );
    if (extraArtistCover) artists.push(card({ id: 'extra-cover', type: 'artist', name: '跨源头像歌手', trackCount: 5, coverUrl: extraArtistCover }));
    const playlists = PLAYLISTS.map(([name, trackCount], index) => card({ id: `p${index}`, type: 'playlist', name, description: '我的歌单', trackCount, coverUrl: cover(`playlist-${index}`) }));
    // 曲目数未知的歌单：书脊上不写字。
    playlists.push(card({ id: 'p-unknown', type: 'playlist', name: '曲目数未知', description: '我的歌单', coverUrl: cover('playlist-0') }));
    const specials: BravaisItem[] = [
        { ...card({ id: 'liked', type: 'playlist', name: '我喜欢的音乐', trackCount: 321, coverUrl: cover('liked') }), special: 'liked' },
        { ...card({ id: 'daily_recommendations', type: 'daily_recommendations', name: '每日推荐', description: '根据你的口味生成', trackCount: 30, coverUrl: cover('daily') }), special: 'daily' },
        { ...card({ id: 'personal_fm', type: 'radio', name: '私人 FM', description: '私人 FM', coverUrl: cover('fm') }, { direct: true }), special: 'personal-fm', direct: true },
        card({ id: 'folder-Music', type: 'folder', name: 'Music', description: '文件夹', trackCount: 42, coverUrl: cover('folder') }),
    ];

    // 性能对比的最坏情况：整面墙都是歌手（双色调，含两位取色回退的），循环铺满。
    if (mix === 'artists') return artists;

    // 确定的乱序：歌曲与其余各种交错。前几位放各种类各一张，离缝最近的一圈就能看到全部样子。
    const head = [tracks[0]!, albums[0]!, artists[0]!, playlists[0]!, tracks[1]!, specials[0]!, artists[1]!, albums[1]!, specials[1]!, tracks[2]!, specials[2]!, specials[3]!];
    const used = new Set(head.map(item => item.key));
    const rest = [...tracks, ...albums, ...artists, ...playlists, ...specials].filter(item => !used.has(item.key));
    rest.sort((a, b) => hashString(a.key) - hashString(b.key));
    return [...head, ...rest];
};
