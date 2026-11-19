// test/manual/fakeSourceNetwork/fnmusic.mjs
// 飞牛音乐的假应答（fakeSourceNetwork.mjs 的路由表）。只给桌面实测用：证明的是管道（模组注册、rpc、加密配置、两条
// _media 路由与旧的 folia-fnmusic:// 地址、登录表单、曲库与改动），证明不了真实 fnOS 接口的兼容性。
//
// 飞牛的服务器地址是用户自己填的，main 入口用 Node 的 http / https 直连，不经 Chromium 的代理：所以这张表是 `direct`，
// 假服务就是服务器本身，登录表单里填 http://127.0.0.1:<端口>，不用装 install.js。FN Connect 中继（纯 FN ID → *.5ddd.com /
// *.fnos.net）要改 DNS 才能假，这里不测。
//
// 形状的依据：sources/fnmusic/PROTOCOL.md 与 main/fnmusicApiBridge.cjs、client/fnmusicProvider.ts 读的路径与字段——信封
// { code, msg, data }（code 0 成功，120001 账号或密码错），登录 POST /music/api/v1/user/password-login
// { username, password: sha256, deviceId } → { userToken, user }，之后带 Cookie: music-token；列表 { total, list }，page 从 1 起；
// 歌曲字段 guid / title / artists[{guid,name}] / album{guid,name,coverId} / duration(ms) / coverId；歌词 { list, preferred }，
// 每项的文字是 Folia 歌词文档（.fia 的 JSON）；track/stream?guid= 与 static/cover?coverId= 回文件。音频是自己生成的
// 30 秒音调，封面是单色 PNG。
//
// 账号：任意用户名，密码 folia-fake（别的密码回 120001）。
// 控制（GET http://127.0.0.1:<端口>/__control/<动作>）：state（红心、自建歌单、登录过的设备 id）、expire（让 token 失效）。

import crypto from 'node:crypto';
import { ranged, solidPng, toneWav } from './fakeMedia.mjs';

const API = '/music/api/v1';
const PASSWORD = crypto.createHash('sha256').update('folia-fake', 'utf8').digest('hex');
const USER = { guid: 'fake-user-guid', name: '假的飞牛用户' };

const ok = (data) => ({ body: { code: 0, msg: '', data } });
const refused = (code, msg) => ({ body: { code, msg, data: null } });

const track = (guid, title, extra = {}) => ({
    guid,
    title,
    artists: [{ guid: 'fake-artist', name: '假歌手' }],
    album: { guid: 'fake-album', name: '假专辑', coverId: 'cover-album' },
    duration: 30000,
    coverId: 'cover-album',
    trackNo: 1,
    discNo: 1,
    isFavorite: false,
    ...extra,
});
const TRACKS = [
    track('fn-track-1', '晴天（飞牛假应答）'),
    track('fn-track-2', '稻香（飞牛假应答）'),
    track('fn-track-3', '七里香（飞牛假应答）', { coverId: 'cover-single' }),
];
const byId = new Map(TRACKS.map((item) => [item.guid, item]));

// 一份 Folia 歌词文档（src/utils/lyrics/foliaLyricDocument.ts 的信封），三行，逐字。
const lyricDocument = (title) => JSON.stringify({
    format: 'folia-lyricdata',
    version: 1,
    exportedAt: '2026-11-20T00:00:00.000Z',
    song: { title },
    lyrics: {
        lines: [['这是假的飞牛歌词', 1000, 5000], ['只用来测管道', 5000, 9000], ['Folia 歌词文档', 9000, 13000]].map(([text, start, end]) => ({
            fullText: text,
            startTime: start / 1000,
            endTime: end / 1000,
            words: [...text].map((char, index, chars) => ({
                text: char,
                startTime: (start + ((end - start) * index) / chars.length) / 1000,
                endTime: (start + ((end - start) * (index + 1)) / chars.length) / 1000,
            })),
        })),
    },
});

const page = (items, url) => {
    const pageNo = Math.max(1, Number(url.searchParams.get('page') ?? 1));
    const size = Math.max(1, Number(url.searchParams.get('size') ?? 20));
    return { total: items.length, list: items.slice((pageNo - 1) * size, pageNo * size) };
};

