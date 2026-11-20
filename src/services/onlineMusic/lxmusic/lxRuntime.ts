// src/services/onlineMusic/lxmusic/lxRuntime.ts
// 洛雪自定义音源的运行环境：在浏览器 / WebView 里复刻 LX 桌面端暴露给脚本的 globalThis.lx API。
// 脚本通过 on('request') 注册「拿播放地址 / 歌词 / 封面」的回调，我们通过它去取歌；
// 脚本通过 send('inited', {sources}) 声明它支持哪些平台。
//
// 实测要点（照真实音源脚本踩出来的）：
//   · 很多音源是**异步初始化**的：先 await 探测几个接口，过几百毫秒才 send('inited')。
//     所以不能「脚本函数跑完就立刻取 sources」，必须等 ready。
//   · 混淆过的音源把 lx 写成 globalThis['\x6c\x78']，初始化期间还会再次读 globalThis.lx，
//     因此 globalThis.lx 要保留到初始化结束，不能执行完马上还原。
//   · utils.crypto.aesEncrypt / utils.zlib 是真实存在的 API，缺了脚本会直接抛错。
//
// 安全说明：导入并运行用户自带的脚本，执行环境就是页面主线程。这是用户主动导入的自定义音源，
// 与 LX 客户端一致；脚本若是恶意来源则有风险（与在 LX 里导入同源）。后续可改为 Web Worker 隔离。

import { deflateSync, inflateSync, unzlibSync, zlibSync } from 'fflate';
import type { LxLoadedSource, LxPlatformKey, LxRequestHandler, LxSourceMeta, LxSourcePlatformInfo } from './lxTypes';
import { validateLxScript } from './lxSourceParser';
import { resolveProxiedUrl } from '../../proxiedUrl';
import { hasNativeHttp, nativeHttpRequest } from '../../nativeAndroidBridge';

const EVENT_NAMES = { inited: 'inited', request: 'request', updateAlert: 'updateAlert' } as const;

const INIT_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------------------
// 工具方法：MD5
// ---------------------------------------------------------------------------

