// test/manual/fakeSourceNetwork/qishui.mjs
// 汽水的假应答（fakeSourceNetwork.mjs 的路由表）。只给桌面实测用：证明的是管道（模组注册、rpc、会话存储、媒体规则、界面
// 流程），证明不了真实接口的兼容性。
//
// 形状的依据：qishui-music-api@0.2.2 读的路径与字段——client.cjs 的 { err_no, data } 包装、client_token（顶层）、
// open.douyin.com + /api/luna/v1/platform 前缀；auth.cjs 的 oauth/get_qrcode（data.token、data.qrcode）、oauth/check_qrcode
// （data.status：new / scanned / confirmed，data.code）、access/code/get（data.access_code、open_id、expires_time）、
// passport/open/get_access_ticket（响应头 bd-ticket-guard-server-data：base64 的 { ticket, ts_sign, client_cert }）、
// /me/info/ 的 my_info；catalog.cjs 的 /search/（result_groups[].id = tracks / playlists，data[].entity.<type>）、
// /media/mget/（media_list[].media_id + track_entity）、/playlist/detail/（playlist、media_entities、has_more）、/me/playlist/、
// /me/collection/mixed/、/artist/detail/、/artist/tracks/；feed.cjs 的 /feed/mode/（feed_mode_block）与 /feed/song-tab/
// （items）；library.cjs 的 /me/recent-played/、/media/mcheck/、收藏与歌单改动；playback.cjs 的
// player_info.<full|preview>.video_model_info.video_model（video_list[].main_url，不加密）。歌曲记录照
// test/unit/qishui/fixtures.ts 的样本。音频是自己生成的 30 秒音调，封面是单色 PNG，都不带 CORS 头。
//
// 控制（GET http://127.0.0.1:<端口>/__control/<动作>）：scan（手机上扫码并确认）、state（看红心、自建歌单的当前状态）。

import { ranged, solidPng, toneWav } from './fakeMedia.mjs';

const OPEN = 'open.douyin.com';
const QISHUI = 'open.qishui.com';
const PASSPORT = 'open-client.douyin.com';
const IMAGES = 'p3-luna.douyinpic.com';
// 包认的媒体主机之一（client.cjs 的 HOSTS 有 douyinvod.com）。
const AUDIO = 'v3-luna.douyinvod.com';
const PREFIX = '/api/luna/v1/platform';

const USER = { id: '70001', nickname: '假的汽水用户', avatar_url: `https://${IMAGES}/img/fake/avatar.png~tplv-fake-image.image`, is_vip: false };
const coverOf = (name) => ({ uri: `fake/${name}`, urls: [`https://${IMAGES}/img/`], template_prefix: 'tplv-fake' });

// fixtures.ts 的 track 样本的形状。
const track = (id, name) => ({
    base_info: { id, name, duration_ms: 30000 },
    related_info: { artist_links: [{ id: '42', name: '假歌手' }], album_link: { id: '43', name: '假专辑' } },
    display_info: {
        cover_url: coverOf('album'),
        lyric_info: {
            lyric_entity: { type: 'lrc', content: '[00:01.00]这是假的汽水歌词\n[00:05.00]只用来测管道\n[00:09.00]翻译轨按时间配上\n' },
            lang_translations: { 'zh-CN': { type: 'lrc', content: '[00:01.00]Fake Qishui lyrics\n[00:05.00]Only for the pipeline\n[00:09.00]Matched by time\n' } },
        },
    },
});
const TRACKS = [
    track('7600000000000000001', '晴天（假应答）'),
    track('7600000000000000002', '稻香（假应答）'),
    track('7600000000000000003', '七里香（假应答）'),
];
const byId = new Map(TRACKS.map((item) => [item.base_info.id, item]));

const playlist = (id, title, { type = 0, ownerId = USER.id, count = 0 } = {}) => ({
    base_info: { id, title, owner_id: ownerId, type },
    display_info: { url_cover: coverOf('playlist') },
    resource_cnt: { track_cnt: count },
});

