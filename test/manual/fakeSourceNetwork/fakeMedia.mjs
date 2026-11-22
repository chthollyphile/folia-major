// test/manual/fakeSourceNetwork/fakeMedia.mjs
// 假平台网络里路由表共用的媒体：单色 PNG（封面）、自己生成的音调（WAV）、按 Range 回的分段。

import zlib from 'node:zlib';

/** 一张单色 PNG（封面用），size×size。 */
export const solidPng = (size, [r, g, b]) => {
    const crcTable = Array.from({ length: 256 }, (_, n) => {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        return c >>> 0;
    });
    const crc = (buffer) => {
        let c = 0xffffffff;
        for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type, data) => {
        const length = Buffer.alloc(4);
        length.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type), data]);
        const sum = Buffer.alloc(4);
        sum.writeUInt32BE(crc(body));
        return Buffer.concat([length, body, sum]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header.set([8, 2, 0, 0, 0], 8);
    const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, Buffer.from([r, g, b]))]);
    const pixels = zlib.deflateSync(Buffer.concat(Array.from({ length: size }, () => row)));
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))]);
};

/** 一段自己生成的音调（16 位单声道 WAV）。 */
export const toneWav = (seconds, frequency = 440, rate = 22050) => {
    const samples = Math.round(seconds * rate);
    const data = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) {
        const fade = Math.min(1, i / 2000, (samples - i) / 2000);
        data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * frequency * i) / rate) * 8000 * fade), i * 2);
    }
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(data.length, 40);
    return Buffer.concat([header, data]);
};

/** 按 Range 回一段二进制（媒体要能拖动）；没有 CORS 头：跨域放不放行由宿主的媒体规则决定。 */
export const ranged = (request, buffer, type) => {
    const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
    if (!match) return { status: 200, headers: { 'content-type': type, 'accept-ranges': 'bytes' }, body: buffer };
    const start = match[1] ? Number(match[1]) : Math.max(0, buffer.length - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), buffer.length - 1) : buffer.length - 1;
    return {
        status: 206,
        headers: { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${buffer.length}` },
        body: buffer.subarray(start, end + 1),
    };
};
