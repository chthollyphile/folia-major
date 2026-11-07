'use strict';

const dgram = require('dgram');
const http = require('http');
const https = require('https');
const os = require('os');

// 局域网音响投送：SSDP 发现 DLNA / UPnP MediaRenderer。
// 安卓把这一步放在原生插件里（WebView 发不了 UDP 组播、读不了设备描述 XML），
// 桌面端则交给主进程：Node 的 dgram 能发组播，http/https 能取描述 XML。

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
const AV_TRANSPORT_PREFIX = 'urn:schemas-upnp-org:service:AVTransport';
// 三个搜索目标轮流发：有的设备只回 MediaRenderer，有的只在 ssdp:all 里露头。
const SEARCH_TARGETS = [
    'urn:schemas-upnp-org:device:MediaRenderer:1',
    'urn:schemas-upnp-org:service:AVTransport:1',
    'ssdp:all',
];
const SEARCH_ROUND_MS = 400;
const DESCRIPTION_TIMEOUT_MS = 5000;
// 设备描述一般几十 KB；限制一下，别让一台坏设备把内存吃满。
const DESCRIPTION_MAX_BYTES = 1024 * 1024;

const parseHeaders = text => {
    const headers = new Map();
    for (const line of text.split(/\r\n/)) {
        const colon = line.indexOf(':');
        if (colon <= 0) continue;
        headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
    }
    return headers;
};

const buildSearch = target => Buffer.from(
    `M-SEARCH * HTTP/1.1\r\n` +
    `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}\r\n` +
    `MAN: "ssdp:discover"\r\n` +
    `MX: 2\r\n` +
    `ST: ${target}\r\n` +
    `\r\n`,
    'utf8',
);

/** 本机的局域网 IPv4，优先 192.168 / 10. / 172.16-31 这类站点地址。 */
const subnetOf = value => String(value || '').replace(/^\[|\]$/g, '').split('.').slice(0, 3).join('.');
const isSiteLocal = address => address.startsWith('192.168.')
    || address.startsWith('10.')
    || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(address);

/**
 * 本机对局域网暴露的 IPv4。
 *
 * preferHost 传音响的地址：多网卡（VPN、Hyper-V、Docker、虚拟网卡）时，列表里第一个私网地址
 * 往往不是音响所在的那张网卡，音响拉过去会直接连不上。同 /24 网段优先命中。
 */
const lanIpv4 = (preferHost) => {
    const candidates = [];
    for (const [, addresses] of Object.entries(os.networkInterfaces())) {
        for (const address of addresses || []) {
            if (address.family !== 'IPv4' || address.internal) continue;
            if (!address.netmask) continue;
            candidates.push(address.address);
        }
    }
    const prefer = subnetOf(preferHost);
    if (prefer && prefer.split('.').length === 3) {
        const sameSubnet = candidates.find(address => subnetOf(address) === prefer);
        if (sameSubnet) return sameSubnet;
    }
    const siteLocal = candidates.find(isSiteLocal);
    if (siteLocal) return siteLocal;
    return candidates[0] || null;
};

const getJson = url => new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(url, {
        headers: { 'User-Agent': 'Folia/1.0 UPnP/1.0', Accept: '*/*' },
        timeout: DESCRIPTION_TIMEOUT_MS,
    }, response => {
        if (response.statusCode && response.statusCode >= 400) {
            response.resume();
            reject(new Error(`HTTP ${response.statusCode}`));
            return;
        }
        let received = 0;
        const chunks = [];
        response.on('data', chunk => {
            received += chunk.length;
            if (received > DESCRIPTION_MAX_BYTES) {
                request.destroy(new Error('description too large'));
                return;
            }
            chunks.push(chunk);
        });
        response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('description timeout')));
    request.on('error', reject);
});

const tagText = (xml, tag) => {
    // CDATA 包裹的标签（<![CDATA[...]]>）在部分设备描述里出现。方括号必须转义，
    // 否则 `[` 会开启字符类、把 `(?:` 分组吞进去，导致整条模式匹配不到任何标签。
    const match = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, 'i').exec(xml);
    return match ? match[1].trim() : '';
};

const decodeEntities = value => value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

/**
 * 设备描述里找 AVTransport 的 controlURL。
 * 必须限定在 <service> 块内匹配：MediaServer（NAS 之类）也会出现在 ssdp:all 里，
 * 但它没有 AVTransport，外面随便抓 controlURL 就会把它当成音响。
 */
