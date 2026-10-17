const crypto = require('node:crypto');
const { createReadStream, statSync } = require('node:fs');
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

function createSodaAudio({ warn = console.warn } = {}) {
    /** token → { path, type, at } */
    const entries = new Map();

    const prune = () => {
        while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
    };

    return {
        /** 把一个解密好的文件登记成一个播放地址。 */
        register(filePath, type = 'audio/mp4') {
            const token = crypto.randomUUID();
            entries.set(token, { path: filePath, type, at: Date.now() });
            prune();
            return `${SODA_AUDIO_SCHEME}://audio/${token}`;
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
