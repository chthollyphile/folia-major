import type { FoliumSourceCovers } from '@folia/folium';

// sources/bodian/client/bodianCovers.ts
// covers@1: how Kuwo's picture hosts (Bodian's covers and avatars) are asked for a size. Moved out of the
// host's built-in rules (src/utils/coverUrl.ts, the `kuwo` row); the host asks it while covers are drawn,
// so each member answers at once and null for a URL that is not Kuwo's.

// img1.kuwo.cn, and the same files on the img2.sycdn and img1.kwcdn hosts the search API hands out.
const KUWO_COVER_HOST_PATTERN = /^img\d*(?:\.(?:sycdn|kwcdn))?\.kuwo\.cn$/i;
const KUWO_COVER_PATH_PATTERN = /^(\/star\/(?:albumcover|starheads)\/)(\d+)(\/)/;
const KUWO_COVER_SMALL_SIZE = 240;
const KUWO_COVER_LARGE_SIZE = 800;
// The host's cap on a cover's size (COVER_MAX_SIZE in src/utils/coverUrl.ts): what a wall can decode.
const COVER_MAX_SIZE = 1200;

const isKuwoCoverUrl = (url: URL): boolean => (
    KUWO_COVER_HOST_PATTERN.test(url.hostname) && KUWO_COVER_PATH_PATTERN.test(url.pathname)
);

// Bodian metadata supplies 240px thumbnails and 800px artwork, including its albumPic120 field.
const withKuwoCoverSize = (url: URL, size: number): string => {
    url.pathname = url.pathname.replace(KUWO_COVER_PATH_PATTERN, `$1${size}$3`);
    return url.toString();
};

const parseSize = (value: string | null | undefined): number | null => {
    const size = Number((value ?? '').split(/[xy]/i)[0]);
    return Number.isFinite(size) && size > 0 ? size : null;
};

export const bodianCovers: FoliumSourceCovers = {
    // Every Kuwo picture host (KUWO_COVER_HOST_PATTERN narrows it further).
    hosts: ['*.kuwo.cn'],
    sized: (url, size) => {
        if (!isKuwoCoverUrl(url)) return null;
        // The shared smallest poster step is 256px; use the CDN's available 240px thumbnail.
        if (size <= 256) return withKuwoCoverSize(url, KUWO_COVER_SMALL_SIZE);
        if (size <= KUWO_COVER_LARGE_SIZE) return withKuwoCoverSize(url, KUWO_COVER_LARGE_SIZE);
        // Past 800 any size is served (1024 and 1200 measured), up to the cap a wall can decode.
        return withKuwoCoverSize(url, Math.min(size, COVER_MAX_SIZE));
    },
    identity: url => (isKuwoCoverUrl(url) ? `kuwo:${url.pathname.replace(KUWO_COVER_PATH_PATTERN, '$1*$3')}` : null),
    original: (url) => {
        if (!isKuwoCoverUrl(url)) return null;
        const originalSize = Number(KUWO_COVER_PATH_PATTERN.exec(url.pathname)?.[2]);
        return withKuwoCoverSize(url, Math.max(COVER_MAX_SIZE, originalSize));
    },
    requestedSize: url => (isKuwoCoverUrl(url) ? parseSize(KUWO_COVER_PATH_PATTERN.exec(url.pathname)?.[2]) : undefined),
};
