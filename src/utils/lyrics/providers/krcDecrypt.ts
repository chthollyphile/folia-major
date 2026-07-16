// src/utils/lyrics/providers/krcDecrypt.ts

/**
 * Kugou KRC lyric decryption and decompression module.
 * Decrypts encrypted KRC buffer into plain text LRC-like string.
 */

const KRC_KEY = new Uint8Array([
  64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105
]);

/**
 * Helper to decompress zlib-compressed data using browser's DecompressionStream.
 */
async function decompressDeflate(bytes: Uint8Array): Promise<string> {
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  writer.write(new Uint8Array(bytes)).catch(() => {});
  writer.close().catch(() => {});
  
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        chunks.push(value);
      }
      if (done) {
        break;
      }
    }
  } catch (error) {
    if (chunks.length === 0) {
      throw error;
    }
    console.warn('DecompressionStream warning (ignored):', error);
  } finally {
    reader.releaseLock();
  }
  
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder('utf-8').decode(result);
}

/**
 * Decrypts Kugou KRC format bytes.
 * Skip first 4 bytes ("krc1"), XOR with the static key, and inflate.
 */
export async function krcDecrypt(encryptedBytes: Uint8Array): Promise<string> {
  if (encryptedBytes.length <= 4) {
    throw new Error('Invalid KRC data: too short');
  }

  // Skip the first 4 bytes (header "krc1")
  const data = encryptedBytes.subarray(4);
  const decrypted = new Uint8Array(data.length);

  for (let i = 0; i < data.length; i++) {
    decrypted[i] = data[i] ^ KRC_KEY[i % KRC_KEY.length];
  }

  return await decompressDeflate(decrypted);
}
