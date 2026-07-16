// src/utils/lyrics/providers/qrcDecrypt.ts

/**
 * QQ Music QRC lyric decryption module.
 * Converts encrypted hexadecimal QRC strings or bytes into plain text XML QRC string.
 */

const SBOX: number[][] = [
  [
    14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7,
    0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8,
    4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0,
    15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13
  ],
  [
    15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10,
    3, 13, 4, 7, 15, 2, 8, 15, 12, 0, 1, 10, 6, 9, 11, 5,
    0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15,
    13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9
  ],
  [
    10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8,
    13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1,
    13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7,
    1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12
  ],
  [
    7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15,
    13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9,
    10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4,
    3, 15, 0, 6, 10, 10, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14
  ],
  [
    2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9,
    14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6,
    4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14,
    11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3
  ],
  [
    12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11,
    10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8,
    9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6,
    4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13
  ],
  [
    4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1,
    13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6,
    1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2,
    6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12
  ],
  [
    13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7,
    1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2,
    7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8,
    2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11
  ]
];

/**
 * Extracts a specific bit from a byte array and shifts it.
 */
function bitnum(a: Uint8Array, b: number, c: number): number {
  const index = Math.floor(b / 32) * 4 + 3 - Math.floor((b % 32) / 8);
  const shift = 7 - (b % 8);
  return ((a[index] >> shift) & 1) << c;
}

/**
 * Extracts a bit from a 32-bit integer and shifts it left.
 */
function bitnum_intr(a: number, b: number, c: number): number {
  return ((a >>> (31 - b)) & 1) << c;
}

/**
 * Extracts a bit from a 32-bit integer and shifts it right (unsigned).
 */
function bitnum_intl(a: number, b: number, c: number): number {
  return (((a << b) & 0x80000000) >>> c);
}

/**
 * Re-orders bits for Sbox compression.
 */
function sbox_bit(a: number): number {
  return (a & 32) | ((a & 31) >> 1) | ((a & 1) << 4);
}

/**
 * Performs initial permutation on 8-byte block.
 */
function initial_permutation(input_data: Uint8Array): [number, number] {
  const s0 = (
    bitnum(input_data, 57, 31) | bitnum(input_data, 49, 30) | bitnum(input_data, 41, 29) | bitnum(input_data, 33, 28) |
    bitnum(input_data, 25, 27) | bitnum(input_data, 17, 26) | bitnum(input_data, 9, 25) | bitnum(input_data, 1, 24) |
    bitnum(input_data, 59, 23) | bitnum(input_data, 51, 22) | bitnum(input_data, 43, 21) | bitnum(input_data, 35, 20) |
    bitnum(input_data, 27, 19) | bitnum(input_data, 19, 18) | bitnum(input_data, 11, 17) | bitnum(input_data, 3, 16) |
    bitnum(input_data, 61, 15) | bitnum(input_data, 53, 14) | bitnum(input_data, 45, 13) | bitnum(input_data, 37, 12) |
    bitnum(input_data, 29, 11) | bitnum(input_data, 21, 10) | bitnum(input_data, 13, 9) | bitnum(input_data, 5, 8) |
    bitnum(input_data, 63, 7) | bitnum(input_data, 55, 6) | bitnum(input_data, 47, 5) | bitnum(input_data, 39, 4) |
    bitnum(input_data, 31, 3) | bitnum(input_data, 23, 2) | bitnum(input_data, 15, 1) | bitnum(input_data, 7, 0)
  ) >>> 0;

  const s1 = (
    bitnum(input_data, 56, 31) | bitnum(input_data, 48, 30) | bitnum(input_data, 40, 29) | bitnum(input_data, 32, 28) |
    bitnum(input_data, 24, 27) | bitnum(input_data, 16, 26) | bitnum(input_data, 8, 25) | bitnum(input_data, 0, 24) |
    bitnum(input_data, 58, 23) | bitnum(input_data, 50, 22) | bitnum(input_data, 42, 21) | bitnum(input_data, 34, 20) |
    bitnum(input_data, 26, 19) | bitnum(input_data, 18, 18) | bitnum(input_data, 10, 17) | bitnum(input_data, 2, 16) |
    bitnum(input_data, 60, 15) | bitnum(input_data, 52, 14) | bitnum(input_data, 44, 13) | bitnum(input_data, 36, 12) |
    bitnum(input_data, 28, 11) | bitnum(input_data, 20, 10) | bitnum(input_data, 12, 9) | bitnum(input_data, 4, 8) |
    bitnum(input_data, 62, 7) | bitnum(input_data, 54, 6) | bitnum(input_data, 46, 5) | bitnum(input_data, 38, 4) |
    bitnum(input_data, 30, 3) | bitnum(input_data, 22, 2) | bitnum(input_data, 14, 1) | bitnum(input_data, 6, 0)
  ) >>> 0;

  return [s0, s1];
}

