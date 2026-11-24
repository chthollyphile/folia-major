/**
 * @name Folia 恶意脚本样例（只给实测用）
 * @description 自己写的样例：试着摸宿主、读凭据、连本机和内网，把结果交回本机的假服务
 * @version 1.0.0
 * @author folia-test
 */
// test/manual/fakeSourceNetwork/lxmusic/malicious-source.js
// 桌面实测时导入的恶意脚本样例。它在导入（初始化）时就把能想到的路都试一遍，结果 POST 给本机假服务的 /lx/report
// （放行的只有 127.0.0.1:39877），用 http://127.0.0.1:39877/__control/state 看。期望：
//   - page 一节全是 false / 'undefined' / 被拦：没有 window.electron、require、process，没有 cookie，页面自己发的请求出不去；
//   - egress 一节每一条都是 blocked: true，原因里只有种类，不带主机名和解析出的地址；
//   - 屏幕上不出现任何消息框、打印窗口、「另存为」，也没有声音；
//   - 假服务另开的 127.0.0.1:39878（「内网里的秘密」）上一个连接都没有（state.secretHits 为空）。
// 它不含任何真实攻击手法以外的东西，目标全是本机和保留地址。
const { EVENT_NAMES, request, on, send } = globalThis.lx;

const REPORT = 'http://127.0.0.1:39877/lx/report';
const JUMP = 'http://127.0.0.1:39877/lx/redirect?to=';
const SECRET = 39878;

const lxRequest = (url, options) => new Promise((resolve) => {
    try {
        request(url, { timeout: 5000, ...(options || {}) }, (error, response) => {
            if (error) return resolve({ blocked: true, error: String(error.message || error) });
            resolve({ blocked: false, status: response.statusCode, body: String(typeof response.body === 'string' ? response.body : JSON.stringify(response.body)).slice(0, 80) });
        });
    } catch (error) {
        resolve({ blocked: true, error: `threw: ${String(error && error.message)}` });
    }
});

const attempt = async (work) => {
    try {
        return await work();
    } catch (error) {
        return `blocked: ${String(error && error.message ? error.message : error).slice(0, 120)}`;
    }
};

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((resolve) => { setTimeout(() => resolve('blocked: timed out'), ms); })]);

const pageProbes = async () => ({
    windowElectron: typeof globalThis.electron,
    windowFolium: typeof globalThis.folium,
    require: typeof globalThis.require,
    process: typeof globalThis.process,
    nodeBuffer: typeof globalThis.Buffer,
    module: typeof globalThis.module,
    // 运行环境自己的入口不算秘密，但记一笔它长什么样。
    lxHost: typeof globalThis.__lxHost,
    cookie: await attempt(() => document.cookie),
    localStorage: await attempt(() => { localStorage.setItem('probe', '1'); return `readable: ${localStorage.length} keys`; }),
    indexedDB: await attempt(() => typeof indexedDB),
    location: await attempt(() => location.href),
    // 页面自己发请求（不经 lx.request）：CSP 的 connect-src 只许沙箱自己的假源，分区的 http(s) 也全由本地应答。
    fetchSecret: await withTimeout(attempt(async () => `reached: ${(await fetch(`http://127.0.0.1:${SECRET}/from-page-fetch`)).status}`), 4000),
    fetchPublic: await withTimeout(attempt(async () => `reached: ${(await fetch('https://example.com/')).status}`), 4000),
    xhrSecret: await withTimeout(attempt(() => new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', `http://127.0.0.1:${SECRET}/from-page-xhr`);
        xhr.onload = () => resolve(`reached: ${xhr.status}`);
        xhr.onerror = () => reject(new Error('xhr error'));
        xhr.send();
    })), 4000),
    imageSecret: await withTimeout(attempt(() => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve('reached: loaded');
        image.onerror = () => reject(new Error('image error'));
        image.src = `http://127.0.0.1:${SECRET}/from-page-image`;
    })), 4000),
    webSocketSecret: await withTimeout(attempt(() => new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${SECRET}/from-page-ws`);
        socket.onopen = () => resolve('reached: open');
        socket.onerror = () => reject(new Error('websocket error'));
    })), 4000),
    beaconSecret: await attempt(() => (navigator.sendBeacon(`http://127.0.0.1:${SECRET}/from-page-beacon`, 'x') ? 'queued (see secretHits)' : 'blocked: refused')),
    windowOpen: await attempt(() => { const opened = window.open(`http://127.0.0.1:${SECRET}/from-window-open`); return opened ? 'reached: opened' : 'blocked: null'; }),
    iframeSecret: await withTimeout(attempt(() => new Promise((resolve) => {
        const frame = document.createElement('iframe');
        frame.onload = () => resolve('loaded (see secretHits)');
        frame.src = `http://127.0.0.1:${SECRET}/from-iframe`;
        document.documentElement.appendChild(frame);
    })), 4000),
    navigate: await attempt(() => { location.href = `http://127.0.0.1:${SECRET}/from-navigation`; return 'assigned (see secretHits)'; }),
    // 以应用的名义弹原生窗口、弹「另存为」：CSP 的 sandbox 指令和分区上的 will-download 要拦住（拦住时这几项立刻返回）。
    alert: await withTimeout(attempt(() => { const before = Date.now(); alert('Folia: your sign-in expired'); return `returned after ${Date.now() - before} ms`; }), 4000),
    confirm: await withTimeout(attempt(() => `returned ${String(confirm('Folia: install the update?'))}`), 4000),
    print: await withTimeout(attempt(() => { print(); return 'returned'; }), 4000),
    download: await attempt(() => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob(['not a real update']));
        link.download = 'Folia-update.exe';
        link.click();
        return 'clicked (no save dialog may appear)';
    }),
    formSubmit: await attempt(() => {
        const form = document.createElement('form');
        form.action = `http://127.0.0.1:${SECRET}/from-form`;
        form.method = 'POST';
        document.documentElement.appendChild(form);
        form.submit();
        return 'submitted (see secretHits)';
    }),
    sound: await attempt(() => { const context = new AudioContext(); const tone = context.createOscillator(); tone.connect(context.destination); tone.start(); tone.stop(context.currentTime + 0.2); return `state ${context.state} (the window is muted)`; }),
    webRtc: await attempt(() => { const peer = new RTCPeerConnection({ iceServers: [] }); peer.close(); return 'reached: RTCPeerConnection constructed'; }),
    worker: await withTimeout(attempt(() => new Promise((resolve, reject) => {
        const worker = new Worker(URL.createObjectURL(new Blob([`fetch('http://127.0.0.1:${SECRET}/from-worker').then(r => postMessage('reached: ' + r.status), e => postMessage('blocked: ' + e.message))`])));
        worker.onmessage = (event) => resolve(event.data);
        worker.onerror = () => reject(new Error('worker error'));
    })), 4000),
});

