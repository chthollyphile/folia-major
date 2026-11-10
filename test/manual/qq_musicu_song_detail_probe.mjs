#!/usr/bin/env node
// test/manual/qq_musicu_song_detail_probe.mjs
// 复跑 QQ 音乐按数字 songid / songmid 查单曲详情的实测（Folium 1.7 qq-songid 规格 §3 的 a–m）：匿名、不带凭据，
// 直接向 musicu 发 `music.pf_song_detail_svr` / `get_song_detail_yqq`，核对 songid 必须是 JSON 数字、一次最多 30 个子请求、
// 空壳与拒绝的码，以及 `CgiGetTrackInfo` 为什么不用。零依赖（Node 自带 fetch），只打印，不写文件。
//
// 用法：
//   node test/manual/qq_musicu_song_detail_probe.mjs                       本机直发 https://u.y.qq.com/cgi-bin/musicu.fcg
//   node test/manual/qq_musicu_song_detail_probe.mjs --relay <网页部署的源>  经 <源>/api/lyric-proxy?url= 发出（核对 Vercel /
//                                                                           Cloudflare 中转的出口；源形如 https://folia.example）
//   node test/manual/qq_musicu_song_detail_probe.mjs --only a,c,d          只跑这几条
//
// 各条：
//   a  song_id 97773（数字）→ code 0、晴天（0039MnYb0qxYhV）
//   b  song_id '97773'（字符串）→ 子请求 404 空壳（上游 3.3.3 的 /getSongInfo 就是这样发的）
//   c  四个已知 songid 都查得到；再按查到的 songmid 查一次，track_info 的 id / mid / name 一致
//   d  int32 内、QQ 没有或没有文件的 songid → code 0 空壳
//   e  int32 上界与更大的数、负数 → 2147483647 空壳，更大的和负数子请求 500
//   f  未知 songmid → 子请求 404 空壳
//   g  同一次请求里混着 song_id 与 song_mid → 各回各的
//   h  一次 2 / 5 / 10 / 20 / 25 / 30 个子请求 → 都 code 0
//   i  31 个起 → 整次 500000，各子请求也是 { code: 500000 }、没有 data
//   j  顺序连发 10 次、每次 25 个 → 都 code 0
//   k  music.trackInfo.UniformRuleCtrl / CgiGetTrackInfo 的口径（不认识的 id 不出现、超出 uint32 整个子请求 10006、没有 types
//      103901、字符串 id 10006、会交出 get_song_detail_yqq 答空壳的 400000000）
//   l  本机直接调 api/lyric-proxy.js（Vercel 与 Docker 用的中转）的 handler 转发一次（只在不加 --relay 时跑；出口仍是本机）
//   m  并发 2 × 25 三轮、并发 8 × 25 一次 → 都 code 0
// 请求总数约 52 个，同时最多 8 个。
// 加 --relay 时 l 跳过，是 51 个（a1 b1 c2 d1 e1 f1 g1 h6 i7 j10 k6 m14，直发再加 l 的 1 个）。

const MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const COMM = { ct: 24, cv: 0 };
const REQUEST_TIMEOUT_MS = 20_000;
const SUNNY = { id: 97773, mid: '0039MnYb0qxYhV', name: '晴天' };

const parseArgs = (argv) => {
    const options = { relay: '', only: null };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const [key, inline] = arg.split('=');
        const value = inline ?? argv[index + 1];
        if (key === '--relay' && value) {
            options.relay = value.trim().replace(/\/$/, '');
            if (inline === undefined) index += 1;
        } else if (key === '--only' && value) {
            options.only = new Set(value.split(',').map(item => item.trim().toLowerCase()).filter(Boolean));
            if (inline === undefined) index += 1;
        }
    }
    return options;
};

const options = parseArgs(process.argv.slice(2));
const requestUrl = options.relay ? `${options.relay}/api/lyric-proxy?url=${encodeURIComponent(MUSICU_URL)}` : MUSICU_URL;
let requestCount = 0;
const mismatches = [];

