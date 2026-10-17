import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareBundledFfmpeg } from '../../../packaging/ffmpeg/fetch-ffmpeg.mjs';
import {
  assertArm64Executable,
  FFMPEG_SOURCE_SHA256,
  FFMPEG_SOURCE_VERSION,
  prepareWindowsArm64Ffmpeg,
} from '../../../packaging/ffmpeg/windows-arm64.mjs';

// test/unit/electron/windowsArm64Ffmpeg.test.ts
// Exercise source verification and cache invalidation without invoking a compiler or the network.

const directories: string[] = [];
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');

function executable(machine = 0xaa64) {
  const binary = Buffer.alloc(128);
  binary.write('MZ');
  binary.writeUInt32LE(64, 0x3c);
  binary.write('PE\0\0', 64);
  binary.writeUInt16LE(machine, 68);
  return binary;
}

async function cachedBundle() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'folia-arm64-test-'));
  directories.push(root);
  const target = path.join(root, 'win-arm64');
  await mkdir(target);
  const binary = executable();
  const script = await readFile('packaging/ffmpeg/build-windows-arm64.sh');
  const marker = `Source: https://ffmpeg.org/releases/ffmpeg-${FFMPEG_SOURCE_VERSION}.tar.gz\nSource SHA-256: ${FFMPEG_SOURCE_SHA256}\nBuild script SHA-256: ${hash(script)}\nBinary SHA-256: ${hash(binary)}\n`;
  await writeFile(path.join(target, 'ffmpeg.exe'), binary);
  await writeFile(path.join(target, 'BUNDLE-INFO.txt'), marker);
  return { root, target, marker };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('native Windows ARM64 FFmpeg', () => {
  it('rejects truncated and x64 executables', () => {
    expect(() => assertArm64Executable(Buffer.from('MZ'))).toThrow('ARM64 PE');
    expect(() => assertArm64Executable(executable(0x8664))).toThrow('ARM64 PE');
    expect(() => assertArm64Executable(executable())).not.toThrow();
  });

  it('reuses a cache only when source, recipe, architecture and binary hash match', async () => {
    const { root, target } = await cachedBundle();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(prepareBundledFfmpeg({ platform: 'win32', arch: 'arm64', outputRoot: root })).resolves.toBe(target);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['binary', 'recipe', 'architecture'])('rebuilds a cache with changed %s', async change => {
    const { root, target, marker } = await cachedBundle();
    if (change === 'recipe') {
      await writeFile(path.join(target, 'BUNDLE-INFO.txt'), marker.replace('Build script SHA-256:', 'Old recipe:'));
    } else {
      await writeFile(path.join(target, 'ffmpeg.exe'), change === 'architecture' ? executable(0x8664) : Buffer.concat([executable(), Buffer.from('tampered')]));
    }
    const fetch = vi.fn().mockResolvedValue(new Response('not a trusted source archive'));
    vi.stubGlobal('fetch', fetch);
    await expect(prepareWindowsArm64Ffmpeg({ outputRoot: root })).rejects.toThrow('source checksum mismatch');
    expect(fetch).toHaveBeenCalledOnce();
  });
});
