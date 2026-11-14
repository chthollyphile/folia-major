#!/usr/bin/env node
// test/manual/fakeSourceNetwork/fakeSourceNetwork.mjs
// 桌面实测用的假平台网络（Folium 2.0 S5 起，迁一家音源时用）：音源模组照常请求真实地址，只把网络换掉。
//
// 起一个本机 HTTP 代理，只接一张路由表（<平台>.mjs）里列的域名：对它们的 CONNECT 在本机终止 TLS（一张现做的自签证书），
// 交给路由表回假应答；别的域名 PAC 直连，不经过这里。装到 Electron 默认会话上用驱动的 main-eval（install.js），
// 不改任何启动参数、不改 sources/、src/、electron/：
//   - session.defaultSession.setProxy({ pacScript })：只有表里的域名走本代理（主进程 api.net 与窗口里的请求都在默认会话上）；
//   - session.defaultSession.setCertificateVerifyProc：只对表里的域名、并且签发者正是这张证书时放行，别的照 Chromium 自己的结果。
// 每个请求记一行 JSON 到 <out>/requests.jsonl（方法、域名、路径、查询、uid/token 请求头、正文），用来确认请求真的到了这里。
//
//   node test/manual/fakeSourceNetwork/fakeSourceNetwork.mjs bodian [--out <目录>] [--port <端口>]
//
// 然后（另一个终端）：
//   node skills/run-desktop/driver.mjs main-eval "$(cat <out>/install.js)"
//   node skills/run-desktop/driver.mjs main-eval "$(cat <out>/uninstall.js)"
// 控制：GET http://127.0.0.1:<端口>/__control/<动作>（路由表自己定义，例如 bodian 的 scan）。
// 证书用 openssl 现做（Git Bash 自带），放在 <out>/。用法与注意见同目录 README.md。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CERT_NAME = 'folia-fake-source-network';

const parseArgs = (argv) => {
    const [routesName, ...rest] = argv;
    const flag = (name, fallback) => {
        const index = rest.indexOf(name);
        return index >= 0 ? rest[index + 1] : fallback;
    };
    if (!routesName) throw new Error('usage: fakeSourceNetwork.mjs <routes, e.g. bodian> [--out dir] [--port n]');
    return { routesName, out: path.resolve(flag('--out', path.join(os.tmpdir(), `folia-fake-${routesName}`))), port: Number(flag('--port', 0)) };
};

const makeCertificate = (out, hosts) => {
    const key = path.join(out, 'key.pem');
    const cert = path.join(out, 'cert.pem');
    execFileSync('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-keyout', key, '-out', cert,
        '-subj', `/CN=${CERT_NAME}`, '-addext', `subjectAltName=${hosts.map((host) => `DNS:${host}`).join(',')}`,
    ], { stdio: 'ignore' });
    return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
};

const readBody = (request) => new Promise((resolve) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
});

const main = async () => {
    const { routesName, out, port } = parseArgs(process.argv.slice(2));
    const routes = (await import(pathToFileURL(path.join(HERE, `${routesName}.mjs`)).href)).default;
    fs.mkdirSync(out, { recursive: true });
    const log = path.join(out, 'requests.jsonl');
    fs.writeFileSync(log, '');
    const state = routes.createState();
    const tlsOptions = makeCertificate(out, routes.hosts);

    const answer = async (request, response) => {
        const body = await readBody(request);
        const host = String(request.headers.host ?? '').split(':')[0];
        const url = new URL(request.url, `https://${host}`);
        const entry = {
            at: new Date().toISOString(), method: request.method, host, path: url.pathname,
            query: Object.fromEntries(url.searchParams), uid: request.headers.uid ?? null, token: request.headers.token ?? null,
            range: request.headers.range ?? null, origin: request.headers.origin ?? null,
            body: body.length ? body.toString('utf8').slice(0, 2000) : null,
        };
        let result;
        try {
            result = routes.handle({ host, url, method: request.method, headers: request.headers, body, state });
        } catch (error) {
            result = { status: 500, body: { error: String(error) } };
        }
        result ??= { status: 404, body: { code: 404, msg: 'fake route missing' } };
        entry.status = result.status ?? 200;
        fs.appendFileSync(log, `${JSON.stringify(entry)}\n`);
        console.log(`[fake] ${entry.method} ${host}${entry.path} → ${entry.status}${entry.token ? ' (token)' : ''}`);
        const payload = Buffer.isBuffer(result.body) ? result.body : Buffer.from(JSON.stringify(result.body ?? null));
        response.writeHead(entry.status, { 'content-type': 'application/json;charset=utf-8', ...(result.headers ?? {}), 'content-length': payload.length });
        response.end(payload);
    };
    const tlsServer = https.createServer(tlsOptions, (request, response) => { void answer(request, response); });

    const proxy = http.createServer((request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1');
        if (url.pathname === '/proxy.pac') {
            const hosts = JSON.stringify(routes.hosts);
            response.writeHead(200, { 'content-type': 'application/x-ns-proxy-autoconfig' });
            response.end(`function FindProxyForURL(url, host) { return ${hosts}.indexOf(host) >= 0 ? 'PROXY 127.0.0.1:${proxy.address().port}' : 'DIRECT'; }`);
            return;
        }
        const control = /^\/__control\/([\w-]+)$/.exec(url.pathname);
        if (control) {
            const result = routes.control?.[control[1]]?.(state, Object.fromEntries(url.searchParams));
            response.writeHead(result === undefined ? 404 : 200, { 'content-type': 'application/json' });
            response.end(JSON.stringify(result ?? { error: 'no such control' }));
            console.log(`[fake] control ${control[1]}`);
            return;
        }
        response.writeHead(404);
        response.end();
    });
    proxy.on('connect', (request, socket) => {
        const [host] = String(request.url).split(':');
        if (!routes.hosts.includes(host)) {
            socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
            return;
        }
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        tlsServer.emit('connection', socket);
    });
    await new Promise((resolve) => proxy.listen(port, '127.0.0.1', resolve));
    const actualPort = proxy.address().port;

    // What main-eval runs (the driver wraps it as `return (async () => (<expression>))()`, with `electron` in scope).
    const hostsJson = JSON.stringify(routes.hosts);
    fs.writeFileSync(path.join(out, 'install.js'), `(async () => { const s = electron.session.defaultSession; const hosts = ${hostsJson}; `
        + `s.setCertificateVerifyProc((request, callback) => callback(hosts.includes(request.hostname) && request.certificate.issuerName === '${CERT_NAME}' ? 0 : -3)); `
        + `await s.setProxy({ mode: 'pac_script', pacScript: 'http://127.0.0.1:${actualPort}/proxy.pac' }); await s.forceReloadProxyConfig(); await s.closeAllConnections(); `
        + `return { proxy: await s.resolveProxy('https://${routes.hosts[0]}/'), direct: await s.resolveProxy('https://example.com/') }; })()`);
    fs.writeFileSync(path.join(out, 'uninstall.js'), '(async () => { const s = electron.session.defaultSession; s.setCertificateVerifyProc(null); '
        + "await s.setProxy({ mode: 'system' }); await s.forceReloadProxyConfig(); await s.closeAllConnections(); return 'restored'; })()");
    console.log(`[fake] ${routesName}: proxy on 127.0.0.1:${actualPort}, hosts ${routes.hosts.join(', ')}`);
    console.log(`[fake] install: node skills/run-desktop/driver.mjs main-eval "$(cat ${path.relative(process.cwd(), path.join(out, 'install.js')).replaceAll('\\', '/')})"`);
    console.log(`[fake] log: ${log}`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