// 登录后（请求的 common_params 带着 user_id）给整首；未登录只给试听。
const withPlayer = (item, signedIn) => {
    const model = JSON.stringify({ video_list: [{ main_url: `https://${AUDIO}/fake/${item.base_info.id}/tone.wav`, video_meta: { quality: 'medium', bitrate: 128000 } }] });
    const info = { video_model_info: { video_model: model, expire_at: Math.floor(Date.now() / 1000) + 3600 } };
    return { ...item, player_info: signedIn ? { full: info } : { preview: { ...info, duration: { start_ms: 0 } } } };
};

const ok = (data) => ({ body: { err_no: 0, data } });

export default {
    hosts: [OPEN, QISHUI, PASSPORT, IMAGES, AUDIO],

    createState: () => ({
        qr: new Map(),
        liked: ['7600000000000000001'],
        owned: ['7600000000000000002'],
        tone: toneWav(30),
        png: solidPng(64, [25, 165, 140]),
        tickets: 0,
    }),

    control: {
        scan: (state) => {
            for (const key of state.qr.keys()) state.qr.set(key, 'confirmed');
            return { scanned: [...state.qr.keys()] };
        },
        state: (state) => ({ liked: state.liked, owned: state.owned, tickets: state.tickets }),
    },

    handle({ host, url, method, body, headers, state }) {
        const p = url.pathname;
        if (host === AUDIO && p.endsWith('/tone.wav')) return ranged({ headers }, state.tone, 'audio/wav');
        if (host === IMAGES) return { headers: { 'content-type': 'image/png' }, body: state.png };

        // 登录（auth.cjs）
        if (host === OPEN && p === '/oauth/get_qrcode/') {
            const token = `fake-qr-${state.qr.size + 1}`;
            state.qr.set(token, 'new');
            return ok({ token, qrcode: state.png.toString('base64') });
        }
        if (host === OPEN && p === '/oauth/check_qrcode/') {
            const status = state.qr.get(url.searchParams.get('token')) ?? 'expired';
            return ok({ status, ...(status === 'confirmed' ? { code: 'fake-auth-code' } : {}) });
        }
        if (host === QISHUI && p === `${PREFIX}/client/token/get/`) return { body: { err_no: 0, client_token: 'fake-client-token' } };
        if (host === QISHUI && (p === `${PREFIX}/access/code/get/` || p === `${PREFIX}/access/code/refresh/`)) {
            return ok({ access_code: 'fake-access-code', open_id: 'fake-open-id', expires_time: 86400 });
        }
        if (host === PASSPORT && p === '/passport/open/get_access_ticket/' && method === 'POST') {
            state.tickets += 1;
            const server = Buffer.from(JSON.stringify({ ticket: `fake-ticket-${state.tickets}`, ts_sign: 'fake-ts-sign', client_cert: 'ZmFrZS1jZXJ0' })).toString('base64');
            return { headers: { 'bd-ticket-guard-server-data': server }, body: { err_no: 0, data: {} } };
        }
        if (host !== OPEN || !p.startsWith(PREFIX)) return null;
        const path = p.slice(PREFIX.length);
        const json = body.length ? JSON.parse(body.toString('utf8')) : {};
        // 账号请求（曲库、/me/info/）带票据；目录读走公共 client token，账号只在 common_params.user_id 里。
        const ticketed = String(headers['access-token'] ?? '').startsWith('fake-ticket-');
        const signedIn = ticketed || Boolean(json.common_params?.user_id);

        if (path === '/me/info/') return ticketed ? ok({ my_info: USER }) : { body: { err_no: 28001003 } };

        // 目录（catalog.cjs）
        if (path === '/search/') {
            const type = json.search_type;
            const data = type === 'playlist'
                ? [{ entity: { playlist: playlist('8100', '搜到的歌单（假应答）', { ownerId: '99', count: 3 }) } }]
                : TRACKS.map((item) => ({ entity: { track: item } }));
            return ok({ result_groups: [{ id: `${type}s`, data, has_more: false }] });
        }
        if (path === '/media/mget/') {
            const media = (json.media_list ?? []).flatMap(({ id }) => (byId.has(id) ? [{ media_id: id, track_entity: withPlayer(byId.get(id), signedIn) }] : []));
            return ok({ media_list: media });
        }
        if (path === '/media/mcheck/') {
            return ok({ media_status_list: (json.media_list ?? []).map(({ id }) => ({ id, risk_info: { risk_result: 0, status: 0 } })) });
        }
        if (path === '/playlist/detail/') {
            const id = json.playlist_id;
            const ids = id === '8001' ? state.liked : id === '8002' ? state.owned : TRACKS.map((item) => item.base_info.id);
            const meta = id === '8001' ? playlist('8001', '我喜欢的音乐', { type: 1, count: ids.length })
                : id === '8002' ? playlist('8002', '假的自建歌单', { count: ids.length })
                    : playlist(id, '歌单（假应答）', { ownerId: '99', count: ids.length });
            return ok({ playlist: meta, media_entities: ids.map((songId) => ({ track_entity: byId.get(songId) })), has_more: false, next_cursor: '' });
        }
        if (path === '/artist/detail/') return ok({ artist_info: { base_info: { id: '42', name: '假歌手', url_avatar: coverOf('artist') } } });
        if (path === '/artist/tracks/') return ok({ tracks: TRACKS });

        // 曲库（catalog.cjs、library.cjs），要登录
        if (path === '/me/playlist/') {
            if (!ticketed) return { body: { err_no: 28001003 } };
            return ok({ playlists: [{ playlist: playlist('8001', '我喜欢的音乐', { type: 1, count: state.liked.length }) }, { playlist: playlist('8002', '假的自建歌单', { count: state.owned.length }) }], has_more: false });
        }
        if (path === '/me/collection/mixed/') {
            if (!ticketed) return { body: { err_no: 28001003 } };
            return ok({ mixed_collections: [{ playlist: playlist('8003', '收藏的歌单（假应答）', { ownerId: '99', count: 3 }) }], has_more: false });
        }
        if (path === '/me/recent-played/') {
            if (!ticketed) return { body: { err_no: 28001003 } };
            return ok({ media: TRACKS.slice(0, 2).map((item, index) => ({ media: { track_entity: item }, play_start_timestamp: Math.floor(Date.now() / 1000) - index * 600 })), has_more: false });
        }
        if (path === '/media/collect/' || path === '/media/cancel/collect/') {
            const id = json.media?.[0]?.id;
            state.liked = state.liked.filter((songId) => songId !== id);
            if (path === '/media/collect/') state.liked.unshift(id);
            return ok({});
        }
        if (path === '/playlist/append/' || path === '/playlist/delete/') {
            const ids = (json.media ?? []).map(({ id }) => id);
            if (json.playlist_id === '8002') {
                state.owned = state.owned.filter((songId) => !ids.includes(songId));
                if (path === '/playlist/append/') state.owned.push(...ids);
            }
            return ok({});
        }
        if (path === '/dislike/') return ok({});

        // 推荐（feed.cjs）
        if (path === '/feed/mode/') {
            const mode = (id, text) => ({ entity: { feed_mode: { scene_mode: { scene_mode_id: id }, text, url_info: coverOf(`scene-${id}`) } } });
            return ok({ feed_mode_block: [{ title: '场景', feed_mode: [mode(301, '假的通勤'), mode(302, '假的学习')] }] });
        }
        if (path === '/feed/song-tab/') return ok({ items: TRACKS.map((item) => ({ type: 'track', track_entity: item })), has_more: true });
        return null;
    },
};
