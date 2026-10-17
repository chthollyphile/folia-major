// electron/soda/sodaApiBridge.cjs
//
// 汽水音乐（Soda / Luna）的匿名接口，全部在主进程发出。api.qishui.com 只要请求带 Origin 头就答 403，
// 渲染进程里的 fetch 一定失败，所以这一层是必须的，不是可选的优化。
//
// 只做转发的活：拿原始 JSON / 解析分享页的 _ROUTER_DATA，字段怎么读由 renderer 侧的 sodaNormalize.ts 决定。
// 没有登录：汽水的登录接口要 X-Helios / X-Medusa 签名和设备注册，不在这一层。

const API_HOST = 'https://api.qishui.com';
const SHARE_HOST = 'https://music.douyin.com';
const UA_LUNA = 'LunaPC/3.4.0(388267242)';
const UA_WEB = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

// 搜索接口要的一整套安卓设备参数，被限流时换一组。
const DEVICE = {
    device_platform: 'android', os: 'android', ssmix: 'a',
    aid: '386088', app_name: 'luna', channel: 'xiaomi_8478_64',
    version_code: '100198030', version_name: '19.8.0',
    manifest_version_code: '100198030', update_version_code: '100198030',
    resolution: '1080*1920', dpi: '480',
    device_type: 'ABR-AL80', device_brand: 'HUAWEI', device_model: 'ABR-AL80',
    os_api: '35', os_version: '15', ac: 'wifi', language: 'zh',
    package: 'com.luna.music', is_car_play: '0', is_teen_mode: '0',
    need_personal_recommend: '1', sim_region: 'cn', tz_name: 'Asia/Shanghai', tz_offset: '28800',
    iid: '2204957404569386', device_id: '2204957404565290',
};

const OPERATIONS = ['search', 'playlist_search', 'playlist_detail', 'share'];

const query = (params) => new URLSearchParams(Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
)).toString();

/** 分享页把数据放在 `_ROUTER_DATA = {...};` 里，按大括号配对取，跳过字符串内的括号。 */
function readRouterData(html) {
    const marker = html.indexOf('_ROUTER_DATA');
    if (marker < 0) return null;
    const start = html.indexOf('{', marker);
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < html.length; i += 1) {
        const ch = html[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '{') depth += 1;
        else if (ch === '}' && --depth === 0) {
            try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
        }
    }
    return null;
}

function createSodaApiBridge({ requestFactory = globalThis.fetch, timeoutMs = 20000 } = {}) {
    const call = async (url, headers) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await requestFactory(url, { headers, signal: controller.signal });
            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}`);
                error.status = response.status;
                throw error;
            }
            return response;
        } finally {
            clearTimeout(timer);
        }
    };

    const getJson = async (url, headers) => (await call(url, headers)).json();

    const search = async (path, { query: keyword, cursor = 0, count = 20 }) => {
        if (!keyword) return { group: null };
        const url = `${API_HOST}${path}?${query({ ...DEVICE, q: keyword, cursor, count })}`;
        const body = await getJson(url, { 'User-Agent': UA_LUNA });
        return { group: body?.result_groups?.[0] ?? null };
    };

    const handlers = {
        search: (params) => search('/luna/search/track', params),
        playlist_search: (params) => search('/luna/search/playlist', params),
        async playlist_detail({ playlistId, cursor = 0, count = 20 }) {
            if (!playlistId) return { playlist: null, tracks: [], nextCursor: null };
            const url = `${API_HOST}/luna/pc/playlist/detail?${query({
                playlist_id: playlistId,
                cursor,
                cnt: count,
                aid: '386088',
                device_platform: 'web',
                channel: 'pc_web',
            })}`;
            const body = await getJson(url, { 'User-Agent': UA_LUNA });
            return {
                playlist: body?.playlist ?? null,
                tracks: Array.isArray(body?.media_resources) ? body.media_resources : [],
                nextCursor: body?.next_cursor ?? null,
            };
        },
        async share({ trackId }) {
            if (!trackId) return { track: null };
            const response = await call(`${SHARE_HOST}/qishui/share/track?track_id=${encodeURIComponent(trackId)}`, { 'User-Agent': UA_WEB });
            const data = readRouterData(await response.text());
            return { track: data?.loaderData?.track_page?.audioWithLyricsOption ?? null };
        },
    };

    return {
        async request(operation, params = {}) {
            if (!OPERATIONS.includes(operation)) {
                return { ok: false, error: { code: 'unsupported', message: 'Unsupported Soda operation' } };
            }
            try {
                return { ok: true, data: await handlers[operation](params) };
            } catch (error) {
                const code = typeof error?.status === 'number' && error.status >= 500 ? 'unavailable' : 'invalid-response';
                return { ok: false, error: { code, message: String(error?.message || 'Soda request failed') } };
            }
        },
    };
}

module.exports = { createSodaApiBridge, readRouterData, OPERATIONS };