const detailById = (songId) => ({
    module: 'music.pf_song_detail_svr',
    method: 'get_song_detail_yqq',
    param: { song_type: 0, song_id: songId },
});
const detailByMid = (songMid) => ({
    module: 'music.pf_song_detail_svr',
    method: 'get_song_detail_yqq',
    param: { song_type: 0, song_mid: songMid },
});
const keyed = (requests) => Object.fromEntries(requests.map((request, index) => [`q${index}`, request]));

// 发一次 musicu 请求，交回 HTTP 状态、Content-Type、读出的 JSON（读不出时是 null 和原文开头）与用时。
const send = async (requests) => {
    requestCount += 1;
    const started = Date.now();
    const response = await fetch(requestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comm: COMM, ...requests }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    let body = null;
    try {
        body = JSON.parse(text);
    } catch {
        body = null;
    }
    return {
        status: response.status,
        contentType: response.headers.get('content-type') || '',
        body,
        text: body ? '' : text.slice(0, 120),
        ms: Date.now() - started,
    };
};

const trackOf = (node) => node?.data?.track_info ?? null;
const midOf = (node) => String(trackOf(node)?.mid ?? '');
const describeNode = (node) => {
    const track = trackOf(node);
    const mid = String(track?.mid ?? '');
    return `code ${node?.code}${mid ? `，${track?.id} ${mid} ${track?.name}` : '，空壳'}`;
};

const check = (item, ok, detail) => {
    console.log(`  ${ok ? '符合' : '不符'}：${detail}`);
    if (!ok) mismatches.push(`${item}: ${detail}`);
};

const header = (item, title) => console.log(`\n[${item}] ${title}`);