const MD5_S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const MD5_K = (() => {
    const table = new Uint32Array(64);
    for (let i = 0; i < 64; i += 1) table[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
    return table;
})();

/** 标准 MD5，输入按 UTF-8 处理，输出 32 位小写十六进制。 */
export const md5 = (input: string): string => {
    const bytes = new TextEncoder().encode(input);
    const bitLen = BigInt(bytes.length) * 8n;
    const totalLength = (((bytes.length + 8) >> 6) + 1) << 6;
    const buffer = new Uint8Array(totalLength);
    buffer.set(bytes);
    buffer[bytes.length] = 0x80;
    for (let i = 0; i < 8; i += 1) buffer[totalLength - 8 + i] = Number((bitLen >> BigInt(8 * i)) & 0xffn);

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;
    const M = new Uint32Array(16);

    for (let offset = 0; offset < totalLength; offset += 64) {
        for (let i = 0; i < 16; i += 1) {
            const p = offset + i * 4;
            M[i] = (buffer[p] | (buffer[p + 1] << 8) | (buffer[p + 2] << 16) | (buffer[p + 3] << 24)) >>> 0;
        }
        let a = a0;
        let b = b0;
        let c = c0;
        let d = d0;
        for (let i = 0; i < 64; i += 1) {
            let f: number;
            let g: number;
            if (i < 16) { f = (b & c) | (~b & d); g = i; }
            else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
            else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
            else { f = c ^ (b | ~d); g = (7 * i) % 16; }

            const sum = (a + f + MD5_K[i] + M[g]) | 0;
            const shifted = ((sum << MD5_S[i]) | (sum >>> (32 - MD5_S[i]))) | 0;
            a = d;
            d = c;
            c = b;
            b = (b + shifted) | 0;
        }
        a0 = (a0 + a) | 0;
        b0 = (b0 + b) | 0;
        c0 = (c0 + c) | 0;
        d0 = (d0 + d) | 0;
    }

    // 输出时每个 32 位字按小端字节序展开。
    const toHex = (value: number): string => {
        let out = '';
        for (let i = 0; i < 4; i += 1) out += ((value >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
        return out;
    };
    return toHex(a0) + toHex(b0) + toHex(c0) + toHex(d0);
};

// ---------------------------------------------------------------------------
// 工具方法：字节容器（贴近 Node Buffer 的用法，脚本会 .toString('hex')）
// ---------------------------------------------------------------------------

const bytesToString = (buffer: Uint8Array, format?: string): string => {
    const enc = (format || 'utf-8').toLowerCase();
    if (enc === 'hex') return Array.from(buffer).map((b) => b.toString(16).padStart(2, '0')).join('');
    if (enc === 'base64') {
        let s = '';
        for (let i = 0; i < buffer.length; i++) s += String.fromCharCode(buffer[i]);
        return btoa(s);
    }
    if (enc === 'latin1' || enc === 'binary' || enc === 'ascii') {
        let s = '';
        for (let i = 0; i < buffer.length; i++) s += String.fromCharCode(buffer[i]);
        return s;
    }
    return new TextDecoder().decode(buffer);
};

/** Uint8Array + Node Buffer 里的 toString(encoding)，音源的 md5/base64 处理全靠它。 */
class LxBuffer extends Uint8Array {
    toString(encoding?: string, start = 0, end = this.length): string {
        return bytesToString(this.subarray(start, end), encoding);
    }
}

const toLxBuffer = (input: string | number[] | Uint8Array, encoding?: string): LxBuffer => {
    if (typeof input === 'string') {
        const enc = (encoding || 'utf-8').toLowerCase();
        if (enc === 'hex') {
            const clean = input.replace(/[^0-9a-fA-F]/g, '');
            const out = new LxBuffer(clean.length >> 1);
            for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
            return out;
        }
        if (enc === 'base64') {
            const bin = atob(input);
            const out = new LxBuffer(bin.length);
            for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
            return out;
        }
        if (enc === 'latin1' || enc === 'binary' || enc === 'ascii') {
            const out = new LxBuffer(input.length);
            for (let i = 0; i < input.length; i++) out[i] = input.charCodeAt(i) & 0xff;
            return out;
        }
        return new LxBuffer(new TextEncoder().encode(input));
    }
    if (Array.isArray(input)) return new LxBuffer(input);
    return new LxBuffer(input);
};

const bufferApi = {
    from: (input: string | number[] | Uint8Array, encoding?: string): LxBuffer => toLxBuffer(input, encoding),
    bufToString: (buffer: Uint8Array, format?: string): string => bytesToString(buffer, format),
    concat(list: Uint8Array[]): LxBuffer {
        const total = list.reduce((sum, item) => sum + item.length, 0);
        const out = new LxBuffer(total);
        let offset = 0;
        for (const item of list) { out.set(item, offset); offset += item.length; }
        return out;
    },
};

// ---------------------------------------------------------------------------
// 工具方法：AES（同步，纯 JS；WebCrypto 是异步的，脚本等不了）
// ---------------------------------------------------------------------------

const AES_SBOX = new Uint8Array([
    0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
    0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
    0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
    0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
    0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
    0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
    0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
    0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
    0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
    0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
    0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
    0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
    0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
    0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
    0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
    0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
]);

const AES_INV_SBOX = (() => {
    const table = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) table[AES_SBOX[i]] = i;
    return table;
})();

const AES_RCON = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36, 0x6c, 0xd8, 0xab, 0x4d];

const gmul = (a: number, b: number): number => {
    let p = 0;
    let x = a;
    let y = b;
    for (let i = 0; i < 8; i += 1) {
        if (y & 1) p ^= x;
        const hi = x & 0x80;
        x = (x << 1) & 0xff;
        if (hi) x ^= 0x1b;
        y >>= 1;
    }
    return p;
};

const expandAesKey = (key: Uint8Array): { roundKeys: Uint8Array; rounds: number } => {
    if (![16, 24, 32].includes(key.length)) throw new Error(`AES key 长度不合法：${key.length}`);
    const nk = key.length / 4;
    const rounds = nk + 6;
    const words = 4 * (rounds + 1);
    const w = new Uint8Array(words * 4);
    w.set(key);
    let rcon = 0;
    for (let i = nk; i < words; i += 1) {
        let t0 = w[(i - 1) * 4];
        let t1 = w[(i - 1) * 4 + 1];
        let t2 = w[(i - 1) * 4 + 2];
        let t3 = w[(i - 1) * 4 + 3];
        if (i % nk === 0) {
            const tmp = t0;
            rcon += 1;
            t0 = AES_SBOX[t1] ^ AES_RCON[rcon];
            t1 = AES_SBOX[t2];
            t2 = AES_SBOX[t3];
            t3 = AES_SBOX[tmp];
        } else if (nk > 6 && i % nk === 4) {
            t0 = AES_SBOX[t0]; t1 = AES_SBOX[t1]; t2 = AES_SBOX[t2]; t3 = AES_SBOX[t3];
        }
        w[i * 4] = w[(i - nk) * 4] ^ t0;
        w[i * 4 + 1] = w[(i - nk) * 4 + 1] ^ t1;
        w[i * 4 + 2] = w[(i - nk) * 4 + 2] ^ t2;
        w[i * 4 + 3] = w[(i - nk) * 4 + 3] ^ t3;
    }
    return { roundKeys: w, rounds };
};

const addRoundKey = (state: Uint8Array, roundKeys: Uint8Array, round: number): void => {
    const base = round * 16;
    for (let i = 0; i < 16; i += 1) state[i] ^= roundKeys[base + i];
};

const shiftRows = (state: Uint8Array): void => {
    // 行 r 左移 r（state 为列优先：state[r + 4c]）
    for (let r = 1; r < 4; r += 1) {
        const row = [state[r], state[r + 4], state[r + 8], state[r + 12]];
        for (let c = 0; c < 4; c += 1) state[r + 4 * c] = row[(c + r) % 4];
    }
};

const invShiftRows = (state: Uint8Array): void => {
    for (let r = 1; r < 4; r += 1) {
        const row = [state[r], state[r + 4], state[r + 8], state[r + 12]];
        for (let c = 0; c < 4; c += 1) state[r + 4 * c] = row[(c - r + 4) % 4];
    }
};

const mixColumns = (state: Uint8Array): void => {
    for (let c = 0; c < 4; c += 1) {
        const i = c * 4;
        const a0 = state[i], a1 = state[i + 1], a2 = state[i + 2], a3 = state[i + 3];
        state[i] = gmul(a0, 2) ^ gmul(a1, 3) ^ a2 ^ a3;
        state[i + 1] = a0 ^ gmul(a1, 2) ^ gmul(a2, 3) ^ a3;
        state[i + 2] = a0 ^ a1 ^ gmul(a2, 2) ^ gmul(a3, 3);
        state[i + 3] = gmul(a0, 3) ^ a1 ^ a2 ^ gmul(a3, 2);
    }
};

const invMixColumns = (state: Uint8Array): void => {
    for (let c = 0; c < 4; c += 1) {
        const i = c * 4;
        const a0 = state[i], a1 = state[i + 1], a2 = state[i + 2], a3 = state[i + 3];
        state[i] = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9);
        state[i + 1] = gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13);
        state[i + 2] = gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11);
        state[i + 3] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14);
    }
};