const parseDescription = xml => {
    const result = {
        name: '',
        manufacturer: '',
        urlBase: '',
        controlUrl: null,
    };
    result.name = decodeEntities(tagText(xml, 'friendlyName'));
    result.manufacturer = decodeEntities(tagText(xml, 'manufacturer'));
    result.urlBase = decodeEntities(tagText(xml, 'URLBase'));

    const serviceBlocks = xml.match(/<service[\s>][\s\S]*?<\/service>/gi) || [];
    for (const block of serviceBlocks) {
        const serviceType = decodeEntities(tagText(block, 'serviceType'));
        if (!serviceType.startsWith(AV_TRANSPORT_PREFIX)) continue;
        const controlUrl = decodeEntities(tagText(block, 'controlURL'));
        if (controlUrl) {
            result.controlUrl = controlUrl;
            break;
        }
    }
    return result;
};

const absoluteUrl = (location, controlPath, urlBase) => {
    if (/^https?:\/\//i.test(controlPath)) return controlPath;
    let base = urlBase;
    if (!base) {
        const url = new URL(location);
        base = `${url.protocol}//${url.host}/`;
    }
    return `${base.replace(/\/+$/, '')}/${controlPath.replace(/^\/+/, '')}`;
};

const readSpeaker = async (usn, location) => {
    try {
        const xml = await getJson(location);
        const parsed = parseDescription(xml);
        if (!parsed.controlUrl) return null;
        return {
            id: usn,
            name: parsed.name || new URL(location).host,
            location,
            controlUrl: absoluteUrl(location, parsed.controlUrl, parsed.urlBase),
            manufacturer: parsed.manufacturer,
        };
    } catch {
        return null;
    }
};

/**
 * 扫一遍局域网里能当播放器的 UPnP 设备。
 *
 * 组播包本身不保证送达，所以按 400ms 一轮重发、轮换三个搜索目标，
 * 直到 timeoutMs 用完；收到回复先按 USN 记账，最后再逐个取设备描述。
 */
const discoverSpeakers = ({ timeoutMs = 3200 } = {}) => new Promise(resolve => {
    const replies = new Map();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let closed = false;
    let timer = null;
    let deadline = 0;

    const finish = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        try { socket.close(); } catch { /* 已关闭。 */ }

        const targets = [...replies.entries()].map(([usn, location]) => [usn, location]);
        // 同一台设备可能用不同 USN 重复回复，按 LOCATION 去重后再取描述。
        const byLocation = new Map();
        for (const [usn, location] of targets) {
            if (!byLocation.has(location)) byLocation.set(location, usn);
        }
        Promise.all([...byLocation.entries()].map(([location, usn]) => readSpeaker(usn, location)))
            .then(speakers => {
                const seen = new Set();
                const unique = [];
                for (const speaker of speakers) {
                    if (!speaker || seen.has(speaker.controlUrl)) continue;
                    seen.add(speaker.controlUrl);
                    unique.push(speaker);
                }
                resolve(unique);
            })
            .catch(() => resolve([]));
    };

    socket.on('message', (message, remote) => {
        void remote;
        const text = message.toString('utf8');
        if (!/^HTTP\/1\.1\s+200/i.test(text)) return;
        const headers = parseHeaders(text);
        const location = headers.get('location');
        if (!location) return;
        // 只收本机所在网段的回复，避免把跨网段（虚拟网卡）的设备也算进来。
        if (!/^https?:\/\//i.test(location)) return;
        const usn = headers.get('usn') || location;
        if (!replies.has(usn)) replies.set(usn, location);
    });
    socket.on('error', () => finish());

    try {
        socket.bind(0, () => {
            try { socket.setMulticastTTL(2); } catch { /* 部分平台不支持。 */ }
            try { socket.setBroadcast(false); } catch { /* 同上。 */ }
            let round = 0;
            const send = () => {
                if (closed) return;
                const target = SEARCH_TARGETS[round % SEARCH_TARGETS.length];
                round += 1;
                const packet = buildSearch(target);
                // 多网卡机器上每个局域网接口各发一份，否则组播可能只走默认网卡。
                const interfaces = os.networkInterfaces();
                let sent = false;
                for (const addresses of Object.values(interfaces)) {
                    for (const address of addresses || []) {
                        if (address.family !== 'IPv4' || address.internal) continue;
                        try { socket.setMulticastInterface(address.address); } catch { continue; }
                        socket.send(packet, 0, packet.length, SSDP_PORT, SSDP_ADDRESS, () => { /* 收不到回复是常态。 */ });
                        sent = true;
                    }
                }
                if (!sent) {
                    socket.send(packet, 0, packet.length, SSDP_PORT, SSDP_ADDRESS, () => { /* 同上。 */ });
                }
                if (Date.now() >= deadline) finish();
            };
            deadline = Date.now() + Math.min(Math.max(timeoutMs, 800), 10000);
            send();
            timer = setInterval(send, SEARCH_ROUND_MS);
        });
    } catch {
        finish();
    }
});

module.exports = {
    discoverSpeakers,
    lanIpv4,
    parseDescription,
    absoluteUrl,
    AV_TRANSPORT: AV_TRANSPORT_PREFIX,
};
