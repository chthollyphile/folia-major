import dns from 'node:dns';
import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// test/unit/electron/upstreamAddressOrder.test.ts
// 网易云工作线程先试 IPv4（#1068）：设到的值、只影响本线程，以及 IPv6 上请求途中被重置时真的绕开它。

const require = createRequire(import.meta.url);
const modulePath = require.resolve('../../../electron/netease/upstreamAddressOrder.cjs');
const { UPSTREAM_RESULT_ORDER, preferIpv4Upstream } = require(modulePath) as {
    UPSTREAM_RESULT_ORDER: string;
    preferIpv4Upstream: (options?: { dnsModule?: unknown; logger?: unknown }) => void;
};

type WorkerAnswer = { order: string; status?: number; family?: string; error?: string };

// 在一个新线程里（像网易云工作线程那样）按需调 preferIpv4Upstream，再用每次新建的 keep-alive agent
// （上游 util/request 的做法）向 http://localhost:<port>/ 发一个 POST。
const requestFromWorker = (port: number, preferIpv4: boolean) => new Promise<WorkerAnswer>((resolve, reject) => {
    const worker = new Worker(`
        const http = require('http');
        const dns = require('dns');
        const { parentPort, workerData } = require('worker_threads');
        if (workerData.preferIpv4) {
            require(workerData.modulePath).preferIpv4Upstream({ logger: { log() {} } });
        }
        const order = dns.getDefaultResultOrder();
        const req = http.request({
            host: 'localhost',
            port: workerData.port,
            method: 'POST',
            agent: new http.Agent({ keepAlive: true }),
        }, (res) => {
            res.resume();
            res.on('end', () => parentPort.postMessage({ order, status: res.statusCode, family: req.socket.remoteFamily }));
        });
        req.on('error', (error) => parentPort.postMessage({ order, error: error.code || error.message }));
        req.end('id=1');
    `, { eval: true, workerData: { port, preferIpv4, modulePath } });
    worker.once('message', (answer: WorkerAnswer) => {
        void worker.terminate();
        resolve(answer);
    });
    worker.once('error', reject);
});

describe('preferIpv4Upstream', () => {
    it('sets the ipv4first order and logs the decision', () => {
        const dnsModule = { getDefaultResultOrder: vi.fn(() => 'verbatim'), setDefaultResultOrder: vi.fn() };
        const logger = { log: vi.fn() };

        preferIpv4Upstream({ dnsModule, logger });

        expect(UPSTREAM_RESULT_ORDER).toBe('ipv4first');
        expect(dnsModule.setDefaultResultOrder).toHaveBeenCalledWith('ipv4first');
        expect(logger.log).toHaveBeenCalledWith('[Netease API] upstream address order set to ipv4first (was verbatim)');
    });

    describe('in a worker thread, when IPv6 resets the request after the handshake', () => {
        // 同一个端口上：::1 接受连接、收到请求后重置（#1068 的 read ECONNRESET），127.0.0.1 正常回 200。
        let ipv4Server: http.Server;
        let ipv6Server: http.Server | null = null;
        let port = 0;
        let localhostHasBothFamilies = false;

        beforeAll(async () => {
            ipv4Server = http.createServer((_req, res) => res.end('ok'));
            await new Promise<void>(resolve => ipv4Server.listen(0, '127.0.0.1', resolve));
            port = (ipv4Server.address() as AddressInfo).port;

            const resetting = http.createServer((req) => {
                req.on('data', () => {});
                req.on('end', () => (req.socket as Socket).resetAndDestroy());
            });
            const bound = await new Promise<boolean>((resolve) => {
                resetting.once('error', () => resolve(false));
                resetting.listen(port, '::1', () => resolve(true));
            });
            if (bound) ipv6Server = resetting;

            const addresses = await dns.promises.lookup('localhost', { all: true });
            localhostHasBothFamilies = addresses.some(entry => entry.family === 4) && addresses.some(entry => entry.family === 6);
        });

        afterAll(async () => {
            await new Promise<void>(resolve => ipv4Server.close(() => resolve()));
            if (ipv6Server) await new Promise<void>(resolve => ipv6Server!.close(() => resolve()));
        });

        it('connects over IPv4 and leaves the main thread order alone', async (context) => {
            // 本机没有 IPv6 回环或 localhost 只解析出一种地址时，模拟不出这个场景。
            if (!ipv6Server || !localhostHasBothFamilies) context.skip();
            const mainOrderBefore = dns.getDefaultResultOrder();

            const answer = await requestFromWorker(port, true);

            expect(answer).toEqual({ order: 'ipv4first', status: 200, family: 'IPv4' });
            expect(dns.getDefaultResultOrder()).toBe(mainOrderBefore);
        });

        it('reproduces the reset when the system order puts IPv6 first', async (context) => {
            if (!ipv6Server || !localhostHasBothFamilies) context.skip();
            const [first] = await dns.promises.lookup('localhost', { all: true, order: 'verbatim' });
            // 系统把 127.0.0.1 排在前面（多数 Linux），默认顺序本来就走 IPv4，这条对照没有意义。
            if (first.family !== 6) context.skip();

            const answer = await requestFromWorker(port, false);

            expect(answer.error).toBe('ECONNRESET');
        });
    });

    it('still falls back to IPv6 in a worker when IPv4 refuses the connection', async (context) => {
        // 只有 IPv6 的网络：127.0.0.1 上没人监听，autoSelectFamily 接着试 ::1。
        const ipv6Only = http.createServer((_req, res) => res.end('ok'));
        const bound = await new Promise<boolean>((resolve) => {
            ipv6Only.once('error', () => resolve(false));
            ipv6Only.listen(0, '::1', () => resolve(true));
        });
        if (!bound) context.skip();
        try {
            const addresses = await dns.promises.lookup('localhost', { all: true });
            if (!addresses.some(entry => entry.family === 6)) context.skip();

            const answer = await requestFromWorker((ipv6Only.address() as AddressInfo).port, true);

            expect(answer).toEqual({ order: 'ipv4first', status: 200, family: 'IPv6' });
        } finally {
            await new Promise<void>(resolve => ipv6Only.close(() => resolve()));
        }
    });
});
