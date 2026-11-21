/**
 * @name Folia 假音源（只给实测用）
 * @description 自己写的假脚本：向本机的假服务要地址。不是任何真实的洛雪自定义源
 * @version 1.0.0
 * @author folia-test
 */
// test/manual/fakeSourceNetwork/lxmusic/fake-source.js
// 桌面实测时导入的假脚本，写法照洛雪自定义源的接口（globalThis.lx）。它只认本机的假服务
// （test/manual/fakeSourceNetwork/lxmusic.mjs，必须起在 39877 端口），出不了这台机器。
const { EVENT_NAMES, request, on, send } = globalThis.lx;

const API = 'http://127.0.0.1:39877/lx/url';

const ask = (url) => new Promise((resolve, reject) => {
    request(url, { method: 'GET', timeout: 10000 }, (error, response) => {
        if (error) return reject(error);
        if (response.statusCode !== 200 || !response.body || response.body.code !== 200) {
            return reject(new Error((response.body && response.body.msg) || 'no url'));
        }
        resolve(response.body.url);
    });
});

on(EVENT_NAMES.request, ({ source, action, info }) => {
    if (action !== 'musicUrl') return Promise.reject(new Error('unsupported action'));
    const id = encodeURIComponent(info.musicInfo.songmid);
    return ask(`${API}?source=${source}&quality=${encodeURIComponent(info.type)}&id=${id}`);
});

send(EVENT_NAMES.inited, {
    openDevTools: false,
    sources: {
        kw: { name: 'kw', type: 'music', actions: ['musicUrl'], qualitys: ['128k', '320k'] },
    },
});