const encryptBlock = (block: Uint8Array, roundKeys: Uint8Array, rounds: number): Uint8Array => {
    const s = Uint8Array.from(block);
    addRoundKey(s, roundKeys, 0);
    for (let round = 1; round <= rounds; round += 1) {
        for (let i = 0; i < 16; i += 1) s[i] = AES_SBOX[s[i]];
        shiftRows(s);
        if (round !== rounds) mixColumns(s);
        addRoundKey(s, roundKeys, round);
    }
    return s;
};

const decryptBlock = (block: Uint8Array, roundKeys: Uint8Array, rounds: number): Uint8Array => {
    const s = Uint8Array.from(block);
    addRoundKey(s, roundKeys, rounds);
    for (let round = rounds - 1; round >= 0; round -= 1) {
        invShiftRows(s);
        for (let i = 0; i < 16; i += 1) s[i] = AES_INV_SBOX[s[i]];
        addRoundKey(s, roundKeys, round);
        if (round !== 0) invMixColumns(s);
    }
    return s;
};

/** pkcs7 补齐到 16 字节。 */
const pkcs7Pad = (data: Uint8Array): Uint8Array => {
    const pad = 16 - (data.length % 16);
    const out = new Uint8Array(data.length + pad);
    out.set(data);
    out.fill(pad, data.length);
    return out;
};

