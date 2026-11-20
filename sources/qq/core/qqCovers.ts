import type { FoliumSourceCovers } from '@folia/folium';

// sources/qq/core/qqCovers.ts
// covers@1：QQ 音乐的封面怎么按尺寸要。从宿主的内置规则（src/utils/coverUrl.ts 的两行 `qq`）搬来，和以前一样：
// - 专辑封面与歌手头像在 y.gtimg.cn（也有 y.qq.com）的 photo_new 下，路径里的 `T00[12]R<尺寸>x<尺寸>M000` 是尺寸，
//   去掉 `R…` 就是原图；
// - 歌单封面在 qpic.y.qq.com，路径以尺寸结尾，只有 150、300、600 三档（600 就到原图了，实测 564）。

const QQ_COVER_HOSTNAMES = new Set(['y.gtimg.cn', 'y.qq.com']);
const QQ_COVER_PATH_PATTERN = /(T00[12])(?:R(\d+)x\d+)?(M000)/;
const QQ_COVER_SMALL_SIZE = 300;
const QQ_COVER_LARGE_SIZE = 800;
const QQ_COVER_XL_SIZE = 1200;
// Playlist covers on qpic.y.qq.com end in their size and come at 150, 300 and 600 (600 stops at the
// original, 564 measured); 800 answers 400 and 0 a 120px placeholder.
const QQ_PLAYLIST_COVER_HOSTNAME = 'qpic.y.qq.com';
const QQ_PLAYLIST_COVER_PATH_PATTERN = /^(\/music_cover\/[^/]+\/)(\d+)$/;
const QQ_PLAYLIST_COVER_SIZES = [150, 300, 600] as const;

/** The picture hosts covers@1 knows. */
export const QQ_COVER_HOSTS: readonly string[] = ['y.gtimg.cn', 'y.qq.com', QQ_PLAYLIST_COVER_HOSTNAME];

/** The picture hosts the web build fetches through the lyric proxy (they send no CORS headers): the album covers'. */
export const QQ_PROXIED_COVER_HOSTS: readonly string[] = ['y.gtimg.cn'];

const isQqCoverUrl = (url: URL): boolean => (
    QQ_COVER_HOSTNAMES.has(url.hostname) && QQ_COVER_PATH_PATTERN.test(url.pathname)
);

const isQqPlaylistCoverUrl = (url: URL): boolean => (
    url.hostname === QQ_PLAYLIST_COVER_HOSTNAME && QQ_PLAYLIST_COVER_PATH_PATTERN.test(url.pathname)
);

const withQqPlaylistCoverSize = (url: URL, size: number): string => {
    const bucket = QQ_PLAYLIST_COVER_SIZES.find(candidate => candidate >= size)
        ?? QQ_PLAYLIST_COVER_SIZES[QQ_PLAYLIST_COVER_SIZES.length - 1];
    url.pathname = url.pathname.replace(QQ_PLAYLIST_COVER_PATH_PATTERN, `$1${bucket}`);
    return url.toString();
};

const withQqCoverSize = (url: URL, size: number | null): string => {
    url.pathname = url.pathname.replace(
        QQ_COVER_PATH_PATTERN,
        size ? `$1R${size}x${size}$3` : '$1$3',
    );
    return url.toString();
};

const parseSize = (value: string | null | undefined): number | null => {
    const size = Number(String(value ?? '').split(/[xy]/i)[0]);
    return Number.isFinite(size) && size > 0 ? size : null;
};

/**
 * The original picture of an album cover or a singer's picture (what the normalizer keeps, as the host's provider kept
 * it); any other address as it is, trimmed.
 */
export const originalQqCover = (value: string): string => {
    const text = value.trim();
    if (!text) return '';
    try {
        const url = new URL(text);
        return isQqCoverUrl(url) ? withQqCoverSize(url, null) : text;
    } catch {
        return text;
    }
};

export const qqCovers: FoliumSourceCovers = {
    hosts: QQ_COVER_HOSTS,
    sized: (url, size) => {
        if (isQqPlaylistCoverUrl(url)) return withQqPlaylistCoverSize(url, size);
        if (!isQqCoverUrl(url)) return null;
        // Past 800 the 1200 bucket answers, never the original: album and singer originals run to
        // 3000×3000, and on the wall Chromium decodes one that big again for every tile it
        // rasters (150–300 ms frames while panning). R1200 exists for album (T002) and singer
        // (T001) images alike and comes back at the original's size when that is smaller;
        // R1000 and R1024 answer 404. A caller that wants the original asks for it (`original`).
        const qqCoverSize = size <= QQ_COVER_SMALL_SIZE
            ? QQ_COVER_SMALL_SIZE
            : size <= QQ_COVER_LARGE_SIZE ? QQ_COVER_LARGE_SIZE : QQ_COVER_XL_SIZE;
        return withQqCoverSize(url, qqCoverSize);
    },
    identity: (url) => {
        if (isQqCoverUrl(url)) return `qq:${url.pathname.replace(QQ_COVER_PATH_PATTERN, '$1$3')}`;
        if (isQqPlaylistCoverUrl(url)) return `qq:${url.pathname.replace(QQ_PLAYLIST_COVER_PATH_PATTERN, '$1*')}`;
        return null;
    },
    original: url => (isQqCoverUrl(url) ? withQqCoverSize(url, null) : null),
    requestedSize: (url) => {
        if (isQqCoverUrl(url)) return parseSize(QQ_COVER_PATH_PATTERN.exec(url.pathname)?.[2]);
        if (isQqPlaylistCoverUrl(url)) return parseSize(QQ_PLAYLIST_COVER_PATH_PATTERN.exec(url.pathname)?.[2]);
        return undefined;
    },
};
