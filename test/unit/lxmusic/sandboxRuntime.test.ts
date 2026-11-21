import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { installLxRuntime } from '../../../sources/lxmusic/main/sandbox/runtime';
import type { LxTransport } from '../../../sources/lxmusic/main/sandbox/runtime';
import { lxUtils } from '../../../sources/lxmusic/main/sandbox/lxUtils';

// test/unit/lxmusic/sandboxRuntime.test.ts
// 沙箱页面里的洛雪运行环境：脚本拿到的 globalThis.lx、inited 的几种时机、request 回调的两种写法、lx.request 的回答
// 形状，以及 lx.utils 和 Node 自带实现对得上。这里直接在 Node 里跑它（它只用浏览器和 Node 都有的东西）。

const INFO = { name: 'test' };
const noTransport: LxTransport = async () => { throw new Error('no network in this test'); };

// 脚本读的是全局的 lx（回调里也会再读），所以运行环境直接装在真的 globalThis 上，和页面里一样。
const load = (script: string, transport: LxTransport = noTransport, timeoutMs = 200) => {
    const host = installLxRuntime(globalThis as Record<string, unknown>, transport);
    return { host, loading: host.load(script, INFO, timeoutMs) };
};

const SOURCES = "{ kw: { name: 'kw', type: 'music', actions: ['musicUrl'], qualitys: ['128k', '320k'] } }";

describe('the LX runtime of the sandbox page', () => {
    it('gives the script lx, and reads the platforms it declares with inited', async () => {
        const { loading } = load(`
            const { EVENT_NAMES, on, send, version, env, currentScriptInfo } = globalThis.lx;
            if (env !== 'desktop' || !version || currentScriptInfo.name !== 'test') throw new Error('bad lx');
            on(EVENT_NAMES.request, () => 'http://example.com/a.mp3');
            send(EVENT_NAMES.inited, { sources: ${SOURCES} });
        `);
        expect(await loading).toEqual({ sources: { kw: { name: 'kw', type: 'music', actions: ['musicUrl'], qualitys: ['128k', '320k'] } } });
    });

    it('waits for a script that sends inited later, and for one written with the obfuscated spelling of lx', async () => {
        const { loading } = load(`
            const lx = globalThis['\\x6c\\x78'];
            lx.on('request', async () => 'http://example.com/a.mp3');
            setTimeout(() => lx.send('inited', { sources: ${SOURCES} }), 30);
        `);
        expect(await loading).toMatchObject({ sources: { kw: {} } });
    });

    it('fails a script that throws, never sends inited, or registers no request handler', async () => {
        await expect(load('throw new Error("boom")').loading).rejects.toThrow(/the script threw: boom/);
        await expect(load('globalThis.lx.on("request", () => 1)', noTransport, 40).loading).rejects.toThrow(/did not send "inited"/);
        await expect(load(`globalThis.lx.send('inited', { sources: ${SOURCES} })`).loading).rejects.toThrow(/no "request" handler/);
        await expect(load('return Promise.reject(new Error("async boom"))', noTransport, 40).loading).rejects.toThrow(/async boom/);
    });

    const withHandler = async (handler: string, transport: LxTransport = noTransport) => {
        const { host, loading } = load(`
            globalThis.lx.on('request', ${handler});
            globalThis.lx.send('inited', { sources: ${SOURCES} });
        `, transport);
        await loading;
        return host;
    };
    const PAYLOAD = { source: 'kw', action: 'musicUrl', info: { type: '320k', musicInfo: { songmid: '42' } } };

    it('calls a handler that returns its answer, one that returns a promise, and one that calls back', async () => {
        expect(await (await withHandler('({ source, info }) => "http://example.com/" + source + "/" + info.musicInfo.songmid')).call(PAYLOAD, 500))
            .toBe('http://example.com/kw/42');
        expect(await (await withHandler('async ({ info }) => "http://example.com/" + info.type')).call(PAYLOAD, 500)).toBe('http://example.com/320k');
        expect(await (await withHandler('(payload, callback) => { setTimeout(() => callback(null, "http://example.com/cb"), 10); }')).call(PAYLOAD, 500))
            .toBe('http://example.com/cb');
        // async 包着的回调式写法：Promise 先 resolve 成 undefined，结果在后来的回调里。
        expect(await (await withHandler('async (payload, callback) => { setTimeout(() => callback(null, "http://example.com/late"), 10); }')).call(PAYLOAD, 500))
            .toBe('http://example.com/late');
    });

    it('rejects when the handler throws, calls back with an error, or never answers', async () => {
        await expect((await withHandler('() => { throw new Error("nope") }')).call(PAYLOAD, 500)).rejects.toThrow('nope');
        await expect((await withHandler('(payload, callback) => callback(new Error("refused"))')).call(PAYLOAD, 500)).rejects.toThrow('refused');
        await expect((await withHandler('() => new Promise(() => {})')).call(PAYLOAD, 40)).rejects.toThrow(/did not answer in time/);
    });

    it('answers lx.request with the status, headers, raw bytes and the body parsed as JSON where it is JSON', async () => {
        const asked: unknown[] = [];
        const transport: LxTransport = async (request) => {
            asked.push(request);
            return { statusCode: 200, statusMessage: 'OK', headers: { 'content-type': 'application/json' }, body: Buffer.from('{"code":200,"url":"http://example.com/x.mp3"}').toString('base64') };
        };
        const host = await withHandler(`(payload, callback) => {
            globalThis.lx.request('http://api.example.com/url', { method: 'post', headers: { 'X-A': 1 }, form: { id: payload.info.musicInfo.songmid }, timeout: 5000 }, (error, response, body) => {
                if (error) return callback(error);
                callback(null, response.statusCode === 200 && response.body.code === 200 && body === response.body && response.raw.length === response.bytes ? body.url : 'bad');
            });
        }`, transport);
        expect(await host.call(PAYLOAD, 500)).toBe('http://example.com/x.mp3');
        expect(asked).toEqual([{
            url: 'http://api.example.com/url', method: 'POST', timeoutMs: 5000,
            headers: { 'X-A': '1', 'content-type': 'application/x-www-form-urlencoded' },
            body: Buffer.from('id=42').toString('base64'),
        }]);
    });

    it('hands a failed lx.request to the callback as an error, once', async () => {
        const host = await withHandler(`(payload, callback) => {
            let calls = 0;
            globalThis.lx.request('http://127.0.0.1/', {}, (error) => { calls += 1; setTimeout(() => callback(null, String(error && error.message) + ':' + calls), 5); });
        }`, async () => { throw new Error('egress blocked (loopback): 127.0.0.1'); });
        expect(await host.call(PAYLOAD, 500)).toBe('egress blocked (loopback): 127.0.0.1:1');
    });
});