const pkcs7Unpad = (data: Uint8Array): Uint8Array => {
    const pad = data[data.length - 1];
    if (pad <= 0 || pad > 16 || pad > data.length) return data;
    return data.subarray(0, data.length - pad);
};

const aesCipher = (
    input: Uint8Array,
    mode: string,
    key: Uint8Array,
    iv: Uint8Array,
    decrypt: boolean,
): LxBuffer => {
    const normalized = mode.toLowerCase().replace(/^aes-\d+-/, '');
    const { roundKeys, rounds } = expandAesKey(key);
    const processBlock = decrypt ? decryptBlock : encryptBlock;
    const data = decrypt ? input : pkcs7Pad(input);

    if (normalized === 'ecb') {
        const out = new Uint8Array(data.length);
        for (let offset = 0; offset < data.length; offset += 16) {
            out.set(processBlock(data.subarray(offset, offset + 16), roundKeys, rounds), offset);
        }
        return decrypt ? new LxBuffer(pkcs7Unpad(out)) : new LxBuffer(out);
    }

    if (normalized !== 'cbc') throw new Error(`LX 运行时暂不支持 AES 模式：${mode}`);
    if (iv.length < 16) throw new Error('AES-CBC 需要 16 字节 iv。');
    const out = new Uint8Array(data.length);
    let prev = Uint8Array.from(iv.subarray(0, 16));
    for (let offset = 0; offset < data.length; offset += 16) {
        const block = data.subarray(offset, offset + 16);
        if (decrypt) {
            const plain = processBlock(block, roundKeys, rounds);
            for (let i = 0; i < 16; i += 1) out[offset + i] = plain[i] ^ prev[i];
            prev = Uint8Array.from(block);
        } else {
            const xored = new Uint8Array(16);
            for (let i = 0; i < 16; i += 1) xored[i] = block[i] ^ prev[i];
            const cipher = processBlock(xored, roundKeys, rounds);
            out.set(cipher, offset);
            prev = Uint8Array.from(cipher);
        }
    }
    return decrypt ? new LxBuffer(pkcs7Unpad(out)) : new LxBuffer(out);
};

// ---------------------------------------------------------------------------
// 工具方法：RSA（只用公钥，PKCS#1 DER，无填充 —— 与 LX 的 rsaEncrypt 一致）
// ---------------------------------------------------------------------------

const bytesToBigInt = (bytes: Uint8Array): bigint => {
    let value = 0n;
    for (const byte of bytes) value = (value << 8n) | BigInt(byte);
    return value;
};

const bigIntToBytes = (value: bigint, length: number): Uint8Array => {
    const out = new Uint8Array(length);
    let rest = value;
    for (let i = length - 1; i >= 0; i -= 1) {
        out[i] = Number(rest & 0xffn);
        rest >>= 8n;
    }
    return out;
};

const modPow = (base: bigint, exponent: bigint, modulus: bigint): bigint => {
    let result = 1n;
    let b = base % modulus;
    let e = exponent;
    while (e > 0n) {
        if (e & 1n) result = (result * b) % modulus;
        b = (b * b) % modulus;
        e >>= 1n;
    }
    return result;
};

const pemToDer = (pem: string): Uint8Array => {
    const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    const bin = atob(body);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
};

