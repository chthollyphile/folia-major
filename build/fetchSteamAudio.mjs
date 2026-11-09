import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

// build/fetchSteamAudio.mjs
// Puts Steam Audio's library (the scene engine's room sound, electron/acoustics/) into build/steam-audio/,
// one folder per electron-builder `${os}-${arch}`, from where extraResources takes the right one into
// each package and a dev run (`npm run dev:electron:dist`) loads it directly. Run by hand
// (`npm run steam-audio:fetch`), by dev:electron:dist (`--optional`: a failure only warns, the app runs
// without room sound) and by build/beforePack.cjs (a failure stops the build).
//
// The official SDK zip comes from STEAM_AUDIO_ZIP (a local copy) or the official GitHub release, and is
// used only if its sha256 is the one pinned here. Only the desktop libraries and the license notice are
// kept; the zip itself (181 MB) is never written to disk by this script.

export const STEAM_AUDIO_VERSION = '4.8.1';
const ZIP_URL = `https://github.com/ValveSoftware/steam-audio/releases/download/v${STEAM_AUDIO_VERSION}/steamaudio_${STEAM_AUDIO_VERSION}.zip`;
const ZIP_SHA256 = '4a0aa5ec1176f38f0b0993a37c2259d9e86f27e22d5e24f83ec4c3cb9a1d5449';

export const VENDOR_DIR = join(dirname(fileURLToPath(import.meta.url)), 'steam-audio');
/** Says which zip the folders came from; written last, so a half-finished run is never taken as done. */
const STAMP = join(VENDOR_DIR, 'SOURCE-SHA256');

/** Zip entry -> the `${os}-${arch}` folders it goes into. The macOS dylib is universal (x64 and arm64). */
const WANTED = {
    'steamaudio/lib/windows-x64/phonon.dll': ['win-x64'],
    'steamaudio/lib/linux-x64/libphonon.so': ['linux-x64'],
    'steamaudio/lib/osx/libphonon.dylib': ['mac-x64', 'mac-arm64'],
    // The SDK zip's only license file: the third-party notices (IPP, FFTS, ...) that must travel with the library.
    // Steam Audio's own Apache-2.0 text is not in the zip: build/steamAudio.LICENSE.md (from the v4.8.1 tag), shipped by extraResources.
    'steamaudio/THIRDPARTY.md': ['win-x64', 'linux-x64', 'mac-x64', 'mac-arm64'],
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const baseName = (entry) => entry.slice(entry.lastIndexOf('/') + 1);
const targets = () => Object.entries(WANTED).flatMap(([entry, folders]) => folders.map(folder => join(VENDOR_DIR, folder, baseName(entry))));

const alreadyThere = async () => existsSync(STAMP)
    && (await readFile(STAMP, 'utf8')).trim() === ZIP_SHA256
    && targets().every(file => existsSync(file));

const readZip = async () => {
    const local = process.env.STEAM_AUDIO_ZIP;
    if (local) {
        console.log(`[steam-audio] reading ${local}`);
        return readFile(local);
    }
    console.log(`[steam-audio] downloading ${ZIP_URL}`);
    const response = await fetch(ZIP_URL, { redirect: 'follow' });
    if (!response.ok) throw new Error(`${ZIP_URL}: ${response.status} ${response.statusText}`);
    return Buffer.from(await response.arrayBuffer());
};

/** Fills build/steam-audio/ unless it already holds this version. With `optional`, a failure only warns. */
export async function prepareSteamAudio({ optional = false } = {}) {
    try {
        if (await alreadyThere()) {
            console.log(`[steam-audio] ${STEAM_AUDIO_VERSION} already in ${VENDOR_DIR}`);
            return;
        }
        const zip = await readZip();
        const hash = sha256(zip);
        if (hash !== ZIP_SHA256) throw new Error(`the SDK zip's sha256 is ${hash}, wanted ${ZIP_SHA256}`);
        const entries = unzipSync(new Uint8Array(zip.buffer, zip.byteOffset, zip.byteLength), { filter: file => file.name in WANTED });
        await rm(VENDOR_DIR, { recursive: true, force: true });
        for (const [entry, folders] of Object.entries(WANTED)) {
            if (!entries[entry]) throw new Error(`the SDK zip has no ${entry}`);
            for (const folder of folders) {
                await mkdir(join(VENDOR_DIR, folder), { recursive: true });
                await writeFile(join(VENDOR_DIR, folder, baseName(entry)), entries[entry]);
            }
        }
        await writeFile(STAMP, `${ZIP_SHA256}\n`);
        console.log(`[steam-audio] ${STEAM_AUDIO_VERSION} verified and written to ${VENDOR_DIR}`);
    } catch (error) {
        if (!optional) throw error;
        console.warn(`[steam-audio] not prepared, the scene room sound will be off: ${error?.message || error}`);
    }
}

// Run directly (`npm run steam-audio:fetch`, or `--optional` from dev:electron:dist).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    await prepareSteamAudio({ optional: process.argv.includes('--optional') });
}
