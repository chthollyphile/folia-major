import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// packaging/ffmpeg/windows-arm64.mjs
// Build the missing upstream target from pinned source; never substitute an x64 runtime.

export const FFMPEG_SOURCE_VERSION = '8.1.2';
export const FFMPEG_SOURCE_SHA256 = '32faba5ef67340d54724941eae1425580791195312a4fd13bf6f820a2818bf22';
const SOURCE_URL = `https://ffmpeg.org/releases/ffmpeg-${FFMPEG_SOURCE_VERSION}.tar.gz`;
const BUILD_SCRIPT = fileURLToPath(new URL('./build-windows-arm64.sh', import.meta.url));
const sha256 = data => createHash('sha256').update(data).digest('hex');

export function assertArm64Executable(binary) {
  const pe = binary.length >= 64 ? binary.readUInt32LE(0x3c) : -1;
  if (binary.toString('ascii', 0, 2) !== 'MZ' || pe < 0 || pe + 6 > binary.length
      || binary.toString('ascii', pe, pe + 4) !== 'PE\0\0'
      || binary.readUInt16LE(pe + 4) !== 0xaa64) {
    throw new Error('Bundled Windows ARM64 FFmpeg is not an ARM64 PE executable');
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}); use MSYS2 CLANGARM64 with clang, make and diffutils installed`);
}

// Cache only binaries matching the pinned source, current build recipe, and recorded binary hash.
export async function prepareWindowsArm64Ffmpeg({ outputRoot }) {
  const target = path.join(outputRoot, 'win-arm64');
  const script = await readFile(BUILD_SCRIPT);
  const markerPrefix = `Source: ${SOURCE_URL}\nSource SHA-256: ${FFMPEG_SOURCE_SHA256}\nBuild script SHA-256: ${sha256(script)}\n`;
  try {
    const marker = await readFile(path.join(target, 'BUNDLE-INFO.txt'), 'utf8');
    const binary = await readFile(path.join(target, 'ffmpeg.exe'));
    assertArm64Executable(binary);
    if (marker.startsWith(markerPrefix) && marker.includes(`Binary SHA-256: ${sha256(binary)}\n`)) return target;
  } catch {
    // A missing, stale, corrupt, or wrong-architecture bundle must be rebuilt.
  }

  console.log('[ffmpeg] building native Windows ARM64 FFmpeg from pinned source');
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'folia-ffmpeg-arm64-'));
  try {
    const response = await fetch(SOURCE_URL);
    if (!response.ok) throw new Error(`Unable to download ${SOURCE_URL}: HTTP ${response.status}`);
    const archive = Buffer.from(await response.arrayBuffer());
    if (sha256(archive) !== FFMPEG_SOURCE_SHA256) throw new Error('FFmpeg source checksum mismatch');
    const archivePath = path.join(temporary, 'source.tar.gz');
    await writeFile(archivePath, archive);
    run('tar', ['-xzf', 'source.tar.gz'], temporary);
    const source = path.join(temporary, `ffmpeg-${FFMPEG_SOURCE_VERSION}`);
    const install = path.join(temporary, 'install');
    await writeFile(path.join(source, 'folia-build.sh'), script);
    run('bash', ['./folia-build.sh', source, install], source);
    const binary = await readFile(path.join(install, 'bin', 'ffmpeg.exe'));
    assertArm64Executable(binary);

    // Write the marker last so interrupted builds cannot become valid cache hits.
    await rm(target, { recursive: true, force: true });
    const metadata = path.join(target, 'share', 'folia-ffmpeg');
    await mkdir(metadata, { recursive: true });
    await writeFile(path.join(target, 'ffmpeg.exe'), binary);
    await cp(path.join(source, 'COPYING.LGPLv2.1'), path.join(metadata, 'FFmpeg-LGPL-2.1.txt'));
    await writeFile(path.join(metadata, 'build-windows-arm64.sh'), script);
    const configLog = await readFile(path.join(source, 'ffbuild', 'config.log'), 'utf8');
    await writeFile(path.join(metadata, 'BUILD-INFO.txt'), `${markerPrefix}Configure: ${configLog.split('\n').find(line => line.includes('./configure ')) || 'see build-windows-arm64.sh'}\n`);
    await writeFile(path.join(target, 'BUNDLE-INFO.txt'), `${markerPrefix}Binary SHA-256: ${sha256(binary)}\n`);
    return target;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
