import http from 'node:http';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEgress, EgressBlockedError } from '../../../sources/lxmusic/main/egress';

// test/unit/lxmusic/egress.test.ts
// 洛雪音源的受控出口：解析出本机或内网地址的名字连不上，跳转的每一跳都重新判，流式取地址跟得上跳转并带着 Range。
// 假的解析把几个名字指到本机的测试服务；`allow` 只放行「公网」那两个名字，别的名字照常判定（于是被拦）。

let server: http.Server;
let port = 0;
const seen: Array<{ host: string; method: string; url: string; headers: http.IncomingHttpHeaders; body: string }> = [];

const NAMES: Record<string, Array<{ address: string; family: number }>> = {
    'public.example': [{ address: '127.0.0.1', family: 4 }],
    'cdn.example': [{ address: '127.0.0.1', family: 4 }],
    'rebind.example': [{ address: '127.0.0.1', family: 4 }],
    'mapped.example': [{ address: '::ffff:127.0.0.1', family: 6 }],
    'nat.example': [{ address: '100.64.1.1', family: 4 }],
    'mixed.example': [{ address: '93.184.216.34', family: 4 }, { address: '192.168.1.10', family: 4 }],
    'metadata.example': [{ address: '169.254.169.254', family: 4 }],
};
const lookup = async (hostname: string) => {
    const found = NAMES[hostname];
    if (!found) throw Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
    return found;
};
const egress = () => createEgress({
    lookup,
    allow: (hostname, at) => (hostname === 'public.example' || hostname === 'cdn.example') && at === port,
});
const at = (host: string, path: string) => `http://${host}:${port}${path}`;

beforeAll(async () => {
    server = http.createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', chunk => chunks.push(chunk));
        request.on('end', () => {
            const url = new URL(request.url ?? '/', 'http://x');
            seen.push({ host: request.headers.host ?? '', method: request.method ?? '', url: request.url ?? '', headers: request.headers, body: Buffer.concat(chunks).toString() });
            if (url.pathname === '/redirect') {
                response.writeHead(Number(url.searchParams.get('status') ?? 302), { location: url.searchParams.get('to') ?? '/' });
                response.end();
            } else if (url.pathname === '/loop') {
                response.writeHead(302, { location: `/loop?n=${Number(url.searchParams.get('n') ?? 0) + 1}` });
                response.end();
            } else if (url.pathname === '/gzip') {
                response.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
                response.end(zlib.gzipSync(JSON.stringify({ hello: 'world' })));
            } else if (url.pathname === '/big') {
                response.writeHead(200, { 'content-type': 'application/octet-stream' });
                response.end(Buffer.alloc(64 * 1024, 1));
            } else if (url.pathname === '/audio') {
                const data = Buffer.from('0123456789');
                const range = /^bytes=(\d+)-(\d+)?$/.exec(request.headers.range ?? '');
                if (range) {
                    const start = Number(range[1]);
                    const end = range[2] ? Number(range[2]) : data.length - 1;
                    response.writeHead(206, { 'content-type': 'audio/mpeg', 'content-range': `bytes ${start}-${end}/${data.length}`, 'content-length': String(end - start + 1) });
                    response.end(data.subarray(start, end + 1));
                } else {
                    response.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': String(data.length) });
                    response.end(data);
                }
            } else {
                response.writeHead(200, { 'content-type': 'text/plain' });
                response.end('ok');
            }
        });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
});

const read = async (stream: NodeJS.ReadableStream): Promise<string> => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
    return Buffer.concat(chunks).toString();
};
const blocked = async (work: Promise<unknown>): Promise<EgressBlockedError> => {
    const error = await work.then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(EgressBlockedError);
    return error as EgressBlockedError;
};