describe('lx.utils', () => {
    it('hashes like MD5', () => {
        for (const text of ['', 'abc', '洛雪音乐', 'a'.repeat(200)]) {
            expect(lxUtils.crypto.md5(text)).toBe(crypto.createHash('md5').update(text).digest('hex'));
        }
    });

    it('converts between text, hex and base64 like a Node Buffer', () => {
        const buffer = lxUtils.buffer.from('洛雪 LX', 'utf8');
        expect(buffer.toString('hex')).toBe(Buffer.from('洛雪 LX').toString('hex'));
        expect(buffer.toString('base64')).toBe(Buffer.from('洛雪 LX').toString('base64'));
        expect(lxUtils.buffer.from(Buffer.from('洛雪 LX').toString('base64'), 'base64').toString()).toBe('洛雪 LX');
        expect(lxUtils.buffer.bufToString(lxUtils.buffer.from('6c78', 'hex'), 'utf8')).toBe('lx');
    });

    it('encrypts AES-128-CBC and AES-128-ECB like Node', () => {
        const key = Buffer.from('0123456789abcdef');
        const iv = Buffer.from('fedcba9876543210');
        const text = 'a message longer than one block of sixteen bytes';
        const cbc = crypto.createCipheriv('aes-128-cbc', key, iv);
        expect(Buffer.from(lxUtils.crypto.aesEncrypt(text, 'aes-128-cbc', key, iv)).toString('hex'))
            .toBe(Buffer.concat([cbc.update(text), cbc.final()]).toString('hex'));
        const ecb = crypto.createCipheriv('aes-128-ecb', key, null);
        expect(Buffer.from(lxUtils.crypto.aesEncrypt(text, 'aes-128-ecb', key, '')).toString('hex'))
            .toBe(Buffer.concat([ecb.update(text), ecb.final()]).toString('hex'));
    });

    it('encrypts with an RSA public key without padding, like Node', () => {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
        const pem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
        const message = Buffer.alloc(128);
        Buffer.from('hello lx').copy(message, 128 - 8);
        const encrypted = Buffer.from(lxUtils.crypto.rsaEncrypt(message, pem));
        const decrypted = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_NO_PADDING }, encrypted);
        expect(decrypted.subarray(120).toString()).toBe('hello lx');
    });

    it('inflates and deflates zlib data, and inflates raw deflate too', async () => {
        const text = '洛雪 '.repeat(100);
        expect(Buffer.from(await lxUtils.zlib.inflate(zlib.deflateSync(text)) as Uint8Array).toString()).toBe(text);
        expect(Buffer.from(await lxUtils.zlib.inflate(zlib.deflateRawSync(text)) as Uint8Array).toString()).toBe(text);
        expect(zlib.inflateSync(Buffer.from(await lxUtils.zlib.deflate(lxUtils.buffer.from(text)) as Uint8Array)).toString()).toBe(text);
    });

    it('gives random bytes of the size asked, past the 65536 of one getRandomValues call', () => {
        expect(lxUtils.crypto.randomBytes(16)).toHaveLength(16);
        const large = lxUtils.crypto.randomBytes(70000);
        expect(large).toHaveLength(70000);
        expect(large.subarray(65536).some(byte => byte !== 0)).toBe(true);
    });
});
