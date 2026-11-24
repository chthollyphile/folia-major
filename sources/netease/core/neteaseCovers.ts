import type { FoliumSourceCovers } from '@folia/folium';

// sources/netease/core/neteaseCovers.ts
// covers@1：网易云的封面怎么按尺寸要。从宿主的内置规则（src/utils/coverUrl.ts 的 `netease` 那一行）搬来，和以前一样：
// 126.net 下的图片在查询参数 `param=<宽>y<高>` 里要尺寸，去掉它就是原图；同一张图在 p1、p2… 几个主机上，只认路径。
// 宿主那一行还有一个 sizedText（不是合法 URL 的文字也补尺寸），covers@1 没有这个成员：网易给的封面地址都是完整的 URL。

const NETEASE_COVER_HOST_PATTERN = /^p\d+\.music\.126\.net$/i;

/** The picture hosts covers@1 knows: every host under 126.net, as the host's rule took them. */
export const NETEASE_COVER_HOSTS: readonly string[] = ['*.126.net'];

const parseSize = (value: string | null | undefined): number | null => {
    const size = Number((value ?? '').split(/[xy]/i)[0]);
    return Number.isFinite(size) && size > 0 ? size : null;
};

const isNeteasePicture = (url: URL): boolean => url.hostname.endsWith('.126.net');

export const neteaseCovers: FoliumSourceCovers = {
    hosts: NETEASE_COVER_HOSTS,
    sized: (url, size) => (isNeteasePicture(url) ? `${url.origin}${url.pathname}?param=${size}y${size}` : null),
    identity: url => (NETEASE_COVER_HOST_PATTERN.test(url.hostname) ? `netease:${url.pathname}` : null),
    original: (url) => {
        if (!isNeteasePicture(url) || !url.searchParams.has('param')) return null;
        url.searchParams.delete('param');
        return url.toString();
    },
    requestedSize: url => (isNeteasePicture(url) ? parseSize(url.searchParams.get('param')) : undefined),
};