describe('the controlled egress', () => {
    it('reaches a public name and reads the whole answer', async () => {
        const answer = await egress().fetchBytes({ url: at('public.example', '/hello') }, 1024);
        expect(answer.statusCode).toBe(200);
        expect(answer.body.toString()).toBe('ok');
        expect(seen.at(-1)?.host).toBe(`public.example:${port}`);
    });

    it('refuses the loopback and private addresses written in the address itself', async () => {
        const before = seen.length;
        for (const url of [
            `http://127.0.0.1:${port}/`, `http://localhost:${port}/`, `http://[::1]:${port}/`, `http://[::ffff:127.0.0.1]:${port}/`,
            `http://2130706433:${port}/`, `http://0x7f.0.0.1:${port}/`, 'http://192.168.1.1/', 'http://10.0.0.5/', 'http://100.64.0.1/',
            'http://169.254.169.254/latest/meta-data/', 'http://router/', 'http://nas.local/',
        ]) {
            await blocked(egress().fetchBytes({ url }, 1024));
        }
        expect(seen.length).toBe(before);
    });

    it('refuses a name that resolves to a local or private address, without connecting', async () => {
        const before = seen.length;
        expect((await blocked(egress().fetchBytes({ url: at('rebind.example', '/') }, 1024))).reason).toBe('loopback');
        expect((await blocked(egress().fetchBytes({ url: at('mapped.example', '/') }, 1024))).reason).toBe('loopback');
        expect((await blocked(egress().fetchBytes({ url: at('nat.example', '/') }, 1024))).reason).toBe('carrier-nat');
        expect((await blocked(egress().fetchBytes({ url: at('metadata.example', '/') }, 1024))).reason).toBe('link-local');
        expect(seen.length).toBe(before);
    });

    it('refuses a name when any one of its addresses is private', async () => {
        expect((await blocked(egress().fetchBytes({ url: at('mixed.example', '/') }, 1024))).reason).toBe('private');
    });

    it('refuses other protocols', async () => {
        expect((await blocked(egress().fetchBytes({ url: 'file:///etc/passwd' }, 1024))).reason).toBe('protocol');
        expect((await blocked(egress().fetchBytes({ url: 'ftp://public.example/' }, 1024))).reason).toBe('protocol');
    });

    it('judges every hop of a redirect anew', async () => {
        const before = seen.length;
        // public → 127.0.0.1 written out
        await blocked(egress().fetchBytes({ url: at('public.example', `/redirect?to=${encodeURIComponent(`http://127.0.0.1:${port}/secret`)}`) }, 1024));
        // public → a name that resolves to the loopback
        await blocked(egress().fetchBytes({ url: at('public.example', `/redirect?to=${encodeURIComponent(at('rebind.example', '/secret'))}`) }, 1024));
        // public → public → the IPv4-mapped loopback
        const second = at('cdn.example', `/redirect?to=${encodeURIComponent(`http://[::ffff:127.0.0.1]:${port}/secret`)}`);
        await blocked(egress().fetchBytes({ url: at('public.example', `/redirect?to=${encodeURIComponent(second)}`) }, 1024));
        // public → another protocol
        await blocked(egress().fetchBytes({ url: at('public.example', `/redirect?to=${encodeURIComponent('file:///etc/passwd')}`) }, 1024));
        expect(seen.slice(before).some(request => request.url.includes('/secret'))).toBe(false);
    });

    it('stops after too many redirects', async () => {
        expect((await blocked(egress().fetchBytes({ url: at('public.example', '/loop') }, 1024))).reason).toBe('too-many-redirects');
    });

    it('follows a redirect while streaming, with the Range header on every hop', async () => {
        const url = at('public.example', `/redirect?status=302&to=${encodeURIComponent(at('cdn.example', '/audio'))}`);
        const answer = await egress().open({ url, headers: { range: 'bytes=2-5', 'accept-encoding': 'identity' } });
        expect(answer.statusCode).toBe(206);
        expect(answer.url).toBe(at('cdn.example', '/audio'));
        expect(answer.headers['content-range']).toBe('bytes 2-5/10');
        expect(await read(answer.stream)).toBe('2345');
        expect(seen.at(-1)?.headers.range).toBe('bytes=2-5');
    });

    it('turns a POST into a GET on 303, keeps it on 307, and drops credentials across origins', async () => {
        await egress().fetchBytes({
            url: at('public.example', `/redirect?status=303&to=${encodeURIComponent(at('cdn.example', '/after'))}`),
            method: 'POST', headers: { cookie: 'a=b', authorization: 'Bearer x', 'content-type': 'text/plain' }, body: Buffer.from('payload'),
        }, 1024);
        const first = seen.at(-2)!;
        const after = seen.at(-1)!;
        expect(first.method).toBe('POST');
        expect(first.body).toBe('payload');
        expect(first.headers.cookie).toBe('a=b');
        expect(after.method).toBe('GET');
        expect(after.body).toBe('');
        expect(after.headers.cookie).toBeUndefined();
        expect(after.headers.authorization).toBeUndefined();
        expect(after.headers['content-type']).toBeUndefined();

        await egress().fetchBytes({
            url: at('public.example', `/redirect?status=307&to=${encodeURIComponent('/same-origin')}`),
            method: 'POST', headers: { cookie: 'a=b' }, body: Buffer.from('again'),
        }, 1024);
        expect(seen.at(-1)).toMatchObject({ method: 'POST', body: 'again' });
        expect(seen.at(-1)?.headers.cookie).toBe('a=b');
    });

    it('never sends the headers the caller may not set, nor the credentials of the address', async () => {
        await egress().fetchBytes({
            url: `http://user:secret@public.example:${port}/hello`,
            headers: { Host: 'evil.example', 'Content-Length': '999', Connection: 'upgrade', 'X-Ok': 'yes', 'Bad\r\nName': 'x', 'x-bad-value': 'a\r\nb' },
        }, 1024);
        const request = seen.at(-1)!;
        expect(request.host).toBe(`public.example:${port}`);
        expect(request.headers['x-ok']).toBe('yes');
        expect(request.headers['x-bad-value']).toBeUndefined();
        expect(request.headers.authorization).toBeUndefined();
        expect(request.headers['user-agent']).toMatch(/Mozilla/);
    });

    it('decodes a compressed answer and caps the size of what it reads', async () => {
        const answer = await egress().fetchBytes({ url: at('public.example', '/gzip') }, 1024);
        expect(JSON.parse(answer.body.toString())).toEqual({ hello: 'world' });
        expect(answer.headers['content-encoding']).toBeUndefined();
        await expect(egress().fetchBytes({ url: at('public.example', '/big') }, 1024)).rejects.toThrow(/larger than/);
    });

    it('lets nothing through without the development allowance: the fake resolver points at the loopback', async () => {
        const strict = createEgress({ lookup });
        expect((await blocked(strict.fetchBytes({ url: at('public.example', '/hello') }, 1024))).reason).toBe('loopback');
    });
});
