'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { fileURLToPath } = require('node:url');

// electron/dux/artwork.cjs
// Album art for the bridge. Dux shows whatever MPRIS hands it (a local file for KDE Connect,
// http(s) for browsers); Folia's page cannot read most of those origins, so the bridge serves the
// bytes itself on 127.0.0.1. Only real image payloads are served, so a player cannot turn the
// proxy into an arbitrary file read.

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 24;
const FETCH_TIMEOUT_MS = 10000;

const MAGIC = [
    { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
    { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
    { type: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
    { type: 'image/bmp', bytes: [0x42, 0x4d] },
];

const sniffImageType = bytes => {
    if (!bytes || bytes.length < 4) return null;
    for (const entry of MAGIC) {
        if (entry.bytes.every((byte, index) => bytes[index] === byte)) return entry.type;
    }
    const head = bytes.subarray(0, 16).toString('ascii');
    if (head.startsWith('RIFF') && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    if (head.includes('ftypavif')) return 'image/avif';
    if (head.trimStart().startsWith('<svg') || head.trimStart().startsWith('<?xml')) return 'image/svg+xml';
    return null;
};

const normalizeContentType = value => {
    const type = String(value ?? '').split(';')[0].trim().toLowerCase();
    return type.startsWith('image/') ? type : null;
};

const decodeDataUrl = (value, maxBytes = MAX_BYTES) => {
    const match = /^data:([^;,]+);base64,(.*)$/s.exec(value);
    if (!match) return null;
    const type = normalizeContentType(match[1]);
    if (!type) return null;
    if (match[2].length > maxBytes * 2) return null;
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > maxBytes) return null;
    return { bytes, contentType: sniffImageType(bytes) ?? type };
};

const createArtworkStore = ({
    fetchImpl = globalThis.fetch,
    fsImpl = fs.promises,
    maxBytes = MAX_BYTES,
    maxEntries = MAX_ENTRIES,
    timeoutMs = FETCH_TIMEOUT_MS,
    log = console,
} = {}) => {
    const entries = new Map();
    const cache = new Map();

    const remember = (token, payload) => {
        cache.set(token, payload);
        while (cache.size > maxEntries) {
            const oldest = cache.keys().next().value;
            cache.delete(oldest);
        }
    };

    const readBytes = async (artUrl) => {
        if (artUrl.startsWith('data:')) return decodeDataUrl(artUrl, maxBytes);

        let parsed;
        try {
            parsed = new URL(artUrl);
        } catch {
            return null;
        }

        if (parsed.protocol === 'file:') {
            const filePath = fileURLToPath(parsed);
            const stat = await fsImpl.stat(filePath);
            if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) return null;
            const bytes = await fsImpl.readFile(filePath);
            return { bytes, contentType: sniffImageType(bytes) };
        }

        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        const response = await fetchImpl(artUrl, {
            signal: AbortSignal.timeout(timeoutMs),
            redirect: 'follow',
        });
        if (!response.ok) return null;
        const declared = Number(response.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > maxBytes) return null;
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length === 0 || bytes.length > maxBytes) return null;
        const headerType = normalizeContentType(response.headers.get('content-type'));
        return { bytes, contentType: sniffImageType(bytes) ?? headerType };
    };

    /** Registers one art URL for one track; repeated calls with the same pair reuse the token. */
    const register = (artUrl, trackKey) => {
        if (typeof artUrl !== 'string' || artUrl === '' || typeof trackKey !== 'string') return null;
        const token = crypto.createHash('sha1').update(`${trackKey}\u0000${artUrl}`).digest('hex').slice(0, 32);
        entries.set(token, artUrl);
        if (entries.size > maxEntries * 2) {
            for (const [key] of entries) {
                if (key !== token) entries.delete(key);
                if (entries.size <= maxEntries) break;
            }
        }
        return token;
    };

    const get = async (token) => {
        if (cache.has(token)) return cache.get(token);
        const artUrl = entries.get(token);
        if (!artUrl) return null;
        try {
            const payload = await readBytes(artUrl);
            if (!payload || !payload.contentType || payload.bytes.length === 0 || payload.bytes.length > maxBytes) return null;
            remember(token, payload);
            return payload;
        } catch (error) {
            // The URL may carry credentials (Navidrome, a private server): never log it.
            log.info('[Dux] could not read album art', error instanceof Error ? error.name : typeof error);
            return null;
        }
    };

    return { register, get };
};

module.exports = {
    createArtworkStore,
    normalizeContentType,
    sniffImageType,
};