/** 从 SubjectPublicKeyInfo（或裸 RSAPublicKey）里取 n / e。 */
const parseRsaPublicKey = (der: Uint8Array): { modulus: bigint; exponent: bigint } => {
    let offset = 0;
    const readLength = (): number => {
        let length = der[offset++];
        if (length & 0x80) {
            const count = length & 0x7f;
            length = 0;
            for (let i = 0; i < count; i += 1) length = (length << 8) | der[offset++];
        }
        return length;
    };
    const readInteger = (): Uint8Array => {
        if (der[offset++] !== 0x02) throw new Error('RSA 公钥格式不对（不是 INTEGER）。');
        const length = readLength();
        const value = der.subarray(offset, offset + length);
        offset += length;
        return value[0] === 0x00 ? value.subarray(1) : value;
    };

    if (der[offset++] !== 0x30) throw new Error('RSA 公钥格式不对（不是 SEQUENCE）。');
    readLength();
    // SubjectPublicKeyInfo：SEQUENCE { AlgorithmIdentifier, BIT STRING { RSAPublicKey } }
    if (der[offset] === 0x30) {
        offset += 1;
        const algorithmLength = readLength();
        offset += algorithmLength;
        if (der[offset++] !== 0x03) throw new Error('RSA 公钥格式不对（不是 BIT STRING）。');
        readLength();
        offset += 1; // unused bits
        if (der[offset++] !== 0x30) throw new Error('RSA 公钥格式不对（内层不是 SEQUENCE）。');
        readLength();
    }
    const modulus = bytesToBigInt(readInteger());
    const exponent = bytesToBigInt(readInteger());
    return { modulus, exponent };
};

const rsaEncrypt = (input: Uint8Array, publicKey: string): LxBuffer => {
    const { modulus, exponent } = parseRsaPublicKey(pemToDer(publicKey));
    const size = Math.ceil(modulus.toString(16).length / 2);
    const message = bytesToBigInt(input);
    if (message >= modulus) throw new Error('RSA 明文过长。');
    return new LxBuffer(bigIntToBytes(modPow(message, exponent, modulus), size));
};

// ---------------------------------------------------------------------------
// 工具方法：crypto / zlib
// ---------------------------------------------------------------------------

const cryptoApi = {
    md5,
    randomBytes(size: number): LxBuffer {
        const arr = new LxBuffer(size);
        const source = globalThis.crypto ?? (window as unknown as { crypto?: Crypto }).crypto;
        if (source?.getRandomValues) source.getRandomValues(arr);
        else for (let i = 0; i < size; i += 1) arr[i] = Math.floor(Math.random() * 256);
        return arr;
    },
    aesEncrypt(
        buffer: string | Uint8Array,
        mode = 'aes-128-cbc',
        key: string | Uint8Array = '',
        iv: string | Uint8Array = '',
    ): LxBuffer {
        return aesCipher(toLxBuffer(buffer), mode, toLxBuffer(key), toLxBuffer(iv), false);
    },
    aesDecrypt(
        buffer: string | Uint8Array,
        mode = 'aes-128-cbc',
        key: string | Uint8Array = '',
        iv: string | Uint8Array = '',
    ): LxBuffer {
        return aesCipher(toLxBuffer(buffer), mode, toLxBuffer(key), toLxBuffer(iv), true);
    },
    rsaEncrypt(buffer: string | Uint8Array, key: string): LxBuffer {
        return rsaEncrypt(toLxBuffer(buffer), key);
    },
};

/** LX 的 zlib 默认是 zlib 格式（带 0x78 头）；个别脚本给的是裸 deflate，兜一下。 */
const zlibApi = {
    inflate(data: Uint8Array, options?: { to?: string }): LxBuffer | string {
        let out: Uint8Array;
        try {
            out = unzlibSync(data);
        } catch {
            out = inflateSync(data);
        }
        const buffer = new LxBuffer(out);
        return options?.to === 'string' ? bytesToString(buffer, 'utf-8') : buffer;
    },
    deflate(data: Uint8Array, options?: { to?: string }): LxBuffer | string {
        const out = zlibSync(data);
        const buffer = new LxBuffer(out);
        return options?.to === 'string' ? bytesToString(buffer, 'base64') : buffer;
    },
};

