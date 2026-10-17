// electron/soda/decrypt.cjs
//
// 汽水（字节 CENC）音频解密：playAuth 里的 spade_a 密钥 + 按样本 AES-CTR。
// 这不是逆向出来的新实现，而是从 ly-music-source（GPL-3.0-only）的
// dist/providers/qishui/decrypt.js 原样搬过来的本地副本——包把深层路径从 exports 里挡掉了，
// 深路径 import 会报 "Package subpath ... is not defined by exports"。
// 许可证：GPL-3.0-only，与 Folia 的 AGPL-3.0 兼容；上游算法来自社区对 spade_a / CENC 的逆向。

/**
 * Qishui / ByteDance CENC audio decrypt (spade_a key + AES-CTR samples).
 * Algorithm references community reverse engineering of spade_a / CENC pipelines.
 */
const { createCipheriv, createDecipheriv } = require('node:crypto');
class MusicSourceError extends Error {
    constructor(code, message, cause) { super(message); this.name = 'MusicSourceError'; this.code = code; this.cause = cause; }
}
function findBox(data, boxType, start, end) {
    const endPos = Math.min(end, data.length);
    let pos = start;
    const target = Buffer.from(boxType);
    while (pos + 8 <= endPos) {
        const size = data.readUInt32BE(pos);
        if (size < 8)
            break;
        if (data.subarray(pos + 4, pos + 8).equals(target)) {
            return {
                offset: pos,
                size,
                data: data.subarray(pos + 8, pos + size)
            };
        }
        pos += size;
    }
    return null;
}
function findBoxDeep(data, boxType, start, end) {
    const endPos = Math.min(end, data.length);
    let pos = start;
    const target = Buffer.from(boxType);
    while (pos + 8 <= endPos) {
        let size = data.readUInt32BE(pos);
        let headerSize = 8;
        if (size === 1) {
            if (pos + 16 > endPos)
                break;
            const size64 = Number(data.readBigUInt64BE(pos + 8));
            if (size64 > endPos - pos)
                break;
            size = size64;
            headerSize = 16;
        }
        if (size < headerSize || pos + size > endPos)
            break;
        const currentType = data.subarray(pos + 4, pos + 8).toString('ascii');
        if (data.subarray(pos + 4, pos + 8).equals(target)) {
            return {
                offset: pos,
                size,
                data: data.subarray(pos + headerSize, pos + size)
            };
        }
        const childStart = boxChildStart(currentType, pos, headerSize);
        if (childStart !== null && childStart < pos + size) {
            const found = findBoxDeep(data, boxType, childStart, pos + size);
            if (found)
                return found;
        }
        pos += size;
    }
    return null;
}
function boxChildStart(boxType, offset, headerSize) {
    switch (boxType) {
        case 'moov':
        case 'trak':
        case 'mdia':
        case 'minf':
        case 'stbl':
        case 'sinf':
        case 'schi':
            return offset + headerSize;
        case 'stsd':
            return offset + headerSize + 8;
        case 'enca':
        case 'mp4a':
        case 'alac':
        case 'fLaC':
            return offset + headerSize + 28;
        default:
            return null;
    }
}
function parseStsz(data) {
    if (data.length < 12)
        return [];
    const sampleSizeFixed = data.readUInt32BE(4);
    const sampleCount = data.readUInt32BE(8);
    const sizes = new Array(sampleCount);
    if (sampleSizeFixed !== 0) {
        sizes.fill(sampleSizeFixed);
    }
    else {
        for (let i = 0; i < sampleCount; i++) {
            const off = 12 + i * 4;
            sizes[i] = off + 4 <= data.length ? data.readUInt32BE(off) : 0;
        }
    }
    return sizes;
}
function defaultPerSampleIVSize(data, start, end) {
    const tenc = findBoxDeep(data, 'tenc', start, end);
    if (!tenc || tenc.data.length < 8)
        return 8;
    const ivSize = tenc.data[7];
    return ivSize === 8 || ivSize === 16 ? ivSize : 8;
}
function parseSenc(data, ivSize) {
    if (data.length < 8)
        return [];
    const size = ivSize === 8 || ivSize === 16 ? ivSize : 8;
    const flags = data.readUInt32BE(0) & 0x00ffffff;
    const sampleCount = data.readUInt32BE(4);
    const samples = [];
    let ptr = 8;
    const hasSubsamples = (flags & 0x02) !== 0;
    for (let i = 0; i < sampleCount; i++) {
        if (ptr + size > data.length)
            break;
        const sample = {
            iv: Buffer.from(data.subarray(ptr, ptr + size)),
            subsamples: []
        };
        ptr += size;
        if (hasSubsamples) {
            if (ptr + 2 > data.length)
                break;
            const subCount = data.readUInt16BE(ptr);
            ptr += 2;
            if (ptr + subCount * 6 > data.length)
                break;
            for (let j = 0; j < subCount; j++) {
                sample.subsamples.push({
                    clear: data.readUInt16BE(ptr),
                    encrypted: data.readUInt32BE(ptr + 2)
                });
                ptr += 6;
            }
        }
        samples.push(sample);
    }
    return samples;
}
function decryptSencSample(key, chunk, sample) {
    let iv = sample.iv;
    if (iv.length < 16) {
        const padded = Buffer.alloc(16);
        iv.copy(padded);
        iv = padded;
    }
    if (sample.subsamples.length === 0) {
        const decipher = createDecipheriv('aes-128-ctr', key, iv);
        return Buffer.concat([decipher.update(chunk), decipher.final()]);
    }
    // Encrypt zero buffer progressively only for encrypted ranges using continuous CTR
    const dst = Buffer.from(chunk);
    let counterOffset = 0;
    let pos = 0;
    for (const sub of sample.subsamples) {
        pos += sub.clear;
        if (pos >= chunk.length)
            break;
        const encLen = Math.min(sub.encrypted, chunk.length - pos);
        if (encLen <= 0)
            continue;
        const segment = chunk.subarray(pos, pos + encLen);
        // CTR from start of sample: skip counterOffset encrypted bytes already done
        const fullKs = ctrKeystream(key, iv, counterOffset + encLen);
        const ks = fullKs.subarray(counterOffset, counterOffset + encLen);
        for (let i = 0; i < encLen; i++) {
            dst[pos + i] = segment[i] ^ ks[i];
        }
        counterOffset += encLen;
        pos += encLen;
    }
    return dst;
}
function ctrKeystream(key, iv, length) {
    const cipher = createCipheriv('aes-128-ctr', key, iv);
    const zeros = Buffer.alloc(length);
    return Buffer.concat([cipher.update(zeros), cipher.final()]);
}
function encryptedSampleOriginalFormat(stsdData) {
    const idx = stsdData.indexOf(Buffer.from('frma'));
    if (idx < 4 || idx + 8 > stsdData.length)
        return Buffer.from('mp4a');
    const size = stsdData.readUInt32BE(idx - 4);
    if (size < 12 || idx - 4 + size > stsdData.length)
        return Buffer.from('mp4a');
    return stsdData.subarray(idx + 4, idx + 8);
}
function bitcount(n) {
    let u = n >>> 0;
    u = u - ((u >>> 1) & 0x55555555);
    u = (u & 0x33333333) + ((u >>> 2) & 0x33333333);
    return ((((u + (u >>> 4)) & 0xf0f0f0f) * 0x1010101) >>> 24) & 0xff;
}
function decodeBase36(c) {
    if (c >= 0x30 && c <= 0x39)
        return c - 0x30;
    if (c >= 0x61 && c <= 0x7a)
        return c - 0x61 + 10;
    return 0xff;
}
function decryptSpadeInner(keyBytes) {
    const result = Buffer.alloc(keyBytes.length);
    const buff = Buffer.concat([Buffer.from([0xfa, 0x55]), keyBytes]);
    for (let i = 0; i < result.length; i++) {
        let v = (keyBytes[i] ^ buff[i]) - bitcount(i) - 21;
        while (v < 0)
            v += 255;
        result[i] = v & 0xff;
    }
    return result;
}
function extractKeyFromPlayAuth(playAuth) {
    let binary;
    try {
        binary = Buffer.from(playAuth, 'base64');
    }
    catch (error) {
        throw new MusicSourceError('DECRYPT_FAILED', 'Invalid playAuth base64', error);
    }
    if (binary.length < 3) {
        throw new MusicSourceError('DECRYPT_FAILED', 'playAuth too short');
    }
    const paddingLen = (binary[0] ^ binary[1] ^ binary[2]) - 48;
    if (binary.length < paddingLen + 2 || paddingLen < 0) {
        throw new MusicSourceError('DECRYPT_FAILED', 'Invalid playAuth padding');
    }
    const innerInput = binary.subarray(1, binary.length - paddingLen);
    const tmpBuff = decryptSpadeInner(innerInput);
    if (tmpBuff.length === 0) {
        throw new MusicSourceError('DECRYPT_FAILED', 'spade_a decrypt failed');
    }
    const skipBytes = decodeBase36(tmpBuff[0]);
    const endIndex = 1 + (binary.length - paddingLen - 2) - skipBytes;
    if (endIndex > tmpBuff.length || endIndex < 1) {
        throw new MusicSourceError('DECRYPT_FAILED', 'playAuth key index out of bounds');
    }
    return tmpBuff.subarray(1, endIndex).toString('utf8');
}
function decryptAudio(fileData, playAuth) {
    try {
        const hexKey = extractKeyFromPlayAuth(playAuth);
        const keyBytes = Buffer.from(hexKey, 'hex');
        if (keyBytes.length !== 16) {
            throw new MusicSourceError('DECRYPT_FAILED', `Unexpected AES key length: ${keyBytes.length}`);
        }
        const moov = findBox(fileData, 'moov', 0, fileData.length);
        if (!moov)
            throw new MusicSourceError('DECRYPT_FAILED', 'moov box not found');
        let stbl = findBox(fileData, 'stbl', moov.offset, moov.offset + moov.size);
        if (!stbl) {
            const trak = findBox(fileData, 'trak', moov.offset + 8, moov.offset + moov.size);
            if (trak) {
                const mdia = findBox(fileData, 'mdia', trak.offset + 8, trak.offset + trak.size);
                if (mdia) {
                    const minf = findBox(fileData, 'minf', mdia.offset + 8, mdia.offset + mdia.size);
                    if (minf) {
                        stbl = findBox(fileData, 'stbl', minf.offset + 8, minf.offset + minf.size);
                    }
                }
            }
        }
        if (!stbl)
            throw new MusicSourceError('DECRYPT_FAILED', 'stbl box not found');
        const stsz = findBox(fileData, 'stsz', stbl.offset + 8, stbl.offset + stbl.size);
        if (!stsz)
            throw new MusicSourceError('DECRYPT_FAILED', 'stsz box not found');
        const sampleSizes = parseStsz(stsz.data);
        let senc = findBox(fileData, 'senc', moov.offset + 8, moov.offset + moov.size);
        if (!senc) {
            senc = findBox(fileData, 'senc', stbl.offset + 8, stbl.offset + stbl.size);
        }
        if (!senc)
            throw new MusicSourceError('DECRYPT_FAILED', 'senc box not found');
        const ivSize = defaultPerSampleIVSize(fileData, stbl.offset, stbl.offset + stbl.size);
        const sencSamples = parseSenc(senc.data, ivSize);
        const mdat = findBox(fileData, 'mdat', 0, fileData.length);
        if (!mdat)
            throw new MusicSourceError('DECRYPT_FAILED', 'mdat box not found');
        const decryptedData = Buffer.from(fileData);
        let readPtr = mdat.offset + 8;
        const decryptedMdatChunks = [];
        for (let i = 0; i < sampleSizes.length; i++) {
            const size = sampleSizes[i];
            if (readPtr + size > decryptedData.length)
                break;
            const chunk = decryptedData.subarray(readPtr, readPtr + size);
            if (i < sencSamples.length) {
                decryptedMdatChunks.push(decryptSencSample(keyBytes, chunk, sencSamples[i]));
            }
            else {
                decryptedMdatChunks.push(Buffer.from(chunk));
            }
            readPtr += size;
        }
        const decryptedMdat = Buffer.concat(decryptedMdatChunks);
        if (decryptedMdat.length !== mdat.size - 8) {
            throw new MusicSourceError('DECRYPT_FAILED', 'decrypted size mismatch');
        }
        decryptedMdat.copy(decryptedData, mdat.offset + 8);
        const stsd = findBox(fileData, 'stsd', stbl.offset + 8, stbl.offset + stbl.size);
        if (stsd) {
            const stsdData = Buffer.from(decryptedData.subarray(stsd.offset, stsd.offset + stsd.size));
            const encaIdx = stsdData.indexOf(Buffer.from('enca'));
            if (encaIdx !== -1) {
                const fmt = encryptedSampleOriginalFormat(stsdData);
                fmt.copy(stsdData, encaIdx);
                stsdData.copy(decryptedData, stsd.offset);
            }
        }
        return decryptedData;
    }
    catch (error) {
        if (error instanceof MusicSourceError)
            throw error;
        throw new MusicSourceError('DECRYPT_FAILED', 'Audio decrypt failed', error);
    }
}

module.exports = { extractKeyFromPlayAuth, decryptAudio };
