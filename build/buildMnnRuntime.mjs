import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// build/buildMnnRuntime.mjs
// Builds native/folia-mnn - MNN, CPU only, plus our FoliaDConv operator and the beat_this builder - into
// the one shared library electron/analysis/mnn.cjs loads, for the platform and architecture being
// packaged. Called from build/beforePack.cjs; runnable by hand for a dev build:
//
//   node build/buildMnnRuntime.mjs [platform] [arch]      (defaults: this machine)
//
// Output: build/mnn/<mac|win|linux>-<arch>/<libfolia_mnn.dylib | folia_mnn.dll | libfolia_mnn.so>,
// shipped as resources/mnn by package.json's extraResources - the same layout build/ffmpeg uses.
//
// MNN comes from source at one pinned commit, fetched with git (whose object ids are the integrity
// check: the checkout is refused unless HEAD is exactly MNN_COMMIT), never a prebuilt binary. One patch
// is applied: MNN opens files on Windows through MultiByteToWideChar(CP_ACP), the ANSI code page, while
// every path it is given here is UTF-8 - so a models directory under a Chinese user name, the common
// case for this app, would not open. CP_UTF8 instead, and the character count fixed while at it (MNN
// passes the buffer's size in bytes where the call wants characters).
//
// Needs cmake >= 3.24 and a C++17 compiler: Xcode's clang on macOS (both architectures, from either
// machine), MSVC on Windows, gcc on Linux. Only macOS cross-builds; elsewhere the target must be the host.
// A finished build is reused while MNN_COMMIT, the patch and native/folia-mnn's sources are unchanged.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NATIVE = path.join(ROOT, 'native', 'folia-mnn');

/** MNN 3.6.1. The red lines (htdemucs: src/services/automix/MODELS.md §2.7) and beat_this' were measured on this. */
export const MNN_COMMIT = 'd407447ed56c4121a11ccbd266dc184ca1ead0c2';
const MNN_REMOTE = 'https://github.com/alibaba/MNN.git';

const OS_NAMES = Object.freeze({ darwin: 'mac', linux: 'linux', win32: 'win' });
const LIBRARY_FILES = Object.freeze({ darwin: 'libfolia_mnn.dylib', linux: 'libfolia_mnn.so', win32: 'folia_mnn.dll' });
const OSX_ARCHS = Object.freeze({ x64: 'x86_64', arm64: 'arm64' });
/** Electron 43's own floor. */
const MACOS_DEPLOYMENT_TARGET = '12.0';

const PATCH = Object.freeze({
    file: path.join('source', 'core', 'FileLoader.cpp'),
    from: 'MultiByteToWideChar(CP_ACP, 0, file, -1, wFilename, sizeof(wFilename))',
    to: 'MultiByteToWideChar(CP_UTF8, 0, file, -1, wFilename, sizeof(wFilename) / sizeof(wFilename[0]))',
});

const run = (command, args, options = {}) => {
    const result = spawnSync(command, args, { stdio: 'inherit', ...options });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
    return result;
};

const output = (command, args, options = {}) => {
    const result = spawnSync(command, args, { encoding: 'utf8', ...options });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${result.status}: ${result.stderr}`);
    return result.stdout.trim();
};

/** The pinned MNN tree under build/.mnn-src, fetched and patched once. */
const mnnSource = async () => {
    const dir = path.join(ROOT, 'build', '.mnn-src', MNN_COMMIT);
    if (!existsSync(path.join(dir, '.git'))) {
        await rm(dir, { recursive: true, force: true });
        await mkdir(dir, { recursive: true });
        run('git', ['init', '--quiet'], { cwd: dir });
        run('git', ['fetch', '--quiet', '--depth', '1', MNN_REMOTE, MNN_COMMIT], { cwd: dir });
        run('git', ['checkout', '--quiet', 'FETCH_HEAD'], { cwd: dir });
    }
    const head = output('git', ['rev-parse', 'HEAD'], { cwd: dir });
    if (head !== MNN_COMMIT) throw new Error(`${dir} is at ${head}, not the pinned ${MNN_COMMIT}`);

    const file = path.join(dir, PATCH.file);
    const text = await readFile(file, 'utf8');
    if (!text.includes(PATCH.to)) {
        if (!text.includes(PATCH.from)) throw new Error(`${PATCH.file} no longer reads as expected; the UTF-8 path patch does not apply`);
        await writeFile(file, text.replace(PATCH.from, PATCH.to));
    }
    return dir;
};

/** What a cached build must match: the commit, the patch, and every source file of ours. */
const fingerprint = async () => {
    const hash = createHash('sha256').update(MNN_COMMIT).update(JSON.stringify(PATCH)).update(MACOS_DEPLOYMENT_TARGET);
    for (const name of (await readdir(NATIVE)).sort()) hash.update(name).update(await readFile(path.join(NATIVE, name)));
    return hash.digest('hex');
};

/**
 * Builds the library for `platform`/`arch` if build/mnn does not already hold a current one, and returns
 * the directory extraResources copies.
 */
export async function prepareBundledMnn({ platform = process.platform, arch = process.arch } = {}) {
    const osName = OS_NAMES[platform];
    const library = LIBRARY_FILES[platform];
    if (!osName || !library) throw new Error(`No MNN runtime build for ${platform}`);
    if (platform === 'darwin' ? !OSX_ARCHS[arch] : arch !== process.arch) {
        throw new Error(`Cannot build the MNN runtime for ${platform}/${arch} on ${process.platform}/${process.arch}`);
    }
    if (platform !== process.platform) throw new Error(`Cannot build the MNN runtime for ${platform} on ${process.platform}`);

    const key = `${osName}-${arch}`;
    const outDir = path.join(ROOT, 'build', 'mnn', key);
    const marker = path.join(outDir, 'BUILD-INFO.txt');
    const print = await fingerprint();
    const stamp = `MNN ${MNN_COMMIT}\nInputs SHA-256: ${print}\n`;
    try {
        if ((await readFile(marker, 'utf8')) === stamp && existsSync(path.join(outDir, library))) return outDir;
    } catch {
        // Missing or stale: built below.
    }

    const source = await mnnSource();
    const buildDir = path.join(ROOT, 'build', '.mnn-build', key);
    const configure = ['-S', NATIVE, '-B', buildDir, `-DMNN_SOURCE_DIR=${source}`, '-DCMAKE_BUILD_TYPE=Release'];
    if (platform === 'darwin') {
        configure.push(`-DCMAKE_OSX_ARCHITECTURES=${OSX_ARCHS[arch]}`, `-DCMAKE_OSX_DEPLOYMENT_TARGET=${MACOS_DEPLOYMENT_TARGET}`);
    }
    if (platform === 'win32') configure.push('-A', arch === 'arm64' ? 'ARM64' : 'x64');
    run('cmake', configure);
    run('cmake', ['--build', buildDir, '--config', 'Release', '--target', 'folia_mnn', '--parallel']);

    // Multi-config generators (Visual Studio) put it under Release/.
    const built = [path.join(buildDir, library), path.join(buildDir, 'Release', library)].find(file => existsSync(file));
    if (!built) throw new Error(`cmake finished but ${library} is not in ${buildDir}`);
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });
    await copyFile(built, path.join(outDir, library));
    await writeFile(marker, stamp);
    console.log(`[mnn] ${key}: ${path.join(outDir, library)}`);
    return outDir;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [platform, arch] = process.argv.slice(2);
    prepareBundledMnn({ platform: platform || undefined, arch: arch || undefined }).catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
