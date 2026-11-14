// test/manual/fakeSourceNetwork/bodian.mjs
// 波点的假应答（fakeSourceNetwork.mjs 的路由表）。只给桌面实测用：证明的是管道（模组注册、rpc、会话存储、媒体规则、界面
// 流程），证明不了真实接口的兼容性。
//
// 形状的依据：bodian-music-api@0.1.2 读的路径与字段（node_modules/bodian-music-api/src/http.cjs 的 { code: 200, data }
// 包装、auth.cjs 的 qrCode / qrCodeStatus（1 等待、2 过期、3 已确认）/ users/login 的 { id, token, userInfo }、
// library.cjs 的 userCreate / fond / collect/4/list / <id>/musicList、catalog.cjs 的各目录路径与 resultList / list / total、
// playback.cjs 的 checkRight（status）与 audioUrl（audioHttpsUrl）、lyrics.cjs 的 base64 歌词与 [kuwo:<八进制>] 时间编码、
// mutations.cjs 的 playlist/music（/delete）），歌曲记录照 test/unit/onlineMusic/bodianProvider.test.ts 的样本，
// 歌单照 bodianAlbumPaging.test.ts 的样本。音频是自己生成的 30 秒音调，封面是单色 PNG，都不带 CORS 头。
//
// 控制（GET http://127.0.0.1:<端口>/__control/<动作>）：scan（手机上扫码并确认）、state（看歌单、红心的当前状态）。

import { ranged, solidPng, toneWav } from './fakeMedia.mjs';

const API = 'bd-api.kuwo.cn';
const LYRIC = 'mlyric.kuwo.cn';
const IMAGES = 'img9.kuwo.cn';
const AUDIO = 'sycdn-fake.kuwo.cn';

const cover = (name) => `https://${IMAGES}/star/albumcover/800/fake/${name}.png`;
const USER = { uid: 10001, nickname: '假的波点用户', headImg: `https://${IMAGES}/star/starheads/240/fake/avatar.png` };

// bodianProvider.test.ts 的 track 样本的形状。
const track = (id, songName, extra = {}) => ({
    id, songName, name: songName.replace(/ \(.*\)$/, ''), albumId: 1293, album: '假专辑', albumPic: cover('album'),
    artist: '假歌手', artistId: 336, artists: [{ id: 336, name: '假歌手' }], duration: 30, ...extra,
});
const TRACKS = [
    track(228908, '晴天（假应答）'),
    track(228909, '稻香（假应答） (Live)'),
    track(228910, '七里香（假应答）'),
    track(228911, '下架的歌（假应答）', { offline: true }),
    track(228912, '只能试听（假应答）', { payInfo: { cannotOnlinePlay: 1 } }),
];
const byId = new Map(TRACKS.map((item) => [String(item.id), item]));

// lyrics.cjs：[kuwo:013] → 系数 11，起点系数 1、时长系数 1；<a,b> 还原成 <(a+b)/2, (a-b)/2>（行内毫秒）。
const LYRIC_LINES = ['这是假的波点歌词', '只用来测管道', '逐字时间是编码过的', '解出来是每字四百毫秒'];
const lyricText = () => {
    const lines = LYRIC_LINES.map((line, index) => {
        const at = 1 + index * 4;
        const words = [...line].map((char, i) => {
            const start = i * 400;
            const duration = 400;
            return `<${start + duration},${start - duration}>${char}`;
        }).join('');
        return `[00:${String(at).padStart(2, '0')}.000]${words}`;
    });
    return ['[ti:假的波点歌词]', '[kuwo:013]', ...lines].join('\n');
};

const ok = (data) => ({ body: { code: 200, msg: 'ok', data } });
const page = (url, list, firstPage = 0) => {
    const rn = Number(url.searchParams.get('rn') ?? 50);
    const pn = Number(url.searchParams.get('pn') ?? firstPage) - firstPage;
    return { total: list.length, slice: list.slice(pn * rn, pn * rn + rn) };
};

