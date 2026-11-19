// sources/kugou/core/kugouRequests.ts
// 不经 KuGouMusicApi 的两个请求怎么拼：匿名搜索（酷狗安卓客户端的签名搜索）和旧的手机版播放信息接口。core 的两条
// transport 和 main 入口都用它：桌面版由 main 入口拼好地址自己去问（api.net.fetch，没有跨域，也不开一个任意地址的中转），
// 网页版经歌词代理去问。纯函数，md5 由调用方给（main 用 node:crypto，网页版用 blueimp-md5）。

const ANONYMOUS_SEARCH_SALT = 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA';
const ANONYMOUS_SEARCH_URL = 'http://complexsearch.kugou.com/v2/search/song';
const LEGACY_PLAY_INFO_URL = 'https://m.kugou.com/app/i/getSongInfo.php';

/** A request to make: the address and the headers it goes with. */
export interface KugouPlainRequest {
    url: string;
    headers: Record<string, string>;
}

/** What main answers for one of these requests: KuGou's status and body text, or that it could not be asked. */
export type KugouPlainAnswer = { status: number; bodyText: string } | { unreachable: true; message: string };

/** Reproduces KuGou's anonymous Android search signature used before account-backed provider search. */
export const buildKugouAnonymousSearch = (
    keyword: string,
    page: number,
    pagesize: number,
    md5: (text: string) => string,
    now: number = Date.now(),
): KugouPlainRequest => {
    const clientTimeSec = Math.floor(now / 1000);
    const mid = md5(String(now));
    const params: Record<string, string | number> = {
        sorttype: '0',
        keyword,
        pagesize,
        page,
        userid: '0',
        appid: '3116',
        token: '',
        clienttime: clientTimeSec,
        iscorrection: '1',
        uuid: '-',
        mid,
        dfid: '-',
        clientver: '11070',
        platform: 'AndroidFilter',
    };
    const signatureSource = Object.keys(params)
        .sort()
        .map(key => `${key}=${params[key]}`)
        .join('');
    params.signature = md5(`${ANONYMOUS_SEARCH_SALT}${signatureSource}${ANONYMOUS_SEARCH_SALT}`);

    const targetUrl = new URL(ANONYMOUS_SEARCH_URL);
    Object.entries(params).forEach(([key, value]) => { targetUrl.searchParams.set(key, String(value)); });
    return {
        url: targetUrl.toString(),
        headers: {
            'User-Agent': 'Android14-1070-11070-201-0-SearchSong-wifi',
            'KG-Rec': '1',
            'KG-RC': '1',
            'KG-CLIENTTIMEMS': String(now),
            mid,
            'x-router': 'complexsearch.kugou.com',
        },
    };
};

/**
 * Legacy mobile play-info fallback used when the current /song/url endpoint refuses a hash. It calls KuGou's old
 * public mobile endpoint and works without KuGouMusicApi.
 */
export const buildKugouLegacyPlayInfo = (hash: string): KugouPlainRequest => {
    const targetUrl = new URL(LEGACY_PLAY_INFO_URL);
    targetUrl.searchParams.set('cmd', 'playInfo');
    targetUrl.searchParams.set('hash', hash);
    return {
        url: targetUrl.toString(),
        headers: {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36',
        },
    };
};

/** A track hash as main takes it for the legacy endpoint: letters and digits only (main builds no other address). */
export const isKugouHash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-zA-Z]{1,64}$/.test(value);