/**
 * Performs inverse permutation on two 32-bit states to output 8-byte block.
 */
function inverse_permutation(s0: number, s1: number): Uint8Array {
  const data = new Uint8Array(8);
  data[3] = bitnum_intr(s1, 7, 7) | bitnum_intr(s0, 7, 6) | bitnum_intr(s1, 15, 5) |
            bitnum_intr(s0, 15, 4) | bitnum_intr(s1, 23, 3) | bitnum_intr(s0, 23, 2) |
            bitnum_intr(s1, 31, 1) | bitnum_intr(s0, 31, 0);

  data[2] = bitnum_intr(s1, 6, 7) | bitnum_intr(s0, 6, 6) | bitnum_intr(s1, 14, 5) |
            bitnum_intr(s0, 14, 4) | bitnum_intr(s1, 22, 3) | bitnum_intr(s0, 22, 2) |
            bitnum_intr(s1, 30, 1) | bitnum_intr(s0, 30, 0);

  data[1] = bitnum_intr(s1, 5, 7) | bitnum_intr(s0, 5, 6) | bitnum_intr(s1, 13, 5) |
            bitnum_intr(s0, 13, 4) | bitnum_intr(s1, 21, 3) | bitnum_intr(s0, 21, 2) |
            bitnum_intr(s1, 29, 1) | bitnum_intr(s0, 29, 0);

  data[0] = bitnum_intr(s1, 4, 7) | bitnum_intr(s0, 4, 6) | bitnum_intr(s1, 12, 5) |
            bitnum_intr(s0, 12, 4) | bitnum_intr(s1, 20, 3) | bitnum_intr(s0, 20, 2) |
            bitnum_intr(s1, 28, 1) | bitnum_intr(s0, 28, 0);

  data[7] = bitnum_intr(s1, 3, 7) | bitnum_intr(s0, 3, 6) | bitnum_intr(s1, 11, 5) |
            bitnum_intr(s0, 11, 4) | bitnum_intr(s1, 19, 3) | bitnum_intr(s0, 19, 2) |
            bitnum_intr(s1, 27, 1) | bitnum_intr(s0, 27, 0);

  data[6] = bitnum_intr(s1, 2, 7) | bitnum_intr(s0, 2, 6) | bitnum_intr(s1, 10, 5) |
            bitnum_intr(s0, 10, 4) | bitnum_intr(s1, 18, 3) | bitnum_intr(s0, 18, 2) |
            bitnum_intr(s1, 26, 1) | bitnum_intr(s0, 26, 0);

  data[5] = bitnum_intr(s1, 1, 7) | bitnum_intr(s0, 1, 6) | bitnum_intr(s1, 9, 5) |
            bitnum_intr(s0, 9, 4) | bitnum_intr(s1, 17, 3) | bitnum_intr(s0, 17, 2) |
            bitnum_intr(s1, 25, 1) | bitnum_intr(s0, 25, 0);

  data[4] = bitnum_intr(s1, 0, 7) | bitnum_intr(s0, 0, 6) | bitnum_intr(s1, 8, 5) |
            bitnum_intr(s0, 8, 4) | bitnum_intr(s1, 16, 3) | bitnum_intr(s0, 16, 2) |
            bitnum_intr(s1, 24, 1) | bitnum_intr(s0, 24, 0);
  return data;
}

/**
 * DES round function f.
 */