const egressProbes = async () => ({
    loopback: await lxRequest(`http://127.0.0.1:${SECRET}/lx-request`),
    localhost: await lxRequest(`http://localhost:${SECRET}/lx-request`),
    ipv6Loopback: await lxRequest(`http://[::1]:${SECRET}/lx-request`),
    mappedLoopback: await lxRequest(`http://[::ffff:127.0.0.1]:${SECRET}/lx-request`),
    mappedHex: await lxRequest(`http://[::ffff:7f00:1]:${SECRET}/lx-request`),
    decimal: await lxRequest(`http://2130706433:${SECRET}/lx-request`),
    hex: await lxRequest(`http://0x7f.0.0.1:${SECRET}/lx-request`),
    shortForm: await lxRequest(`http://127.1:${SECRET}/lx-request`),
    zero: await lxRequest(`http://0.0.0.0:${SECRET}/lx-request`),
    otherPortSameHost: await lxRequest('http://127.0.0.1:1/lx-request'),
    privateA: await lxRequest('http://10.0.0.1/'),
    privateB: await lxRequest('http://172.16.0.1/'),
    privateC: await lxRequest('http://192.168.1.1/'),
    carrierNat: await lxRequest('http://100.64.0.1/'),
    linkLocalMetadata: await lxRequest('http://169.254.169.254/latest/meta-data/'),
    uniqueLocal: await lxRequest('http://[fd00::1]/'),
    linkLocalV6: await lxRequest('http://[fe80::1]/'),
    nat64: await lxRequest('http://[64:ff9b::7f00:1]/'),
    bareName: await lxRequest('http://router/'),
    dotLocal: await lxRequest('http://nas.local/'),
    // 公开的名字解析到回环：按解析出的地址判。
    nameToLoopback: await lxRequest(`http://localtest.me:${SECRET}/lx-request`),
    file: await lxRequest('file:///C:/Windows/win.ini'),
    foliaMod: await lxRequest('folia-mod://lxmusic/_media/stream/kw/320k/1'),
    credentialsInUrl: await lxRequest(`http://user:pass@127.0.0.1:${SECRET}/lx-request`),
    // 从放行的地址跳去不放行的：每一跳都要重新判。
    redirectToLoopback: await lxRequest(`${JUMP}${encodeURIComponent(`http://127.0.0.1:${SECRET}/after-redirect`)}`),
    redirectToMapped: await lxRequest(`${JUMP}${encodeURIComponent(`http://[::ffff:127.0.0.1]:${SECRET}/after-redirect`)}`),
    redirectToPrivate: await lxRequest(`${JUMP}${encodeURIComponent('http://192.168.1.1/after-redirect')}`),
    redirectToFile: await lxRequest(`${JUMP}${encodeURIComponent('file:///C:/Windows/win.ini')}`),
    // fake-ip 的占位地址只该来自解析：字面写它的是想连 TUN 网卡自己。
    fakeIpLiteral: await lxRequest(`http://198.18.0.1:${SECRET}/lx-request`),
    // 不该用 HTTP 去碰的端口。
    smtpPort: await lxRequest('http://example.com:25/'),
    // 一个巨大的请求正文：不该被读进主进程。
    hugeBody: await lxRequest('http://127.0.0.1:39877/lx/report', { method: 'POST', body: 'x'.repeat(6 * 1024 * 1024) }),
    // 想冒充别的主机、带上别人的凭据。
    hostHeader: await lxRequest(`http://127.0.0.1:${SECRET}/lx-request`, { headers: { Host: 'example.com' } }),
});

on(EVENT_NAMES.request, async ({ info }) => {
    // 取地址时再交一个内网地址：音频那条路也要拦住（播放器拿不到声音，39878 上也没有连接）。
    if (info && info.musicInfo && info.musicInfo.songmid === '900002') return 'http://192.168.1.1/secret.mp3';
    return `http://127.0.0.1:${SECRET}/secret.mp3`;
});

send(EVENT_NAMES.inited, {
    sources: { kw: { name: 'kw', type: 'music', actions: ['musicUrl'], qualitys: ['128k', '320k'] } },
});

(async () => {
    const egress = await egressProbes();
    // navigate 那一项会试着把页面带走，放最后。
    const page = await pageProbes();
    request(REPORT, { method: 'POST', body: { at: new Date().toISOString(), page, egress }, timeout: 10000 }, () => undefined);
})();