export default {
    // 服务器地址就是假服务本身：登录表单填 http://127.0.0.1:<端口>（fakeSourceNetwork.mjs 的 direct 模式）。
    direct: true,
    hosts: ['127.0.0.1'],

    createState: () => ({
        liked: ['fn-track-1'],
        owned: ['fn-track-2'],
        devices: [],
        tokens: new Set(),
        tone: toneWav(30),
        png: solidPng(64, [8, 145, 178]),
    }),

    control: {
        state: (state) => ({ liked: state.liked, owned: state.owned, devices: state.devices, tokens: state.tokens.size }),
        expire: (state) => {
            state.tokens.clear();
            return { expired: true };
        },
    },

    handle({ url, method, headers, body, state }) {
        const p = url.pathname;
        if (!p.startsWith(API)) return null;
        const path = p.slice(API.length);
        const json = body.length ? JSON.parse(body.toString('utf8')) : {};

        if (path === '/user/password-login' && method === 'POST') {
            if (json.password !== PASSWORD) return refused(120001, '账号或密码错误');
            const token = `fake-fn-token-${state.tokens.size + 1}`;
            state.tokens.add(token);
            state.devices.push(json.deviceId);
            return ok({ userToken: token, user: USER });
        }
        const token = /(?:^|;\s*)music-token=([^;]+)/.exec(String(headers.cookie ?? ''))?.[1];
        const signedIn = Boolean(token) && state.tokens.has(decodeURIComponent(token));
        if (path === '/user/logout') {
            if (token) state.tokens.delete(decodeURIComponent(token));
            return ok(null);
        }
        // 没登录（或 token 失效）的请求：HTTP 401，桥读作 auth-required。
        if (!signedIn) return { status: 401, body: { code: 401, msg: 'unauthorized', data: null } };

        // 媒体
        if (path === '/track/stream') {
            return byId.has(url.searchParams.get('guid')) ? ranged({ headers }, state.tone, 'audio/wav') : { status: 404, body: { code: 404 } };
        }
        if (path === '/static/cover') return { headers: { 'content-type': 'image/png' }, body: state.png };

        // 搜索、歌曲、歌词
        if (path === '/search/track') {
            const q = url.searchParams.get('q') ?? '';
            return ok(page(TRACKS.filter((item) => q && (item.title.includes(q) || '假歌手'.includes(q) || q.includes('假'))), url));
        }
        if (path === '/track/metadata') {
            const item = byId.get(url.searchParams.get('trackGUID'));
            return item ? ok({ ...item, isFavorite: state.liked.includes(item.guid) }) : refused(404, 'no such track');
        }
        if (path === '/lyric/list') {
            const item = byId.get(url.searchParams.get('trackGUID'));
            return ok(item ? { preferred: 0, list: [{ lyric: lyricDocument(item.title) }] } : { list: [] });
        }

        // 曲库
        if (path === '/playlist/list') {
            return ok(page([{ guid: 'fn-playlist-1', name: '假的自建歌单', coverId: 'cover-playlist', trackCount: state.owned.length }], url));
        }
        if (path === '/album/list') return ok(page([{ guid: 'fake-album', name: '假专辑', coverId: 'cover-album', trackCount: TRACKS.length, artists: [{ guid: 'fake-artist', name: '假歌手' }] }], url));
        if (path === '/favorite-track/list') return ok(page(state.liked.map((guid) => ({ trackGUID: guid, ...byId.get(guid) })), url));
        if (path === '/favorite-track/create' || path === '/favorite-track/delete') {
            state.liked = state.liked.filter((guid) => guid !== json.trackGUID);
            if (path === '/favorite-track/create') state.liked.unshift(json.trackGUID);
            return ok(null);
        }
        if (path === '/playlist/add-track' || path === '/playlist/remove-track') {
            const ids = Array.isArray(json.trackGUIDs) ? json.trackGUIDs : [];
            state.owned = state.owned.filter((guid) => !ids.includes(guid));
            if (path === '/playlist/add-track') state.owned.push(...ids);
            return ok(null);
        }
        if (path === '/playlist/create') return ok({ guid: `fn-playlist-${Date.now()}`, name: json.name, trackCount: 0 });

        // 目录
        if (path === '/playlist/detail') return ok({ guid: url.searchParams.get('guid'), name: '假的自建歌单', coverId: 'cover-playlist', trackCount: state.owned.length });
        if (path === '/album/detail') return ok({ guid: 'fake-album', name: '假专辑', coverId: 'cover-album', trackCount: TRACKS.length, artists: [{ guid: 'fake-artist', name: '假歌手' }] });
        if (path === '/artist/detail') return ok({ guid: 'fake-artist', name: '假歌手', coverId: 'cover-artist', trackCount: TRACKS.length, albumCount: 1 });
        if (path === '/track/playlist-detail/list') return ok(page(state.owned.map((guid) => byId.get(guid)).filter(Boolean), url));
        if (path === '/track/album-detail/list' || path === '/track/artist-detail/list') return ok(page(TRACKS, url));
        return null;
    },
};
