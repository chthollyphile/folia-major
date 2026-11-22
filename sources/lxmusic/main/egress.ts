import * as dns from 'node:dns';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as os from 'node:os';
import * as zlib from 'node:zlib';
import type { LookupAddress } from 'node:dns';
import type { IncomingMessage } from 'node:http';
import type { Readable } from 'node:stream';
import { addressBlockReason, hostnameBlockReason, isIpLiteral } from './egressGuard.ts';
import type { EgressBlockReason } from './egressGuard.ts';

// sources/lxmusic/main/egress.ts
// 受控出口：第三方脚本的 lx.request 和它给的音频地址只从这里出去。用 Node 的 http / https，不用 Electron 的
// net：要自己拿到「解析出的地址」再决定连不连（net 把解析藏在 Chromium 里），代价是不跟系统代理。
//   - 只许 http(s)；主机名字面先判（localhost、.local、单段名字、字面 IP）；
//   - 解析走自己的 lookup：一个名字解析出的地址只要有一个是本机或内网的就整个拒绝，连的就是判过的那些地址，
//     没有「判一次、连的时候再解析一次」的空子；连上之后再核一遍对端地址；
//   - 跳转不自动跟：每一跳回到开头重新判，最多 MAX_REDIRECTS 跳；跨源的跳转不带凭据类的头；
//   - 这台机器自己的地址和它所在的在链子网也不许：公网 IPv6（没有 NAT，本机、路由器、NAS 各有一个）和直接拿到
//     公网 IPv4 的机器，地址不在任何保留段里，只能照网卡表判（localNetworkReason）；
//   - 一批不该用 HTTP 去碰的端口不许连（邮件、IRC 等，Chromium 也禁）；
//   - 每次新开连接（agent: false），不和别处共用连接池；有总时限，取整个回答时有大小上限。

const MAX_REDIRECTS = 8;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 调用方给不了的头：连接层的归 Node 管，host 与 content-length 由地址和正文决定。
const HOP_HEADERS = new Set([
    'host', 'content-length', 'connection', 'transfer-encoding', 'upgrade', 'keep-alive', 'te', 'trailer', 'expect',
    'proxy-authorization', 'proxy-connection',
]);
// 跨源跳转时拿掉的头。
const CREDENTIAL_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization']);

// Chromium 不许 HTTP 连的端口里常见的那些：往这些端口 POST 正文可以冒充别的协议。
const BLOCKED_PORTS = new Set([
    1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113,
    115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554,
    556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666,
    6667, 6668, 6669, 6697, 10080,
]);

// 代理软件 fake-ip 模式的占位地址段。解析出来的放行（egressGuard.ts 说了为什么），写在地址里的不放：占位地址只会
// 来自解析，字面写它的是想连 TUN 网卡自己（常见 198.18.0.1，就是这台机器）。
const FAKE_IP = new net.BlockList();
FAKE_IP.addSubnet('198.18.0.0', 15, 'ipv4');

/** 地址里的主机名，IPv6 去掉方括号。 */
const bareHost = (url: URL): string => (url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname);

const familyOf = (address: string): 'ipv4' | 'ipv6' | null => {
    const kind = net.isIP(address);
    return kind === 4 ? 'ipv4' : kind === 6 ? 'ipv6' : null;
};

/**
 * 按这台机器的网卡表判一个地址：是某块网卡自己的地址（'own-address'），或落在某块网卡的在链子网里（'on-link'）。
 * 地址在 fake-ip 段里的网卡（TUN）只算它自己的地址，不算整段，否则开着 TUN 的人一个名字都连不上。
 */
export const localNetworkReason = (address: string, interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>): EgressBlockReason | null => {
    const family = familyOf(address);
    if (!family) return null;
    const own = new net.BlockList();
    const onLink = new net.BlockList();
    for (const list of Object.values(interfaces)) {
        for (const info of list ?? []) {
            const kind = familyOf(info.address);
            if (!kind) continue;
            own.addAddress(info.address, kind);
            const prefix = Number((info.cidr ?? '').split('/')[1]);
            // 太宽的前缀（全隧道的 VPN 网卡有写 /0、/1 的）不当子网用，否则整个公网都不许了。
            if (!Number.isInteger(prefix) || prefix < (kind === 'ipv4' ? 8 : 16)) continue;
            if (kind === 'ipv4' && FAKE_IP.check(info.address, 'ipv4')) continue;
            try {
                onLink.addSubnet(info.address, prefix, kind);
            } catch {
                // 前缀不合法的网卡条目：只算它自己的地址。
            }
        }
    }
    if (own.check(address, family)) return 'own-address';
    if (onLink.check(address, family)) return 'on-link';
    return null;
};