// ---------------------------------------------------------------------------
// HTTP 请求：复刻 lx.request(url, options, callback)
// ---------------------------------------------------------------------------

type LxRequestOptions = {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Record<string, unknown> | FormData;
    form?: Record<string, string>;
    formData?: Record<string, string | Blob>;
    timeout?: number;
};

const buildRequestBody = (options: LxRequestOptions): { body?: BodyInit; headers?: Record<string, string> } => {
    const headers = { ...(options.headers ?? {}) };
    if (options.form) {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(options.form)) params.set(k, v);
        return { body: params.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers } };
    }
    if (options.formData) {
        const fd = new FormData();
        for (const [k, v] of Object.entries(options.formData)) fd.append(k, v);
        return { body: fd, headers };
    }
    if (options.body !== undefined) {
        if (typeof options.body === 'string') return { body: options.body, headers };
        if (options.body instanceof FormData) return { body: options.body, headers };
        return { body: JSON.stringify(options.body), headers: { 'content-type': 'application/json', ...headers } };
    }
    return { headers };
};

export type LxRequestResponse = {
    statusCode: number;
    statusMessage?: string;
    headers: Record<string, string>;
    bytes?: number;
    raw?: string;
    /** 与 LX 一致：能 JSON.parse 就给对象，否则给原始文本。脚本大量使用 resp.body.code。 */
    body?: unknown;
};

export const lxRequest = (
    url: string,
    options: LxRequestOptions,
    callback: (err: unknown, resp?: LxRequestResponse, body?: unknown) => void,
): (() => void) => {
    const controller = new AbortController();
    const timer = options.timeout ? window.setTimeout(() => controller.abort(), options.timeout) : null;
    const { body, headers = {} } = buildRequestBody(options);

    /**
     * 安卓上必须走原生 OkHttp，而且**不能**按主机白名单过滤。
     *
     * 音源脚本的第一步是去它自己的服务器要地址，那些域名千奇百怪；以前这里走
     * `resolveProxiedUrl`，白名单外的主机在安卓包里会直接抛
     * "VITE_FOLIA_API_BASE must be configured"，等于每个音源第一跳就失败。
     * 白名单内的主机反而能过——所以现象是「少数音源能用、大部分不能播」。
     */
    const run = async (): Promise<Response> => {
        if (hasNativeHttp()) {
            let bodyText: string | undefined;
            let bodyBase64: string | undefined;
            if (typeof body === 'string') {
                bodyText = body;
            } else if (body instanceof URLSearchParams) {
                bodyText = body.toString();
            } else if (body instanceof FormData) {
                // 少数音源会用 FormData 上传：整段编成 base64 交给原生，顺带拿到带 boundary 的 content-type。
                const formResponse = new Response(body);
                const contentType = formResponse.headers.get('content-type');
                if (contentType && !headers['content-type'] && !headers['Content-Type']) {
                    headers['content-type'] = contentType;
                }
                const bytes = new Uint8Array(await formResponse.arrayBuffer());
                let binary = '';
                for (let index = 0; index < bytes.length; index += 0x8000) {
                    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
                }
                bodyBase64 = btoa(binary);
            }
            return nativeHttpRequest(url, {
                method: (options.method || 'GET').toUpperCase(),
                headers,
                bodyText,
                bodyBase64,
                // 音源的服务器有时很慢（要先回源、要签名），给足预算；底下还有脚本自己的 timeout。
                timeoutMs: Math.max(options.timeout ?? 0, 20000),
            });
        }
        return fetch(resolveProxiedUrl(url), {
            method: options.method || 'GET',
            headers,
            body,
            signal: controller.signal,
            mode: 'cors',
        });
    };

    run()
        .then(async (resp) => {
            const text = await resp.text();
            const respHeaders: Record<string, string> = {};
            resp.headers.forEach((value, key) => { respHeaders[key] = value; });
            // LX 会把响应体解析成对象塞进 resp.body，同时作为第三个参数传出去。
            // 少了这个字段，音源里 `resp.body.code === 200` 这类判断会直接抛
            // 「Cannot read properties of undefined」，取地址就永远失败。
            let parsed: unknown = text;
            try {
                parsed = JSON.parse(text);
            } catch {
                parsed = text;
            }
            const response: LxRequestResponse = {
                statusCode: resp.status,
                statusMessage: resp.statusText,
                headers: respHeaders,
                bytes: text.length,
                raw: text,
                body: parsed,
            };
            callback(null, response, parsed);
        })
        .catch((err) => callback(err));
    return () => {
        if (timer) window.clearTimeout(timer);
        controller.abort();
    };
};

