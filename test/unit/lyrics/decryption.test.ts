// test/unit/lyrics/decryption.test.ts

import { describe, expect, it } from 'vitest';
import { krcDecrypt } from '@/utils/lyrics/providers/krcDecrypt';
import { decodeKugouDownloadedLyric } from '@/utils/lyrics/providers/kugouLyricProvider';
import { qrcDecrypt } from '@/utils/lyrics/providers/qrcDecrypt';

// Helper to compress text using CompressionStream
async function compressDeflate(text: string): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  void writer.write(new TextEncoder().encode(text));
  void writer.close();
  
  const response = new Response(cs.readable);
  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

describe('decryption helpers', () => {
  it('decrypts KRC XOR format correctly', async () => {
    const originalText = '[00:10.00]Hello Kugou KRC lyrics';
    const compressed = await compressDeflate(originalText);
    
    // Encrypt it with KRC key
    const KRC_KEY = new Uint8Array([
      64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105
    ]);
    
    // Prefix with "krc1" (4 bytes)
    const encrypted = new Uint8Array(4 + compressed.length);
    encrypted[0] = 107; // k
    encrypted[1] = 114; // r
    encrypted[2] = 99;  // c
    encrypted[3] = 49;  // 1
    
    for (let i = 0; i < compressed.length; i++) {
      encrypted[4 + i] = compressed[i] ^ KRC_KEY[i % KRC_KEY.length];
    }
    
    const decrypted = await krcDecrypt(encrypted);
    expect(decrypted).toBe(originalText);
  });

  it('decodes plain Kugou timed lyrics even when contenttype is not marked as plain text', async () => {
    const lyricText = '[00:10.00]Plain Kugou lyric';
    const decoded = await decodeKugouDownloadedLyric(new TextEncoder().encode(lyricText), 1);

    expect(decoded.lyricText).toBe(lyricText);
    expect(decoded.format).toBe('lrc');
  });
});