function f(state: number, key: number[]): number {
  const t1 = (
    bitnum_intl(state, 31, 0) |
    ((state & 0xf0000000) >>> 1) |
    bitnum_intl(state, 4, 5) |
    bitnum_intl(state, 3, 6) |
    ((state & 0x0f000000) >>> 3) |
    bitnum_intl(state, 8, 11) |
    bitnum_intl(state, 7, 12) |
    ((state & 0x00f00000) >>> 5) |
    bitnum_intl(state, 12, 17) |
    bitnum_intl(state, 11, 18) |
    ((state & 0x000f0000) >>> 7) |
    bitnum_intl(state, 16, 23)
  ) >>> 0;

  const t2 = (
    bitnum_intl(state, 15, 0) |
    ((state & 0x0000f000) << 15) |
    bitnum_intl(state, 20, 5) |
    bitnum_intl(state, 19, 6) |
    ((state & 0x00000f00) << 13) |
    bitnum_intl(state, 24, 11) |
    bitnum_intl(state, 23, 12) |
    ((state & 0x000000f0) << 11) |
    bitnum_intl(state, 28, 17) |
    bitnum_intl(state, 27, 18) |
    ((state & 0x0000000f) << 9) |
    bitnum_intl(state, 0, 23)
  ) >>> 0;

  const lrgstate = [
    (t1 >>> 24) & 0xff,
    (t1 >>> 16) & 0xff,
    (t1 >>> 8) & 0xff,
    (t2 >>> 24) & 0xff,
    (t2 >>> 16) & 0xff,
    (t2 >>> 8) & 0xff,
  ];

  const xorState = lrgstate.map((item, idx) => item ^ key[idx]);

  const outputState = (
    (SBOX[0][sbox_bit(xorState[0] >>> 2)] << 28) |
    (SBOX[1][sbox_bit(((xorState[0] & 0x03) << 4) | (xorState[1] >>> 4))] << 24) |
    (SBOX[2][sbox_bit(((xorState[1] & 0x0f) << 2) | (xorState[2] >>> 6))] << 20) |
    (SBOX[3][sbox_bit(xorState[2] & 0x3f)] << 16) |
    (SBOX[4][sbox_bit(xorState[3] >>> 2)] << 12) |
    (SBOX[5][sbox_bit(((xorState[3] & 0x03) << 4) | (xorState[4] >>> 4))] << 8) |
    (SBOX[6][sbox_bit(((xorState[4] & 0x0f) << 2) | (xorState[5] >>> 6))] << 4) |
    SBOX[7][sbox_bit(xorState[5] & 0x3f)]
  ) >>> 0;

  return (
    bitnum_intl(outputState, 15, 0) | bitnum_intl(outputState, 6, 1) | bitnum_intl(outputState, 19, 2) |
    bitnum_intl(outputState, 20, 3) | bitnum_intl(outputState, 28, 4) | bitnum_intl(outputState, 11, 5) |
    bitnum_intl(outputState, 27, 6) | bitnum_intl(outputState, 16, 7) | bitnum_intl(outputState, 0, 8) |
    bitnum_intl(outputState, 14, 9) | bitnum_intl(outputState, 22, 10) | bitnum_intl(outputState, 25, 11) |
    bitnum_intl(outputState, 4, 12) | bitnum_intl(outputState, 17, 13) | bitnum_intl(outputState, 30, 14) |
    bitnum_intl(outputState, 9, 15) | bitnum_intl(outputState, 1, 16) | bitnum_intl(outputState, 7, 17) |
    bitnum_intl(outputState, 23, 18) | bitnum_intl(outputState, 13, 19) | bitnum_intl(outputState, 31, 20) |
    bitnum_intl(outputState, 26, 21) | bitnum_intl(outputState, 2, 22) | bitnum_intl(outputState, 8, 23) |
    bitnum_intl(outputState, 18, 24) | bitnum_intl(outputState, 12, 25) | bitnum_intl(outputState, 29, 26) |
    bitnum_intl(outputState, 5, 27) | bitnum_intl(outputState, 21, 28) | bitnum_intl(outputState, 10, 29) |
    bitnum_intl(outputState, 3, 30) | bitnum_intl(outputState, 24, 31)
  ) >>> 0;
}

/**
 * Standard single block DES crypt (enc/dec depending on key scheduling).
 */
function crypt(input_data: Uint8Array, key: number[][]): Uint8Array {
  let [s0, s1] = initial_permutation(input_data);

  for (let idx = 0; idx < 15; idx++) {
    const previous_s1 = s1;
    s1 = (f(s1, key[idx]) ^ s0) >>> 0;
    s0 = previous_s1;
  }
  s0 = (f(s1, key[15]) ^ s0) >>> 0;

  return inverse_permutation(s0, s1);
}

