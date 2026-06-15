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
  void writer.write(bytes);
  void writer.close();
  
  const response = new Response(ds.readable);
  const arrayBuffer = await response.arrayBuffer();
  return new TextDecoder('utf-8').decode(arrayBuffer);
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
