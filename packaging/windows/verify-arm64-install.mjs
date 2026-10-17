import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { assertArm64Executable } from '../ffmpeg/windows-arm64.mjs';

// packaging/windows/verify-arm64-install.mjs
// Exercise the real NSIS extraction path: a valid pre-install directory alone missed #9983.

function run(file, args, options = {}) {
  const result = spawnSync(file, args, { encoding: 'utf8', windowsHide: true, timeout: 180_000, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${file} failed (${result.status}): ${result.stderr || result.stdout}`);
  return result.stdout;
}

async function* files(directory, relative = '') {
  for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) yield* files(directory, next);
    else if (entry.isFile()) yield next;
  }
}

// Compare every installed payload file, including native libraries that Nsis7z can silently skip.
async function verifyFiles(expected, installed) {
  let count = 0;
  for await (const relative of files(expected)) {
    const hash = binary => createHash('sha256').update(binary).digest('hex');
    const source = await readFile(path.join(expected, relative));
    const result = await readFile(path.join(installed, relative));
    if (hash(source) !== hash(result)) throw new Error(`Installed file differs: ${relative}`);
    count++;
  }
  console.log(`Verified ${count} installed files against the packaged payload`);
}

// Exercise local WAV decoding, resampling, FLAC encoding and decoding without external fixtures.
async function verifyAudio(ffmpeg, temporary) {
  console.log(run(ffmpeg, ['-version']).split('\n')[0]);
  const wav = Buffer.alloc(44 + 1600);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(1600, 40);
  const input = path.join(temporary, 'input.wav');
  const flac = path.join(temporary, 'output.flac');
  const output = path.join(temporary, 'output.wav');
  await writeFile(input, wav);
  run(ffmpeg, ['-v', 'error', '-i', input, '-ar', '16000', '-c:a', 'flac', flac]);
  run(ffmpeg, ['-v', 'error', '-i', flac, '-c:a', 'pcm_s16le', output]);
  if ((await readFile(flac)).toString('ascii', 0, 4) !== 'fLaC' || (await stat(output)).size <= 44) {
    throw new Error('Native FFmpeg audio round-trip failed');
  }
}

if (process.platform !== 'win32' || process.arch !== 'arm64') {
  throw new Error('Run the installer check on native Windows ARM64');
}
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const installer = path.resolve(`release/Folia-Setup-${version}-arm64.exe`);
const temporary = await mkdtemp(path.join(os.tmpdir(), 'folia-install-check-'));
const installed = path.join(temporary, 'app');
try {
  // /D must be the last argument. Silent installs do not launch the application.
  run(installer, ['/S', `/D=${installed}`], { windowsVerbatimArguments: true });
  await verifyFiles(path.resolve('release/win-arm64-unpacked'), installed);
  const binaries = [
    'Folia.exe',
    'resources/folia-wallpaper-helper.exe',
    'resources/ffmpeg-audio/ffmpeg.exe',
    'resources/app.asar.unpacked/node_modules/@koromix/koffi-win32-arm64/win32_arm64/koffi.node',
    'resources/app.asar.unpacked/node_modules/onnxruntime-node/bin/napi-v6/win32/arm64/onnxruntime_binding.node',
  ];
  for (const binary of binaries) {
    assertArm64Executable(await readFile(path.join(installed, binary)));
    console.log(`ARM64: ${binary}`);
  }
  await verifyAudio(path.join(installed, 'resources/ffmpeg-audio/ffmpeg.exe'), temporary);
} finally {
  const uninstaller = path.join(installed, 'Uninstall Folia.exe');
  try {
    const present = await stat(uninstaller).then(() => true, error => {
      if (error.code === 'ENOENT') return false;
      throw error;
    });
    // _?= keeps the uninstaller in this process so cleanup waits for it to finish.
    if (present) run(uninstaller, ['/S', `_?=${installed}`], { windowsVerbatimArguments: true });
  } finally {
    await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  }
}
