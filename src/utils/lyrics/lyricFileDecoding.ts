// src/utils/lyrics/lyricFileDecoding.ts
// Turns the raw bytes of a lyric file into text. Reading with `File.text()` assumes UTF-8, which
// garbles two common kinds of file in the wild:
// - Kugou `.krc` downloads, which are XOR-encrypted and zlib-compressed behind a "krc1" header.
// - LRC saved by older Chinese tools, which is GBK rather than UTF-8.
//
// Text decoding order: a BOM wins; otherwise strict UTF-8; when that fails, GB18030 (a superset
// of GBK). Big5 or Shift_JIS files still come out wrong, same as before, but no longer as U+FFFD.
//
// Line endings are normalised to "\n" as well. The same tools write "\r\r\n" or a bare "\r", and
// the LRC parser splits on "\n" only, so the leftover "\r" made every line fail to match.

import { krcDecrypt } from '../../services/onlineMusic/kugou/krcDecrypt';

const KRC_MAGIC = [0x6b, 0x72, 0x63, 0x31]; // "krc1"

const startsWith = (bytes: Uint8Array, prefix: readonly number[]): boolean => (
    bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value)
);

export const isEncryptedKrc = (bytes: Uint8Array): boolean => startsWith(bytes, KRC_MAGIC);

export const decodeLyricText = (bytes: Uint8Array): string => {
    if (startsWith(bytes, [0xef, 0xbb, 0xbf])) return new TextDecoder('utf-8').decode(bytes);
    if (startsWith(bytes, [0xff, 0xfe])) return new TextDecoder('utf-16le').decode(bytes);
    if (startsWith(bytes, [0xfe, 0xff])) return new TextDecoder('utf-16be').decode(bytes);

    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        try {
            return new TextDecoder('gb18030').decode(bytes);
        } catch {
            return new TextDecoder('utf-8').decode(bytes);
        }
    }
};

const normalizeLineEndings = (text: string): string => text.replace(/\r\n?/g, '\n');

export const decodeLyricFileBytes = async (bytes: Uint8Array): Promise<string> => normalizeLineEndings(
    isEncryptedKrc(bytes) ? await krcDecrypt(bytes) : decodeLyricText(bytes)
);

export const readLyricFile = async (file: Blob): Promise<string> => (
    decodeLyricFileBytes(new Uint8Array(await file.arrayBuffer()))
);