/**
 * Standard DES Key Scheduling.
 */
function key_schedule(key: Uint8Array, mode: number): number[][] {
  const schedule: number[][] = Array.from({ length: 16 }, () => new Array(6).fill(0));
  const key_rnd_shift = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
  const key_perm_c = [56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35];
  const key_perm_d = [62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3];
  const key_compression = [
    13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9, 22, 18, 11, 3, 25, 7, 15, 6, 26, 19, 12, 1,
    40, 51, 30, 36, 46, 54, 29, 39, 50, 44, 32, 47, 43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31
  ];

  let c = 0;
  for (let i = 0; i < 28; i++) {
    c |= bitnum(key, key_perm_c[i], 31 - i);
  }
  c >>>= 0;

  let d = 0;
  for (let i = 0; i < 28; i++) {
    d |= bitnum(key, key_perm_d[i], 31 - i);
  }
  d >>>= 0;

  for (let i = 0; i < 16; i++) {
    c = (((c << key_rnd_shift[i]) | (c >>> (28 - key_rnd_shift[i]))) & 0xfffffff0) >>> 0;
    d = (((d << key_rnd_shift[i]) | (d >>> (28 - key_rnd_shift[i]))) & 0xfffffff0) >>> 0;

    const togen = mode === 0 ? 15 - i : i;

    for (let j = 0; j < 6; j++) {
      schedule[togen][j] = 0;
    }

    for (let j = 0; j < 24; j++) {
      schedule[togen][Math.floor(j / 8)] |= bitnum_intr(c, key_compression[j], 7 - (j % 8));
    }

    for (let j = 24; j < 48; j++) {
      schedule[togen][Math.floor(j / 8)] |= bitnum_intr(d, key_compression[j] - 27, 7 - (j % 8));
    }
  }

  return schedule;
}

/**
 * 3DES Key Setup. Builds 3 schedules from the 24-byte key.
 */
function tripledes_key_setup(key: Uint8Array, mode: number): number[][][] {
  const key0 = key.subarray(0, 8);
  const key8 = key.subarray(8, 16);
  const key16 = key.subarray(16, 24);

  if (mode === 1) { // ENCRYPT
    return [
      key_schedule(key0, 1),
      key_schedule(key8, 0),
      key_schedule(key16, 1)
    ];
  } else { // DECRYPT
    return [
      key_schedule(key16, 0),
      key_schedule(key8, 1),
      key_schedule(key0, 0)
    ];
  }
}

/**
 * Encrypts/Decrypts 8-byte block using 3DES.
 */
function tripledes_crypt(data: Uint8Array, keySchedule: number[][][]): Uint8Array {
  let temp = data;
  for (let i = 0; i < 3; i++) {
    temp = crypt(temp, keySchedule[i]);
  }
  return temp;
}

/**
 * Helper to decompress raw deflate data using browser's DecompressionStream.
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
 * Decrypts QQ Music QRC lyrics string.
 * Supports Hex-encoded strings or raw Uint8Array.
 * Returns plain text XML-formatted QRC string.
 */
export async function qrcDecrypt(encryptedHexOrBytes: string | Uint8Array): Promise<string> {
  let encryptedBytes: Uint8Array;
  if (typeof encryptedHexOrBytes === 'string') {
    const hex = encryptedHexOrBytes.trim();
    encryptedBytes = new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  } else {
    encryptedBytes = encryptedHexOrBytes;
  }

  if (encryptedBytes.length === 0) {
    throw new Error('No data to decrypt');
  }

  const QRC_KEY = new TextEncoder().encode('!@#)(*$%123ZXC!@!@#)(NHL');
  const schedule = tripledes_key_setup(QRC_KEY, 0); // 0 = DECRYPT

  const decryptedBytes = new Uint8Array(encryptedBytes.length);
  for (let i = 0; i < encryptedBytes.length; i += 8) {
    const block = encryptedBytes.subarray(i, Math.min(i + 8, encryptedBytes.length));
    let paddedBlock = block;
    if (block.length < 8) {
      paddedBlock = new Uint8Array(8);
      paddedBlock.set(block);
    }
    const decryptedBlock = tripledes_crypt(paddedBlock, schedule);
    decryptedBytes.set(decryptedBlock.subarray(0, block.length), i);
  }

  return await decompressDeflate(decryptedBytes);
}
