// test/manual/fakeSourceNetwork/lxmusic.mjs
// 洛雪音源的假应答（fakeSourceNetwork.mjs 的路由表）。只给桌面实测用：证明的是管道（模组注册、rpc、脚本导入、沙箱窗口、
// 受控出口、音频转发、界面流程），证明不了真实脚本和真实平台接口的兼容性。
//
// 两条路都在这里：
//   1. 曲库。模组用 api.net.fetch（默认会话）请求酷我的公开接口，install.js 装好后由这里回假应答。形状的依据是
//      sources/lxmusic/main/catalog.ts 读的路径与字段（search.kuwo.cn/r.s 的 abslist / TOTAL，kbangserver.kuwo.cn/ksong.s 的
//      musiclist / num，m.kuwo.cn 的 data.lrclist），样本照 test/unit/lxmusic/scriptsAndCatalog.test.ts。
//   2. 脚本的请求和音频。受控出口用 Node 的 http 直连、不走 Chromium 的代理，所以假服务就是服务器本身（direct）：
//      假脚本（lxmusic/fake-source.js）请求 http://127.0.0.1:39877/lx/url，拿到的地址先 302 一跳再到 /lx/audio/…。
//      出口本来不许连本机，桌面要带环境变量 FOLIA_LXMUSIC_DEV_ALLOW=127.0.0.1:39877 启动（只在从源码跑时认）。
//
// 端口是写死在两个脚本样例里的，所以必须这样起：
//   node test/manual/fakeSourceNetwork/fakeSourceNetwork.mjs lxmusic --port 39877 --out <目录>
//
// 「内网里的秘密」：这张表另开一个只听 127.0.0.1:39878 的服务，谁连上都记一笔。恶意脚本样例（lxmusic/malicious-source.js）
// 想尽办法去连它；放行的只有 39877，所以 39878 上一笔都不该有。
//
// 控制（GET http://127.0.0.1:39877/__control/<动作>）：
//   state    脚本取过地址的歌、音频被取了几次、恶意脚本交回的报告、39878 上的连接数（应为 0）
//   reset    清掉上面这些
//
// 五首假歌里有两首是给出口的限制准备的：900004 有十分钟长（不该被字节上限和空闲超时误伤），900005 的音频发到第 3 秒
// 就不再发也不断开（空闲超时 30 秒后该把它断掉）。

import http from 'node:http';
import { ranged, solidPng, toneWav } from './fakeMedia.mjs';

export const FAKE_PORT = 39877;
export const SECRET_PORT = 39878;

const SEARCH = 'search.kuwo.cn';
const CHARTS = 'kbangserver.kuwo.cn';
const MOBILE = 'm.kuwo.cn';
const IMAGES = 'img1.kuwo.cn';
const SELF = '127.0.0.1';

const SONGS = [
    { id: '900001', name: '假歌一号（假应答）', artist: '假歌手', album: '假专辑', albumId: '800001', seconds: 30 },
    { id: '900002', name: '假歌二号（假应答）', artist: '假歌手&另一位假歌手', album: '假专辑', albumId: '800001', seconds: 30 },
    { id: '900003', name: '脚本答不上的歌（假应答）', artist: '假歌手', album: '假专辑', albumId: '800001', seconds: 30 },
    // 十分钟、26 MB：看转发的字节上限和空闲超时会不会误伤一首长的。
    { id: '900004', name: '十分钟的长歌（假应答）', artist: '假歌手', album: '假专辑', albumId: '800001', seconds: 600 },
    // 音频发到第 3 秒就不再发、也不断开：看空闲超时把它断掉之后播放端怎么表现。
    { id: '900005', name: '放到一半就卡住的歌（假应答）', artist: '假歌手', album: '假专辑', albumId: '800001', seconds: 30, stallAtSeconds: 3 },
];
const byId = new Map(SONGS.map((song) => [song.id, song]));

// 搜索结果的字段是大写的，榜单是小写的（catalog.ts 的 kuwoSong 两种都读）。
const searchItem = (song) => ({
    MUSICRID: `MUSIC_${song.id}`, SONGNAME: song.name, ARTIST: song.artist, ALBUM: song.album, ALBUMID: song.albumId,
    DURATION: String(song.seconds), web_albumpic_short: '120/1/1/fake.png',
});
const chartItem = (song) => ({
    id: song.id, name: song.name, artist: song.artist, album: song.album, albumid: song.albumId,
    duration: '2', song_duration: String(song.seconds), pic: `https://${IMAGES}/star/albumcover/300/1/1/fake.png`,
});

const json = (body) => ({ headers: { 'content-type': 'application/json;charset=utf-8' }, body });