const items = {
    async a() {
        header('a', 'song_id 97773（数字）');
        const answer = await send(keyed([detailById(SUNNY.id)]));
        console.log(`  HTTP ${answer.status}，${answer.contentType}，${answer.ms} ms，全局 code ${answer.body?.code}，q0 ${describeNode(answer.body?.q0)}`);
        const track = trackOf(answer.body?.q0);
        check('a', answer.body?.code === 0 && answer.body?.q0?.code === 0 && track?.mid === SUNNY.mid && track?.name === SUNNY.name,
            `mid ${track?.mid}、name ${track?.name}`);
    },

    async b() {
        header('b', "song_id '97773'（字符串）");
        const answer = await send(keyed([detailById(String(SUNNY.id))]));
        console.log(`  ${answer.ms} ms，全局 code ${answer.body?.code}，q0 ${describeNode(answer.body?.q0)}`);
        check('b', answer.body?.q0?.code === 404 && !midOf(answer.body?.q0), `子请求 code ${answer.body?.q0?.code}`);
    },

    async c() {
        header('c', '已知 songid 按 song_id 查，再按查到的 songmid 查，对照 track_info');
        const ids = [1, 5105986, 102065756, 213836590];
        const byId = await send(keyed(ids.map(detailById)));
        console.log(`  按 song_id：${byId.ms} ms，全局 code ${byId.body?.code}`);
        const mids = ids.map((id, index) => {
            const node = byId.body?.[`q${index}`];
            console.log(`    ${id}: ${describeNode(node)}`);
            return midOf(node);
        });
        check('c', mids.every(Boolean), `按数字 songid 查到 ${mids.filter(Boolean).length} / ${ids.length}`);
        const asked = mids.filter(Boolean);
        if (asked.length === 0) return;
        const byMid = await send(keyed(asked.map(detailByMid)));
        console.log(`  按 song_mid：${byMid.ms} ms，全局 code ${byMid.body?.code}`);
        const same = asked.every((mid, index) => {
            const fromMid = trackOf(byMid.body?.[`q${index}`]);
            const fromId = trackOf(byId.body?.[`q${mids.indexOf(mid)}`]);
            return fromMid && fromId && fromMid.id === fromId.id && fromMid.mid === fromId.mid && fromMid.name === fromId.name;
        });
        check('c', same, '按 songid 与按 songmid 查到的 id / mid / name 一致');
    },

    async d() {
        header('d', 'int32 内、QQ 没有或没有文件的 songid');
        const ids = [2000000000, 400000000];
        const answer = await send(keyed(ids.map(detailById)));
        console.log(`  ${answer.ms} ms，全局 code ${answer.body?.code}`);
        ids.forEach((id, index) => console.log(`    ${id}: ${describeNode(answer.body?.[`q${index}`])}`));
        check('d', ids.every((_, index) => answer.body?.[`q${index}`]?.code === 0 && !midOf(answer.body?.[`q${index}`])), '都是 code 0 空壳');
    },

    async e() {
        header('e', 'int32 上界、更大的数与负数（同一次请求）');
        const ids = [2147483647, 2147483648, 4294967295, Number.MAX_SAFE_INTEGER, -97773];
        const answer = await send(keyed(ids.map(detailById)));
        console.log(`  ${answer.ms} ms，全局 code ${answer.body?.code}`);
        ids.forEach((id, index) => console.log(`    ${id}: ${describeNode(answer.body?.[`q${index}`])}`));
        const first = answer.body?.q0;
        check('e', first?.code === 0 && !midOf(first), '2147483647 是 code 0 空壳');
        check('e', ids.slice(1).every((_, index) => answer.body?.[`q${index + 1}`]?.code === 500), '更大的和负数子请求 code 500');
    },

    async f() {
        header('f', '未知 songmid');
        const mids = ['0039MnYb0qxYhX', '000000000000ZZ', '999999999999', '', 'abc def'];
        const answer = await send(keyed(mids.map(detailByMid)));
        console.log(`  ${answer.ms} ms，全局 code ${answer.body?.code}`);
        mids.forEach((mid, index) => console.log(`    '${mid}': ${describeNode(answer.body?.[`q${index}`])}`));
        check('f', mids.every((_, index) => answer.body?.[`q${index}`]?.code === 404 && !midOf(answer.body?.[`q${index}`])), '都是子请求 404 空壳');
    },

    async g() {
        header('g', '同一次请求里混着 song_id 与 song_mid');
        const answer = await send(keyed([detailById(SUNNY.id), detailByMid(SUNNY.mid), detailById(2000000000)]));
        console.log(`  ${answer.ms} ms，全局 code ${answer.body?.code}`);
        ['song_id 97773', `song_mid ${SUNNY.mid}`, 'song_id 2000000000'].forEach((label, index) => (
            console.log(`    ${label}: ${describeNode(answer.body?.[`q${index}`])}`)
        ));
        check('g', midOf(answer.body?.q0) === SUNNY.mid && midOf(answer.body?.q1) === SUNNY.mid && !midOf(answer.body?.q2)
            && answer.body?.q2?.code === 0, '晴天、晴天、空壳');
    },

    async h() {
        header('h', '一次 2 / 5 / 10 / 20 / 25 / 30 个子请求');
        for (const size of [2, 5, 10, 20, 25, 30]) {
            const answer = await send(keyed(Array.from({ length: size }, (_, index) => detailById(SUNNY.id + index))));
            const codes = Array.from({ length: size }, (_, index) => answer.body?.[`q${index}`]?.code);
            const found = Array.from({ length: size }, (_, index) => midOf(answer.body?.[`q${index}`])).filter(Boolean).length;
            console.log(`    ${size} 个：${answer.ms} ms，全局 code ${answer.body?.code}，子请求码 ${[...new Set(codes)].join('/')}，查到 ${found}`);
            check('h', answer.body?.code === 0 && codes.every(code => code === 0), `${size} 个子请求都 code 0`);
        }
    },

    async i() {
        header('i', '31、32、35、40、45、49、50 个子请求');
        for (const size of [31, 32, 35, 40, 45, 49, 50]) {
            const answer = await send(keyed(Array.from({ length: size }, (_, index) => detailById(SUNNY.id + index))));
            const nodes = Array.from({ length: size }, (_, index) => answer.body?.[`q${index}`]);
            const keys = answer.body ? Object.keys(answer.body).length : 0;
            console.log(`    ${size} 个：${answer.ms} ms，全局 code ${answer.body?.code}，顶层 ${keys} 个 key，q0 ${JSON.stringify(nodes[0])}，q${size - 1} ${JSON.stringify(nodes[size - 1])}`);
            check('i', answer.body?.code === 500000 && nodes.every(node => node?.code === 500000 && !('data' in node)),
                `${size} 个：整次与各子请求都是 500000、没有 data`);
        }
    },

    async j() {
        header('j', '顺序连发 10 次、每次 25 个');
        const started = Date.now();
        let allZero = true;
        for (let round = 0; round < 10; round += 1) {
            const answer = await send(keyed(Array.from({ length: 25 }, (_, index) => detailById(SUNNY.id + round * 25 + index))));
            const zero = answer.body?.code === 0 && Array.from({ length: 25 }, (_, index) => answer.body?.[`q${index}`]?.code).every(code => code === 0);
            allZero &&= zero;
            console.log(`    第 ${round + 1} 次：HTTP ${answer.status}，${answer.ms} ms，全局 code ${answer.body?.code}${zero ? '' : '（有非 0 子请求）'}`);
        }
        console.log(`  共 ${Date.now() - started} ms`);
        check('j', allZero, '10 次都 code 0');
    },

    async k() {
        header('k', 'music.trackInfo.UniformRuleCtrl / CgiGetTrackInfo（对照：不用它的理由）');
        const trackInfo = (param) => ({ q0: { module: 'music.trackInfo.UniformRuleCtrl', method: 'CgiGetTrackInfo', param } });
        const summarize = (answer) => {
            const node = answer.body?.q0;
            const tracks = Array.isArray(node?.data?.tracks) ? node.data.tracks : [];
            return { global: answer.body?.code, code: node?.code, tracks };
        };

        const mixedIds = [SUNNY.id, 2000000000, 400000000];
        const mixed = summarize(await send(trackInfo({ ids: mixedIds, types: mixedIds.map(() => 0) })));
        const listed = mixed.tracks.map(track => Number(track?.id));
        console.log(`    97773 / 2000000000 / 400000000：全局 ${mixed.global}，子请求 ${mixed.code}，tracks 里的 id ${listed.join(', ') || '（无）'}`);
        const noFile = mixed.tracks.find(track => Number(track?.id) === 400000000);
        if (noFile) console.log(`      400000000：mid ${noFile.mid}，action.switch ${noFile.action?.switch}，action.msgid ${noFile.action?.msgid}`);
        check('k', listed.includes(SUNNY.id) && !listed.includes(2000000000), '不认识的 id 不出现在 tracks 里');
        check('k', Boolean(noFile), '会交出 get_song_detail_yqq 答空壳的 400000000');

        const hundredIds = Array.from({ length: 100 }, (_, index) => SUNNY.id + index);
        const hundred = summarize(await send(trackInfo({ ids: hundredIds, types: hundredIds.map(() => 0) })));
        console.log(`    100 个：全局 ${hundred.global}，子请求 ${hundred.code}，tracks ${hundred.tracks.length} 首`);
        check('k', hundred.global === 0 && hundred.code === 0, '100 个一次能批量');

        // 2026-10-21 复测：它按 uint32 读 id，2147483648 只是不出现，4294967296 起整个子请求 10006。
        const aboveInt32 = summarize(await send(trackInfo({ ids: [SUNNY.id, 2147483648], types: [0, 0] })));
        console.log(`    带一个 2147483648：全局 ${aboveInt32.global}，子请求 ${aboveInt32.code}，tracks 里的 id ${aboveInt32.tracks.map(track => track?.id).join(', ') || '（无）'}`);
        check('k', aboveInt32.code === 0 && aboveInt32.tracks.length === 1, '超出 int32、不超出 uint32 的 id 只是不出现');
        const tooLarge = summarize(await send(trackInfo({ ids: [SUNNY.id, 4294967296], types: [0, 0] })));
        console.log(`    带一个 4294967296：全局 ${tooLarge.global}，子请求 ${tooLarge.code}`);
        check('k', tooLarge.global === 10006 || tooLarge.code === 10006, '超出 uint32 的 id 让整个子请求 10006');

        const noTypes = summarize(await send(trackInfo({ ids: [SUNNY.id] })));
        console.log(`    没有 types：全局 ${noTypes.global}，子请求 ${noTypes.code}`);
        check('k', noTypes.global === 103901 || noTypes.code === 103901, '没有 types 回 103901');

        const stringIds = summarize(await send(trackInfo({ ids: [String(SUNNY.id)], types: [0] })));
        console.log(`    字符串 id：全局 ${stringIds.global}，子请求 ${stringIds.code}`);
        check('k', stringIds.global === 10006 || stringIds.code === 10006, '字符串 id 回 10006');
    },

    async l() {
        header('l', '本机调 api/lyric-proxy.js 的 handler（Vercel / Docker 的中转，假的 req / res，POST 对象正文）');
        if (options.relay) {
            console.log('  跳过：加了 --relay，各条已经经那个中转发出');
            return;
        }
        const { default: handler } = await import(new URL('../../api/lyric-proxy.js', import.meta.url).href);
        const body = { comm: COMM, req_0: detailById(SUNNY.id) };
        const captured = { headers: {}, status: 0, sent: null };
        const res = {
            setHeader: (key, value) => { captured.headers[key.toLowerCase()] = value; },
            status: (code) => { captured.status = code; return res; },
            send: (value) => { captured.sent = value; return res; },
            json: (value) => { captured.sent = Buffer.from(JSON.stringify(value)); return res; },
            end: () => res,
        };
        requestCount += 1;
        const started = Date.now();
        await handler({
            method: 'POST',
            query: { url: MUSICU_URL },
            headers: { 'content-type': 'application/json' },
            body,
        }, res);
        const text = captured.sent ? Buffer.from(captured.sent).toString('utf8') : '';
        let parsed = null;
        try {
            parsed = JSON.parse(text);
        } catch {
            parsed = null;
        }
        console.log(`  HTTP ${captured.status}，${captured.headers['content-type']}，${Date.now() - started} ms，req_0 ${describeNode(parsed?.req_0)}`);
        check('l', captured.status === 200 && parsed?.req_0?.code === 0 && midOf(parsed?.req_0) === SUNNY.mid, '经中转能读出 JSON、req_0 code 0、mid 一致');
    },

    async m() {
        header('m', '并发 2 × 25 三轮；并发 8 × 25 一次');
        const batch = (offset) => keyed(Array.from({ length: 25 }, (_, index) => detailById(SUNNY.id + offset + index)));
        const allZero = (answer) => answer.status === 200 && answer.body?.code === 0
            && Array.from({ length: 25 }, (_, index) => answer.body?.[`q${index}`]?.code).every(code => code === 0);
        let ok = true;
        for (let round = 0; round < 3; round += 1) {
            const started = Date.now();
            const answers = await Promise.all([0, 1].map(lane => send(batch((round * 2 + lane) * 25))));
            const zero = answers.every(allZero);
            ok &&= zero;
            console.log(`    2 × 25 第 ${round + 1} 轮：${Date.now() - started} ms，${answers.map(answer => `HTTP ${answer.status} code ${answer.body?.code}`).join('；')}${zero ? '' : '（有非 0）'}`);
        }
        const started = Date.now();
        const answers = await Promise.all(Array.from({ length: 8 }, (_, lane) => send(batch(lane * 25))));
        const zero = answers.every(allZero);
        ok &&= zero;
        console.log(`    8 × 25：${Date.now() - started} ms，${answers.map(answer => `${answer.status}/${answer.body?.code}`).join(' ')}${zero ? '' : '（有非 0）'}`);
        check('m', ok, '都 HTTP 200、code 0，各子请求 code 0');
    },
};

console.log(`QQ musicu 单曲详情探针：${options.relay ? `经 ${requestUrl}` : `直发 ${MUSICU_URL}`}，${new Date().toISOString()}`);
for (const [item, run] of Object.entries(items)) {
    if (options.only && !options.only.has(item)) continue;
    try {
        await run();
    } catch (error) {
        console.log(`  不符：请求失败`, error);
        mismatches.push(`${item}: ${error?.message ?? error}`);
    }
}

console.log(`\n共发 ${requestCount} 个请求。${mismatches.length === 0 ? '全部符合规格 §3。' : `${mismatches.length} 处不符：`}`);
mismatches.forEach(line => console.log(`  - ${line}`));
if (mismatches.length > 0) process.exitCode = 1;