/** 去处被拦。`reason` 是拦的原因，`host` 是被拦的主机名或地址。 */
export class EgressBlockedError extends Error {
    readonly reason: EgressBlockReason | 'protocol' | 'too-many-redirects';
    readonly host: string;
    constructor(reason: EgressBlockedError['reason'], host: string) {
        super(`egress blocked (${reason}): ${host}`);
        this.name = 'EgressBlockedError';
        this.reason = reason;
        this.host = host;
    }
}

export interface EgressRequest {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: Uint8Array | null;
    /** 整个请求（含跳转）的时限；取流时是到回答头为止的时限。 */
    timeoutMs?: number;
    signal?: AbortSignal;
}

export interface EgressAnswer {
    /** 跳转之后最终的地址。 */
    url: string;
    statusCode: number;
    statusMessage: string;
    /** 回答的头，名字小写；重复的头用 `, ` 接起来。 */
    headers: Record<string, string>;
}

export interface EgressOptions {
    /** 解析主机名；默认 dns.lookup（系统的解析）。测试里换成假的。 */
    lookup?: (hostname: string, options: dns.LookupAllOptions) => Promise<LookupAddress[]>;
    /**
     * 不判定就放行的 `主机:端口`。只给开发时的本机假服务用（main 入口只在没打包的应用里读环境变量给它），
     * 正式版里是空的。
     */
    allow?: (hostname: string, port: number) => boolean;
    /** 这台机器的网卡表；默认 os.networkInterfaces()。测试里换成假的。 */
    interfaces?: () => NodeJS.Dict<os.NetworkInterfaceInfo[]>;
    /**
     * 每一跳连出去之前过的闸（rateLimit.ts 的每秒请求数）：判定通过之后、解析和连接之前叫，轮到了才 resolve。
     * 没给就不限。
     */
    gate?: (hostname: string, signal: AbortSignal) => Promise<void>;
}

export interface Egress {
    /** 发请求、跟完跳转，回答的头和正文流（没解压，原样）。调用方读完或 destroy 这个流。 */
    open(request: EgressRequest): Promise<EgressAnswer & { stream: Readable }>;
    /** 发请求、跟完跳转、按 content-encoding 解压，把整个回答读进内存；超过 `maxBytes` 报错。 */
    fetchBytes(request: EgressRequest, maxBytes: number): Promise<EgressAnswer & { body: Buffer }>;
}

const systemLookup = (hostname: string, options: dns.LookupAllOptions): Promise<LookupAddress[]> => dns.promises.lookup(hostname, options);

const flattenHeaders = (headers: IncomingMessage['headers']): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
        if (value === undefined) continue;
        out[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
    }
    return out;
};

const cleanHeaders = (headers: Record<string, string> | undefined): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers ?? {})) {
        const lower = name.toLowerCase();
        // 头的名字和值里的换行会被 Node 拒绝（抛错）；这里先丢掉不合法的，不让一个坏头废掉整个请求。
        if (HOP_HEADERS.has(lower) || !/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(lower)) continue;
        if (typeof value !== 'string' || /[\r\n\0]/.test(value)) continue;
        out[lower] = value;
    }
    return out;
};