export default {
    hosts: [SEARCH, CHARTS, MOBILE, IMAGES],
    direct: true,

    createState() {
        const state = {
            tone: toneWav(30, 523.25),
            longTone: toneWav(600, 392),
            cover: solidPng(64, [47, 158, 110]),
            asked: [],
            audioRequests: 0,
            reports: [],
            secretHits: [],
        };
        // 「内网里的秘密」：连上就算被打到了。
        state.secret = http.createServer((request, response) => {
            state.secretHits.push({ at: new Date().toISOString(), method: request.method, url: request.url, host: request.headers.host ?? null });
            console.log(`[fake] SECRET HIT ${request.method} ${request.url}`);
            response.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
            response.end('the secret of the local network');
        });
        state.secret.on('connection', (socket) => {
            state.secretHits.push({ at: new Date().toISOString(), connection: socket.remoteAddress });
        });
        state.secret.listen(SECRET_PORT, SELF);
        return state;
    },

    control: {
        state: (state) => ({ asked: state.asked, audioRequests: state.audioRequests, reports: state.reports, secretHits: state.secretHits }),
        reset: (state) => {
            state.asked = [];
            state.audioRequests = 0;
            state.reports = [];
            state.secretHits = [];
            return { ok: true };
        },
    },

    handle({ host, url, method, headers, body, state }) {
        const p = url.pathname;
        const q = url.searchParams;

        if (host === SEARCH && p === '/r.s') {
            const word = (q.get('all') ?? '').trim();
            const found = word === '没有结果' ? [] : SONGS;
            return json({ TOTAL: String(found.length), abslist: found.map(searchItem) });
        }
        if (host === CHARTS && p === '/ksong.s') {
            return json({ num: String(SONGS.length), musiclist: SONGS.map(chartItem) });
        }
        if (host === MOBILE && p === '/newh5/singles/songinfoandlrc') {
            const song = byId.get(q.get('musicId') ?? '');
            if (!song) return json({ status: 200, data: { lrclist: [] } });
            return json({
                status: 200,
                data: {
                    lrclist: ['这是假的歌词', '只用来测管道', '由公开接口那条路给出'].map((line, index) => ({ time: String(index * 4), lineLyric: line })),
                    songinfo: { id: song.id, songName: song.name, artist: song.artist, album: song.album, albumId: song.albumId, duration: String(song.seconds) },
                },
            });
        }
        if (host === IMAGES) return { headers: { 'content-type': 'image/png' }, body: state.cover };

        if (host !== SELF) return null;

        // 下面是「脚本作者的服务器」和「音频 CDN」。
        if (p === '/lx/url') {
            const id = q.get('id') ?? '';
            state.asked.push({ id, quality: q.get('quality'), source: q.get('source'), method });
            if (id === '900003') return json({ code: 404, msg: 'no url for this song' });
            if (!byId.has(id)) return json({ code: 404, msg: 'unknown song' });
            // 先给一个会跳转的地址：出口要逐跳跟上。
            return json({ code: 200, url: `http://${SELF}:${FAKE_PORT}/lx/hop/${id}.wav` });
        }
        const hop = /^\/lx\/hop\/(\d+)\.wav$/.exec(p);
        if (hop) return { status: 302, headers: { location: `/lx/audio/${hop[1]}.wav` }, body: Buffer.alloc(0) };
        const audio = /^\/lx\/audio\/(\d+)\.wav$/.exec(p);
        if (audio) {
            state.audioRequests += 1;
            const song = byId.get(audio[1]);
            const answer = ranged({ headers }, song?.seconds === 600 ? state.longTone : state.tone, 'audio/wav');
            // 22050 Hz、16 位、单声道：一秒 44100 字节。从卡住的位置往后要的（播放器重试时带 Range）一个字节也不给。
            if (song?.stallAtSeconds) {
                const stallAt = 44 + song.stallAtSeconds * 44100;
                const start = Number(/^bytes (\d+)-/.exec(answer.headers['content-range'] ?? '')?.[1] ?? 0);
                return { ...answer, stallAfter: Math.max(0, stallAt - start) };
            }
            return answer;
        }
        // 恶意脚本样例用它当跳板：从放行的地址跳去不放行的。
        if (p === '/lx/redirect') return { status: 302, headers: { location: q.get('to') ?? '/' }, body: Buffer.alloc(0) };
        if (p === '/lx/report' && method === 'POST') {
            let report;
            try { report = JSON.parse(body.toString('utf8')); } catch { report = { unparsed: body.toString('utf8').slice(0, 2000) }; }
            state.reports.push(report);
            return json({ ok: true });
        }
        return null;
    },
};
