import type { FoliumSourceCovers } from '@folia/folium';

// sources/kugou/core/kugouCovers.ts
// covers@1：酷狗的封面怎么按尺寸要。从宿主的内置规则（src/utils/coverUrl.ts 的 `kugou` 那一行）搬来，和以前一样：
// 歌曲封面在 /stdmusic/<尺寸>/，歌单封面在 /soft/collection/<尺寸>/，两种都能换成任意尺寸；没有「原图」的写法。

const KUGOU_COVER_HOST_PATTERN = /(?:^|\.)(?:kugou\.com|kgimg\.com)$/i;
const KUGOU_COVER_PATH_PATTERN = /(\/(?:stdmusic|soft\/collection)\/)(\d+)(\/)/;

/** The picture hosts: KuGou's own and its image CDN (the web build fetches them through the lyric proxy too). */
export const KUGOU_COVER_HOSTS: readonly string[] = ['kugou.com', '*.kugou.com', 'kgimg.com', '*.kgimg.com'];

const isKugouCoverUrl = (url: URL): boolean => (
    KUGOU_COVER_HOST_PATTERN.test(url.hostname) && KUGOU_COVER_PATH_PATTERN.test(url.pathname)
);

const withKugouCoverSize = (url: URL, size: number): string => {
    url.pathname = url.pathname.replace(KUGOU_COVER_PATH_PATTERN, `$1${size}$3`);
    return url.toString();
};

const parseSize = (value: string | null | undefined): number | null => {
    const size = Number((value ?? '').split(/[xy]/i)[0]);
    return Number.isFinite(size) && size > 0 ? size : null;
};

/** `url` at `size` where it is a KuGou cover; anything else as it is (a cover the normalizer reads, sized once). */
export const sizedKugouCover = (url: string, size: number): string => {
    try {
        const parsed = new URL(url);
        return isKugouCoverUrl(parsed) ? withKugouCoverSize(parsed, size) : url;
    } catch {
        return url;
    }
};

export const kugouCovers: FoliumSourceCovers = {
    hosts: KUGOU_COVER_HOSTS,
    sized: (url, size) => (isKugouCoverUrl(url) ? withKugouCoverSize(url, size) : null),
    identity: url => (isKugouCoverUrl(url) ? `kugou:${url.pathname.replace(KUGOU_COVER_PATH_PATTERN, '$1*$3')}` : null),
    original: () => null,
    requestedSize: url => (isKugouCoverUrl(url) ? parseSize(KUGOU_COVER_PATH_PATTERN.exec(url.pathname)?.[2]) : undefined),
};