// ---------------------------------------------------------------------------
// 运行一个音源脚本
// ---------------------------------------------------------------------------

/**
 * 在页面环境里执行 LX 音源脚本，捕获它声明的平台与 request 回调。
 *
 * 返回值里 `sources` 和 `error` 会在异步初始化后**原地更新**，
 * 调用方应先 `await loaded.ready` 再判断（见 lxSourceStore）。
 */
export const loadLxSource = (rawScript: string, meta: LxSourceMeta): LxLoadedSource => {
    validateLxScript(rawScript);

    // 注意：这个对象必须自始至终是同一个引用 —— 脚本可能几百毫秒后才 send('inited')。
    const sources: Partial<Record<LxPlatformKey, LxSourcePlatformInfo>> = {};
    let requestHandler: LxRequestHandler | null = null;
    let failed: string | undefined;
    let inited = false;
    let resolveReady: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => { resolveReady = resolve; });

    const handlers = new Map<string, Array<(payload: unknown) => unknown>>();
    const register = (event: string, handler: (payload: unknown) => unknown) => {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
    };

    const lx = {
        version: '1.2.0',
        env: 'desktop',
        currentScriptInfo: { ...meta, rawScript },
        EVENT_NAMES,
        request: lxRequest,
        on: (event: string, handler: (payload: unknown) => unknown) => {
            register(event, handler);
            return Promise.resolve();
        },
        send: (event: string, data: unknown) => {
            if (event === EVENT_NAMES.inited) {
                const payload = data as { sources?: Partial<Record<LxPlatformKey, LxSourcePlatformInfo>>; openDevTools?: boolean };
                // 就地写入，保持外部引用有效。
                (Object.keys(sources) as LxPlatformKey[]).forEach((key) => { delete sources[key]; });
                Object.assign(sources, payload?.sources ?? {});
                inited = true;
                resolveReady();
            } else if (event === EVENT_NAMES.updateAlert) {
                // 源主动提示更新：当前仅记录，不弹窗。
                console.info('[lx] source updateAlert:', data);
            }
            // LX 的 send 返回 Promise，有些音源会 await 它。
            return Promise.resolve();
        },
        utils: { buffer: bufferApi, crypto: cryptoApi, zlib: zlibApi },
    };

    const previousLx = (globalThis as { lx?: unknown }).lx;
    try {
        (globalThis as { lx?: unknown }).lx = lx;
        // 包一层 async 以支持脚本顶层 await；脚本里的 const { EVENT_NAMES, request, on, send } = globalThis.lx 在主作用域里取到。
        // eslint-disable-next-line no-new-func
        const runner = new Function(`"use strict";\n${rawScript}`) as () => unknown;
        const returned = runner();
        // 顶层 await 的脚本会返回 Promise：初始化失败要留痕，不要静默。
        if (returned && typeof (returned as { then?: unknown }).then === 'function') {
            void (returned as Promise<unknown>).catch((err) => {
                console.warn('[lx] 音源初始化失败：', err);
                if (!failed) failed = err instanceof Error ? err.message : String(err);
            });
        }
    } catch (err) {
        failed = err instanceof Error ? err.message : String(err);
    }

    /** 初始化结束（inited 或超时）后再判定这个音源能不能用。 */
    const finalize = (): void => {
        if (!failed && Object.keys(sources).length === 0) {
            failed = '脚本没有声明任何平台（没有收到 inited 事件），可能不是有效的洛雪音源。';
        }
        if (!failed) {
            const list = handlers.get(EVENT_NAMES.request);
            if (!list || list.length === 0) {
                failed = '脚本没有注册 request 事件（无法取播放地址 / 歌词）。';
                return;
            }
            // LX 自定义源两种写法都支持：①回调式 on('request', (params, callback) => callback(null, result))
            // （桌面端最常用，内部通常要等一次 HTTP 回来才回调）；②返回式 on('request', async (params) => result)。
            // 播放地址现在是并发竞速的：慢源不该拖着整首歌，外层（lxSourceStore）还会再套一层
            // 9 秒的硬超时。这里留 12 秒，够一次「先取签名再取地址」的两跳，又不会让死源无限挂着。
            const HANDLER_TIMEOUT_MS = 12000;
            const timeoutFor = (payload: unknown): number => {
                const action = (payload as { action?: string } | null)?.action;
                if (action === 'lyric') return 20000;
                if (action === 'pic') return 8000;
                return HANDLER_TIMEOUT_MS;
            };
            const callHandler = (handler: (payload: unknown) => unknown, payload: unknown): Promise<unknown> => (
                new Promise((resolve) => {
                    let settled = false;
                    let timer: number | null = null;
                    const finish = (value: unknown) => {
                        if (settled) return;
                        settled = true;
                        if (timer !== null) window.clearTimeout(timer);
                        resolve(value);
                    };
                    timer = window.setTimeout(() => finish(undefined), timeoutFor(payload));
                    const callback = (err: unknown, resp?: unknown) => {
                        if (err) {
                            console.warn('[lx] request handler 回调报错：', err);
                            finish(undefined);
                            return;
                        }
                        finish(resp);
                    };
                    let returned: unknown;
                    try {
                        // 有些脚本在 handler 内部才去读 globalThis.lx（懒取），调用期间把它放回去。
                        (globalThis as { lx?: unknown }).lx = lx;
                        returned = (handler as (p: unknown, cb: unknown) => unknown)(payload, callback);
                    } catch (err) {
                        console.warn('[lx] request handler 抛错：', err);
                        finish(undefined);
                        return;
                    }
                    if (returned !== undefined) {
                        if (returned && typeof (returned as { then?: unknown }).then === 'function') {
                            // async 包装的回调式 handler：Promise 可能先 resolve 成 undefined，别当结果。
                            (returned as Promise<unknown>)
                                .then((r) => { if (r !== undefined && r !== null) finish(r); })
                                .catch(() => finish(undefined));
                        } else {
                            finish(returned);
                        }
                    }
                })
            );
            requestHandler = (async (payload) => {
                for (const handler of list) {
                    const result = await callHandler(handler, payload);
                    if (result !== undefined) return result;
                }
                return undefined;
            }) as LxRequestHandler;
        }
    };

    const loaded: LxLoadedSource = {
        id: '',
        meta,
        sources,
        requestHandler: (async () => undefined) as LxRequestHandler,
        error: failed,
        ready: ready.then(() => {
            finalize();
            loaded.error = failed;
            if (requestHandler) loaded.requestHandler = requestHandler;
            // 初始化结束后把全局 lx 还原，避免下一个音源加载时互相串台。
            if ((globalThis as { lx?: unknown }).lx === lx) {
                (globalThis as { lx?: unknown }).lx = previousLx;
            }
        }),
    };

    // 超时兜底：脚本既没 send(inited) 也没报错时，别让调用方永远等着。
    window.setTimeout(() => {
        if (!inited) resolveReady();
    }, INIT_TIMEOUT_MS);

    // 同步脚本的 inited 已经到齐时，提前还原 globalThis.lx（异步脚本则等 ready）。
    if (inited) {
        (globalThis as { lx?: unknown }).lx = previousLx;
    }

    return loaded;
};