export default {
    hosts: [API, LYRIC, IMAGES, AUDIO],

    createState: () => ({
        qr: new Map(),
        liked: new Set(['228908']),
        owned: new Map([[3001, ['228909', '228910']]]),
        tone: toneWav(30),
        png: { album: solidPng(64, [13, 148, 136]), avatar: solidPng(64, [240, 160, 40]) },
        logins: 0,
    }),

    control: {
        // 手机上扫了码并确认：之后的 qrCodeStatus 回 3，users/login 回账号与 token。
        scan: (state) => {
            for (const key of state.qr.keys()) state.qr.set(key, 'confirmed');
            return { scanned: [...state.qr.keys()] };
        },
        state: (state) => ({ liked: [...state.liked], owned: Object.fromEntries(state.owned), logins: state.logins }),
    },

    handle({ host, url, method, body, headers, state }) {
        const p = url.pathname;
        if (host === AUDIO && p.endsWith('/tone.wav')) return ranged({ headers }, state.tone, 'audio/wav');
        if (host === IMAGES) return { headers: { 'content-type': 'image/png' }, body: p.includes('starheads') ? state.png.avatar : state.png.album };
        if (host === LYRIC && p === '/mobi.s') return ok({ content: Buffer.from(lyricText()).toString('base64') });
        if (host !== API) return null;
        const json = body.length ? JSON.parse(body.toString('utf8')) : null;

        // 登录（auth.cjs）
        if (p === '/api/ucenter/login/qrCode') {
            const key = `fake-qr-${state.qr.size + 1}`;
            state.qr.set(key, 'waiting');
            return ok({ qrCode: key });
        }
        if (p === '/api/ucenter/login/qrCodeStatus') {
            const status = state.qr.get(url.searchParams.get('qrCode'));
            return ok({ status: status === 'confirmed' ? 3 : status ? 1 : 2 });
        }
        if (p === '/api/ucenter/users/login' && method === 'POST') {
            if (state.qr.get(json?.qrCode) !== 'confirmed') return { body: { code: 11027, msg: 'waiting for confirmation' } };
            state.logins += 1;
            return ok({ id: USER.uid, token: `fake-token-qr-${state.logins}`, userInfo: USER });
        }

        // 曲库（library.cjs）与歌单改动（mutations.cjs）
        if (p === '/api/service/playlist/userCreate') {
            return ok({ playLists: [...state.owned].map(([id, ids]) => ({ id, name: '假的自建歌单', pic: cover('owned'), musicCount: ids.length, isPrivate: 0 })) });
        }
        if (p === '/api/service/playlist/fond') return ok({ id: 3000, name: '我喜欢', pic: cover('liked'), musicCount: state.liked.size, isFond: 1 });
        if (p === '/api/service/collect/4/list') {
            const list = [
                { id: 4001, name: '收藏的歌单（假应答）', sourceType: 4, pic: cover('collected'), musicCount: 5 },
                { id: 5001, albumId: 5001, name: '收藏的专辑（假应答）', artist: '假歌手', sourceType: 6, pic: cover('album'), musicCount: 10 },
            ];
            const { total, slice } = page(url, list, 1);
            return ok({ total, playLists: slice });
        }
        const playlistTracks = /^\/api\/service\/playlist\/(\d+)\/musicList$/.exec(p);
        if (playlistTracks) {
            const id = Number(playlistTracks[1]);
            const ids = id === 3000 ? [...state.liked] : state.owned.get(id) ?? ['228908', '228909', '228910', '228911', '228912'];
            const { total, slice } = page(url, ids.map((songId) => byId.get(songId)).filter(Boolean), 1);
            return ok({ total, list: slice });
        }
        const playlistInfo = /^\/api\/service\/playlist\/info\/(\d+)$/.exec(p);
        if (playlistInfo) return ok({ id: Number(playlistInfo[1]), name: '歌单详情（假应答）', pic: cover('collected'), musicCount: 5, description: '假应答' });
        if ((p === '/api/service/playlist/music' || p === '/api/service/playlist/music/delete') && method === 'POST') {
            const remove = p.endsWith('/delete');
            const owned = state.owned.get(json.playListId);
            for (const songId of json.musicIdList.map(String)) {
                if (json.playListId === 3000) {
                    if (remove) state.liked.delete(songId);
                    else state.liked.add(songId);
                } else if (owned) {
                    const at = owned.indexOf(songId);
                    if (remove && at >= 0) owned.splice(at, 1);
                    if (!remove && at < 0) owned.push(songId);
                }
            }
            return ok(null);
        }

        // 目录（catalog.cjs）
        if (p === '/api/search/music/list') {
            const keyword = url.searchParams.get('keyword') ?? '';
            const found = TRACKS.filter((item) => item.songName.includes(keyword));
            const { total, slice } = page(url, found.length ? found : TRACKS);
            return ok({ total, resultList: slice });
        }
        if (p === '/api/service/music/info') return ok(byId.get(url.searchParams.get('musicId')) ?? TRACKS[0]);
        if (/^\/api\/service\/album\/\d+$/.test(p)) return ok({ albumInfo: { albumId: 1293, name: '假专辑', pic: cover('album'), artist: '假歌手', artistId: 336, musicCnt: TRACKS.length, showtime: '2026-11-14' } });
        if (/^\/api\/service\/album\/music\/\d+$/.test(p)) { const { total, slice } = page(url, TRACKS); return ok({ total, resultList: slice }); }
        if (/^\/api\/service\/artist\/\d+$/.test(p)) return ok({ artistInfo: { id: 336, name: '假歌手', pic: `https://${IMAGES}/star/starheads/700/fake/artist.png`, info: '假应答里的歌手', albumCnt: 1 } });
        if (/^\/api\/service\/artist\/music\/\d+$/.test(p)) { const { total, slice } = page(url, TRACKS); return ok({ total, resultList: slice }); }
        if (/^\/api\/service\/artist\/album\/\d+$/.test(p)) return ok({ total: 1, resultList: [{ albumId: 1293, name: '假专辑', pic: cover('album'), artist: '假歌手', artistId: 336 }] });
        if (p === '/api/service/finds/playlist') return ok({ lists: [{ playLists: [{ id: 4001, name: '推荐歌单（假应答）', pic: cover('collected'), musicCount: 5 }] }] });
        if (p === '/api/service/home/module') return ok({ songList: [{ id: 0, title: '假的日推' }] });
        if (p === '/api/service/home/aiPlaylistDetail') return ok({ title: '假的日推', subTitle: '「假应答」', musicList: TRACKS.slice(0, 3) });
        if (p === '/api/service/music/recommendList') return ok({ musicList: TRACKS.slice(1, 3) });

        // 播放（playback.cjs）：先查权利，再要地址。
        if (p === '/api/play/music/v2/checkRight') return ok({ status: 1 });
        if (p === '/api/play/music/v2/audioUrl') return ok({ audioHttpsUrl: `https://${AUDIO}/resource/${url.searchParams.get('musicId')}/tone.wav?from=bodian` });
        return null;
    },
};