/** 建一个出口。 */
export const createEgress = ({ lookup = systemLookup, allow = () => false, interfaces = os.networkInterfaces, gate }: EgressOptions = {}): Egress => {
    const portOf = (url: URL) => Number(url.port || (url.protocol === 'https:' ? 443 : 80));

    /** 连之前就能判的那部分（协议、端口、主机名字面、字面地址）；不许就抛。解析之后的判定在 hop 里。 */
    const precheck = (url: URL): void => {
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new EgressBlockedError('protocol', url.protocol);
        const hostname = bareHost(url);
        const port = portOf(url);
        if (allow(hostname, port)) return;
        const literalFamily = familyOf(hostname);
        const network = literalFamily ? interfaces() : {};
        const reason = (BLOCKED_PORTS.has(port) ? 'port' : null)
            ?? hostnameBlockReason(hostname)
            ?? (literalFamily ? localNetworkReason(hostname, network) : null)
            ?? (literalFamily && FAKE_IP.check(hostname, literalFamily) ? 'reserved' : null);
        if (reason) throw new EgressBlockedError(reason, reason === 'port' ? `${hostname}:${port}` : hostname);
    };

    /** 一跳：判定、解析、连接，回这一跳的回答（不跟跳转）。 */
    const hop = (url: URL, method: string, headers: Record<string, string>, body: Uint8Array | null, signal: AbortSignal): Promise<IncomingMessage> => (
        new Promise((resolve, reject) => {
            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                reject(new EgressBlockedError('protocol', url.protocol));
                return;
            }
            const hostname = url.hostname.replace(/^\[|\]$/g, '');
            const port = portOf(url);
            const allowed = allow(hostname, port);
            // 每一跳读一次网卡表（网卡会变：连上 VPN、换了网络）。
            const network = allowed ? {} : interfaces();
            const addressReason = (address: string) => addressBlockReason(address) ?? localNetworkReason(address, network);
            if (!allowed) {
                const literalFamily = familyOf(hostname);
                const reason = (BLOCKED_PORTS.has(port) ? 'port' : null)
                    ?? hostnameBlockReason(hostname)
                    ?? (literalFamily ? localNetworkReason(hostname, network) : null)
                    ?? (literalFamily && FAKE_IP.check(hostname, literalFamily) ? 'reserved' : null);
                if (reason) {
                    reject(new EgressBlockedError(reason, reason === 'port' ? `${hostname}:${port}` : hostname));
                    return;
                }
            }
            // Node 对字面 IP 不调 lookup（上面已经判过）；别的名字都走这里，解析出的每个地址都要过判定。
            const guardedLookup = (
                name: string,
                options: dns.LookupOptions,
                callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
            ) => {
                lookup(name, { family: options.family, hints: options.hints, all: true }).then((addresses) => {
                    if (addresses.length === 0) {
                        callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${name}`), { code: 'ENOTFOUND' }), []);
                        return;
                    }
                    if (!allowed) {
                        for (const entry of addresses) {
                            const reason = addressReason(entry.address);
                            if (reason) {
                                callback(new EgressBlockedError(reason, `${name} → ${entry.address}`), []);
                                return;
                            }
                        }
                    }
                    if (options.all) callback(null, addresses);
                    else callback(null, addresses[0].address, addresses[0].family);
                }, (error: unknown) => { callback(error as NodeJS.ErrnoException, []); });
            };
            const transport = url.protocol === 'https:' ? https : http;
            const request = transport.request({
                protocol: url.protocol,
                hostname,
                port,
                path: `${url.pathname}${url.search}`,
                method,
                headers: { ...headers, ...(body ? { 'content-length': String(body.byteLength) } : {}) },
                agent: false,
                lookup: guardedLookup,
                signal,
                ...(url.protocol === 'https:' && !isIpLiteral(hostname) ? { servername: hostname } : {}),
            });
            request.on('socket', (socket) => {
                // 连上之后再核一遍：对端地址应该就是判过的那个。这只是事后的保险（这时请求可能已经发出去了），
                // 拦人的是上面连之前的判定。
                socket.once('connect', () => {
                    const remote = socket.remoteAddress;
                    const reason = allowed || !remote ? null : addressReason(remote);
                    if (reason) request.destroy(new EgressBlockedError(reason, `${hostname} → ${remote}`));
                });
            });
            request.on('response', resolve);
            request.on('error', reject);
            request.end(body ? Buffer.from(body.buffer, body.byteOffset, body.byteLength) : undefined);
        })
    );

    const open: Egress['open'] = async (input) => {
        const timeoutMs = Math.min(Math.max(Number(input.timeoutMs) || DEFAULT_TIMEOUT_MS, 1_000), MAX_TIMEOUT_MS);
        const controller = new AbortController();
        const abort = () => controller.abort(input.signal?.reason);
        if (input.signal?.aborted) abort();
        input.signal?.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(() => controller.abort(new Error('egress request timed out')), timeoutMs);
        try {
            let url = new URL(input.url);
            let method = (input.method || 'GET').toUpperCase();
            let headers = cleanHeaders(input.headers);
            let body = input.body && input.body.byteLength > 0 && method !== 'GET' && method !== 'HEAD' ? input.body : null;
            headers['user-agent'] ??= DEFAULT_USER_AGENT;
            if (!Object.hasOwn(headers, 'accept')) headers.accept = '*/*';
            for (let redirects = 0; ; redirects += 1) {
                // 地址里的账号密码不往外带（也不让它们混进主机名的判定）。
                url.username = '';
                url.password = '';
                url.hash = '';
                // 限速在判定之后：被拦的去处不占名额，跳转的每一跳各算一次。hop 里会再判一遍，这里先判是为了不让
                // 一个注定被拦的请求去排队。
                if (gate) {
                    precheck(url);
                    await gate(bareHost(url), controller.signal);
                }
                const response = await hop(url, method, headers, body, controller.signal);
                const status = response.statusCode ?? 0;
                const location = response.headers.location;
                if (![301, 302, 303, 307, 308].includes(status) || !location) {
                    return {
                        url: url.href,
                        statusCode: status,
                        statusMessage: response.statusMessage ?? '',
                        headers: flattenHeaders(response.headers),
                        stream: response,
                    };
                }
                response.destroy();
                if (redirects >= MAX_REDIRECTS) throw new EgressBlockedError('too-many-redirects', url.hostname);
                const next = new URL(location, url);
                if (status === 303 ? method !== 'HEAD' : (status === 301 || status === 302) && method === 'POST') {
                    method = 'GET';
                    body = null;
                    headers = Object.fromEntries(Object.entries(headers).filter(([name]) => !name.startsWith('content-')));
                }
                if (next.origin !== url.origin) {
                    headers = Object.fromEntries(Object.entries(headers).filter(([name]) => !CREDENTIAL_HEADERS.has(name)));
                }
                url = next;
            }
        } finally {
            // 回答头到手（或失败）之后时限就不再管：正文流的读取由调用方掌握。
            clearTimeout(timer);
            input.signal?.removeEventListener('abort', abort);
        }
    };

    const fetchBytes: Egress['fetchBytes'] = async (input, maxBytes) => {
        const timeoutMs = Math.min(Math.max(Number(input.timeoutMs) || DEFAULT_TIMEOUT_MS, 1_000), MAX_TIMEOUT_MS);
        const headers = { ...input.headers };
        if (!Object.keys(headers).some(name => name.toLowerCase() === 'accept-encoding')) headers['accept-encoding'] = 'gzip, deflate, br';
        const deadline = Date.now() + timeoutMs;
        const answer = await open({ ...input, headers, timeoutMs });
        const { stream, ...rest } = answer;
        const encoding = (rest.headers['content-encoding'] ?? '').trim().toLowerCase();
        const decoder = encoding === 'gzip' || encoding === 'x-gzip' ? zlib.createGunzip()
            : encoding === 'deflate' ? zlib.createInflate()
                : encoding === 'br' ? zlib.createBrotliDecompress()
                    : null;
        const source: Readable = decoder ? stream.pipe(decoder) : stream;
        const body = await new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            let size = 0;
            const fail = (error: Error) => {
                clearTimeout(timer);
                stream.destroy();
                decoder?.destroy();
                reject(error);
            };
            const timer = setTimeout(() => fail(new Error('egress request timed out')), Math.max(deadline - Date.now(), 1));
            const onAbort = () => fail(new Error('egress request aborted'));
            input.signal?.addEventListener('abort', onAbort, { once: true });
            source.on('data', (chunk: Buffer) => {
                size += chunk.length;
                if (size > maxBytes) fail(new Error(`egress answer larger than ${maxBytes} bytes`));
                else chunks.push(chunk);
            });
            source.on('end', () => {
                clearTimeout(timer);
                input.signal?.removeEventListener('abort', onAbort);
                resolve(Buffer.concat(chunks));
            });
            source.on('error', fail);
            if (decoder) stream.on('error', fail);
        });
        if (decoder) {
            delete rest.headers['content-encoding'];
            delete rest.headers['content-length'];
        }
        return { ...rest, body };
    };

    return { open, fetchBytes };
};
