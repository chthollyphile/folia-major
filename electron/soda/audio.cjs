const crypto = require('node:crypto');
const { createReadStream, readdirSync, rmSync, statSync } = require('node:fs');
const { Readable } = require('node:stream');

// electron/soda/audio.cjs
//
// VIP 整首是加密的（CENC，按样本 AES-CTR）。ly-music-source 的 resolve() 把整首下载并解密后交给我们，
// 我们把它写进缓存目录，再用一个自己的 scheme 交给渲染端播放：`folia-soda://audio/<token>`。
// token 只在内存里，重启后失效——下一次 getAudioSource 会重新 resolve。
// 和 Spotify 的 folia-spotify:// 同一套做法，只是那边边读边解密，这边整首解密完再读。

const SODA_AUDIO_SCHEME = 'folia-soda';
const SODA_AUDIO_PRIVILEGED_SCHEME = {
    scheme: SODA_AUDIO_SCHEME,
    privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
    },
};

const MAX_ENTRIES = 200;

const parseRange = (header, size) => {
    const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
    if (!match) return null;
    const startText = match[1];
    const endText = match[2];
    if (!startText && !endText) return null;
    if (!startText) {
        const length = Number(endText);
        if (!Number.isFinite(length) || length <= 0) return null;
        return { start: Math.max(size - length, 0), end: size - 1 };
    }
    const start = Number(startText);
    const end = endText ? Number(endText) : size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return { invalid: true };
    return { start, end: Math.min(end, size - 1) };
};

const MAX_CACHE_BYTES = 1.5 * 1024 * 1024 * 1024; // 解密后的整首最多留 1.5 GB

function createSodaAudio({ warn = console.warn, cacheDir = () => '', maxBytes = MAX_CACHE_BYTES } = {}) {
    /** token → { path, type, at } */
    const entries = new Map();

    const prune = () => {
        while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
    };

    /**
     * 解密后的整首是明文，按最久没用先删，压到上限以内。
     * 正在用的（还有 token 指着的）不删。
     */
    const pruneCache = () => {
        const dir = typeof cacheDir === 'function' ? cacheDir() : cacheDir;
        if (!dir) return;
        const inUse = new Set(Array.from(entries.values(), (entry) => entry.path));
        let files = [];
        try {
            files = readdirSync(dir)
                .filter((name) => name.endsWith('.m4a') || name.endsWith('.mp4'))
                .map((name) => {
                    const full = path.join(dir, name);
                    try {
                        const stat = statSync(full);
                        return { full, size: stat.size, mtime: stat.mtimeMs };
                    } catch {
                        return null;
                    }
                })
                .filter(Boolean);
        } catch {
            return;
        }
        let total = files.reduce((sum, file) => sum + file.size, 0);
        if (total <= maxBytes) return;
        files.sort((a, b) => a.mtime - b.mtime);
        for (const file of files) {
            if (total <= maxBytes) break;
            if (inUse.has(file.full)) continue;
            try {
                rmSync(file.full, { force: true });
                total -= file.size;
                console.info('[SodaAudio] pruned', path.basename(file.full));
            } catch (error) {
                warn('[SodaAudio] prune failed', error);
            }
        }
    };

    return {
        /** 把一个解密好的文件登记成一个播放地址。 */
        register(filePath, type = 'audio/mp4') {
            const token = crypto.randomUUID();
            entries.set(token, { path: filePath, type, at: Date.now() });
            prune();
            pruneCache();
            return `${SODA_AUDIO_SCHEME}://audio/${token}`;
        },

        /** 宿主问「这个地址的文件是不是已经在它自己的缓存里」——我们写在自己的目录里。 */
        has(url) {
            const token = String(url || '').replace(/^folia-soda:\/\/audio\//, '');
            const entry = entries.get(token);
            if (!entry) return false;
            try {
                return statSync(entry.path).size > 0;
            } catch {
                return false;
            }
        },

        /** 宿主要求「把这个地址的文件放进它自己的缓存」——已经在了（下载时就写好了）。 */
        keep(url) {
            return this.has(url);
        },

        async handleRequest(request) {
            const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Length,Content-Range,Content-Type' };
            let token = '';
            try {
                token = new URL(request.url).pathname.replace(/^\/+/, '');
            } catch {
                return new Response(null, { status: 400, headers: cors });
            }
            const entry = entries.get(token);
            if (!entry) return new Response(null, { status: 404, headers: cors });

            let size = 0;
            try {
                size = statSync(entry.path).size;
            } catch {
                entries.delete(token);
                return new Response(null, { status: 410, headers: cors });
            }

            const rangeHeader = request.headers.get('Range');
            const range = rangeHeader ? parseRange(rangeHeader, size) : null;
            if (range?.invalid) {
                return new Response(null, { status: 416, headers: { ...cors, 'Content-Range': `bytes */${size}` } });
            }

            const start = range ? range.start : 0;
            const end = range ? range.end : size - 1;
            const length = end - start + 1;
            const headers = {
                ...cors,
                'Content-Type': entry.type,
                'Accept-Ranges': 'bytes',
                'Content-Length': String(length),
                ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
            };
            const stream = createReadStream(entry.path, { start, end });
            stream.on('error', (error) => warn('[SodaAudio] stream failed', error));
            return new Response(Readable.toWeb(stream), { status: range ? 206 : 200, headers });
        },
    };
}

module.exports = { createSodaAudio, SODA_AUDIO_SCHEME, SODA_AUDIO_PRIVILEGED_SCHEME };
