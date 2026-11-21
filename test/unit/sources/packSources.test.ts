import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    PACK_LIMITS, claimsFor, findPackable, listPackable, loadSigningKey, packSource, packedManifest, parseArgs, signingKeyText,
} from '../../../dev/sources/pack.mjs';

// test/unit/sources/packSources.test.ts
// dev/sources/pack.mjs（npm run sources:pack，Folium 2.0 方案 §5.1、§6.2 的合规预案）：把一个构建好的音源模组目录打成 zip，
// 再用宿主自己的「从 zip 安装」（zipInstall.cjs）装进一个临时的 userData/mods，核对装上的东西：包里的 claims 过得了
// 受信表的核对、在不带这个音源的安装里由它接管短 id，带着时未签名的不覆盖；签了名的用宿主的验签是 verified，
// 装上后再改一个字节就是 digest-mismatch；还有上限、build.json 对不上、私钥不对时报的错。

const requireHere = createRequire(import.meta.url);
const { unzipSync } = requireHere('fflate') as { unzipSync: (data: Uint8Array) => Record<string, Uint8Array> };
const { createZipInstall } = requireHere('../../../electron/modSystem/zipInstall.cjs');
const { validateManifest } = requireHere('../../../electron/modSystem/manifest.cjs');
const { verifyModSignature } = requireHere('../../../electron/modSystem/modSignature.cjs');
const { BUILTIN_SOURCE_TABLE, builtinModOfSource, builtinSourceRow } = requireHere('../../../electron/modSystem/builtinSources.cjs');
const { claimRefusal, resolveSourceOwnership } = requireHere('../../../electron/modSystem/sourceOwnership.cjs');
const { resolveModNativeFile } = requireHere('../../../electron/modSystem/nativeFiles.cjs');
const { WINDOWS_COMPANION_FILES } = requireHere('../../../sources/appleMusic/native/windows/prepareBundle.cjs');

// 一把只给测试用的钥匙，不在任何受信表里；packSource 与验签都换成只认它的表。
const { publicKey: TEST_PUBLIC, privateKey: TEST_PRIVATE } = crypto.generateKeyPairSync('ed25519');
const TEST_KEY_ID = 'folium-pack-test';
const TEST_KEYS = [{ keyId: TEST_KEY_ID, label: 'Test', publicKey: TEST_PUBLIC.export({ format: 'jwk' }), revoked: false }];
const TEST_PEM = TEST_PRIVATE.export({ format: 'pem', type: 'pkcs8' }).toString();

let work: string;
const temporary = (name: string) => fs.mkdtempSync(path.join(work, `${name}-`));

/** 摆一个 sources:build 产出的样子的模组目录：mod.json、入口、一个 deps 归档、语言表和记着文件表的 build.json。 */
const makeBuilt = (dirName: string, manifest: Record<string, unknown>, extra: Record<string, string | Buffer> = {}) => {
    const dir = path.join(temporary('dist'), dirName);
    const files: Record<string, string | Buffer> = {
        'mod.json': `${JSON.stringify(manifest, null, 2)}\n`,
        'client.mjs': 'export function activate() {}\n',
        'index.cjs': 'module.exports = { default() {} };\n',
        'deps.0123456789abcdef.asar': Buffer.alloc(4096, 7),
        'locales/zh-CN.json': '{}\n',
        'README.md': '# readme\n',
        ...extra,
    };
    for (const [name, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
        fs.writeFileSync(path.join(dir, name), content);
    }
    fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({ fingerprint: '0', modId: manifest.id, files: Object.keys(files).sort() }));
    return dir;
};

/* A repository root with what sources:pack takes native files from: librespot's package (every system's build) and nothing else. */
const fakeRoot = () => {
    const root = temporary('root');
    const librespot = path.join(root, 'node_modules', '@lox-audioserver', 'node-librespot');
    const files: Record<string, string | Buffer> = {
        'package.json': JSON.stringify({ name: '@lox-audioserver/node-librespot', version: '0.5.1', main: 'dist/index.js', license: 'Apache-2.0' }),
        'dist/index.js': 'module.exports = require("./types");\n',
        'dist/types.js': 'module.exports = {};\n',
        'prebuilds/win32-x64-msvc/librespot_addon.node': Buffer.alloc(8192, 1),
        'prebuilds/linux-x64-gnu/librespot_addon.node': Buffer.alloc(2048, 2),
    };
    for (const [name, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(librespot, name)), { recursive: true });
        fs.writeFileSync(path.join(librespot, name), content);
    }
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'folia' }));
    return root;
};

const sourceManifest = (id: string, sourceId: string, more: Record<string, unknown> = {}) => ({
    folium: 2,
    id,
    name: id,
    version: '1.0.0',
    client: 'client.mjs',
    main: 'index.cjs',
    locales: 'locales',
    sources: [{ id: sourceId, name: { 'zh-CN': sourceId, en: sourceId }, requires: ['search@1'] }],
    ...more,
});

/** 用宿主的 installModFromZip 装进一个临时 userData；交回装上的目录。 */
const install = async (zipPath: string) => {
    const userData = temporary('userdata');
    const zipInstall = createZipInstall({
        app: { getPath: () => userData },
        isModSystemEnabled: () => true,
        loadAll: async () => [],
        emitLog: () => {},
        serializeError: (error: Error) => error.message,
    });
    const result = await zipInstall.installModFromZip(zipPath);
    expect(result).toMatchObject({ ok: true });
    return path.join(userData, 'mods', result.id as string);
};

beforeAll(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-pack-test-'));
});

afterAll(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

describe('the packed manifest', () => {
    it('claims the trusted row of a built-in source, with only the lists that row has', () => {
        for (const [modId, row] of Object.entries(BUILTIN_SOURCE_TABLE) as [string, { sources: string[]; storeKeys: string[]; partitions: string[]; userDataDirs: string[]; legacyCacheDirs?: string[] }][]) {
            const claims = claimsFor(modId, row.sources[0]) ?? { id: '' };
            expect(claims.id).toBe(row.sources[0]);
            expect(claims.storeKeys ?? []).toEqual(row.storeKeys);
            expect(claims.partitions ?? []).toEqual(row.partitions);
            expect(claims.userDataDirs ?? []).toEqual(row.userDataDirs);
            expect(claims.legacyCacheDirs ?? []).toEqual(row.legacyCacheDirs ?? []);
            // What the host checks a takeover's claims against (sourceOwnership.cjs).
            expect(claimRefusal(claims, (shortId: string) => builtinSourceRow(builtinModOfSource(shortId)))).toBeNull();
        }
    });

    it('has no claims for a mod the trusted table does not know, or for a source not in its row', () => {
        expect(claimsFor('someone-else', 'thing')).toBeNull();
        expect(claimsFor('qishui', 'bodian')).toBeNull();
        const manifest = packedManifest(sourceManifest('someone-else', 'thing'));
        expect((manifest.sources as { claims?: unknown }[])[0].claims).toBeUndefined();
    });

    it('keeps claims already written, and sets the version and the host range when asked', () => {
        const own = { id: 'qishui', storeKeys: ['QISHUI_DEVICE_ID'] };
        const base = sourceManifest('qishui', 'qishui');
        (base.sources as Record<string, unknown>[])[0].claims = own;
        const manifest = packedManifest(base, { version: '1.0.1', folia: '>=0.8.0' });
        expect((manifest.sources as { claims?: unknown }[])[0].claims).toBe(own);
        expect(manifest.version).toBe('1.0.1');
        expect(manifest.folia).toBe('>=0.8.0');
        expect(base.version).toBe('1.0.0');
    });
});

describe('packing and installing from zip', () => {
    it('packs one top folder without build.json, unsigned, and the host installs it as a takeover of the short id', async () => {
        const dist = makeBuilt('qishui', sourceManifest('qishui', 'qishui'));
        const outRoot = temporary('packs');
        const result = packSource(dist, { outRoot, folia: '>=0.7.29' });
        expect(path.basename(result.zipPath)).toBe('qishui-1.0.0-unsigned.zip');
        expect(result.signature).toBeNull();
        expect(result.notes.join('\n')).toContain('未签名');

        const entries = Object.keys(unzipSync(fs.readFileSync(result.zipPath)));
        expect(entries.every((name) => name.startsWith('qishui/'))).toBe(true);
        expect(entries).not.toContain('qishui/build.json');
        expect(entries).toContain('qishui/deps.0123456789abcdef.asar');
        expect(entries).not.toContain('qishui/folium.sig.json');

        const installed = await install(result.zipPath);
        const manifest = JSON.parse(fs.readFileSync(path.join(installed, 'mod.json'), 'utf8'));
        expect(manifest.folia).toBe('>=0.7.29');
        expect(manifest.sources[0].claims).toEqual(claimsFor('qishui', 'qishui'));
        expect(fs.readFileSync(path.join(installed, 'deps.0123456789abcdef.asar'))).toEqual(Buffer.alloc(4096, 7));
        expect(verifyModSignature(installed, manifest).status).toBe('unsigned');

        // The ownership rules of the loader: an installation without the source lets the holder on record take the id.
        const validated = validateManifest(manifest).value;
        const ownership = (bundled: string[], builtins: Map<string, unknown>) => resolveSourceOwnership(
            builtins,
            new Map([['qishui', { manifest: validated, dirPath: installed, digest: 'd', signature: { status: 'unsigned' }, enabled: true }]]),
            bundled,
            {
                hostVersion: '0.7.29',
                tableRow: builtinSourceRow,
                sourceRow: (shortId: string) => builtinSourceRow(builtinModOfSource(shortId)),
                isOverrideConfirmed: () => true,
                claimRecord: (shortId: string) => (shortId === 'qishui' ? 'qishui' : null),
            },
        );
        const taken = ownership(['netease'], new Map());
        expect(taken.claimHolders.get('qishui')).toBe('qishui');
        expect(taken.sources.get('qishui')[0]).toMatchObject({ sourceId: 'qishui', takeover: true });
        // An installation that carries it keeps its built-in copy: an unsigned copy does not override.
        const carried = ownership(['qishui'], new Map([['qishui', { manifest: { ...validated, version: '1.0.0' }, dirPath: dist }]]));
        expect(carried.refused.get('qishui')).toMatchObject({ reason: 'override-not-verified' });
    });

    it('signs with a key of the trusted list: verified once installed, digest-mismatch after a byte changes', async () => {
        const dist = makeBuilt('qishui', sourceManifest('qishui', 'qishui'));
        const signingKey = loadSigningKey(TEST_PEM, TEST_KEY_ID, TEST_KEYS);
        const result = packSource(dist, {
            outRoot: temporary('packs'), version: '1.0.1', signingKey, trustedKeys: TEST_KEYS, now: () => new Date('2026-11-21T00:00:00Z'),
        });
        expect(path.basename(result.zipPath)).toBe('qishui-1.0.1.zip');
        expect(result.signature).toMatchObject({ status: 'verified', keyId: TEST_KEY_ID });
        expect(result.notes.join('\n')).not.toContain('版本');

        const installed = await install(result.zipPath);
        const manifest = JSON.parse(fs.readFileSync(path.join(installed, 'mod.json'), 'utf8'));
        const record = JSON.parse(fs.readFileSync(path.join(installed, 'folium.sig.json'), 'utf8'));
        expect(record).toMatchObject({ modId: 'qishui', modVersion: '1.0.1', digest: result.digest, keyId: TEST_KEY_ID, signedAt: '2026-11-21T00:00:00.000Z' });
        expect(verifyModSignature(installed, manifest, { keys: TEST_KEYS, revokedDigests: [] }).status).toBe('verified');

        fs.appendFileSync(path.join(installed, 'client.mjs'), '//');
        expect(verifyModSignature(installed, manifest, { keys: TEST_KEYS, revokedDigests: [] })).toMatchObject({ status: 'invalid', reason: 'digest-mismatch' });
    });

    it('says when a signed copy cannot override: the version is not higher', () => {
        const dist = makeBuilt('qishui', sourceManifest('qishui', 'qishui'));
        const signingKey = loadSigningKey(TEST_PEM, TEST_KEY_ID, TEST_KEYS);
        const result = packSource(dist, { outRoot: temporary('packs'), signingKey, trustedKeys: TEST_KEYS });
        expect(result.notes.join('\n')).toContain('覆盖内置副本要版本更高');
    });

    it('carries no native file its trusted row does not list, and a mod the table does not know gets no short id', () => {
        const native = packSource(makeBuilt('qishui', sourceManifest('qishui', 'qishui', { native: ['librespot'] })), { outRoot: temporary('packs'), nativeRoot: fakeRoot() });
        expect(native.files.some((file: string) => file.startsWith('native/'))).toBe(false);
        const stranger = packSource(makeBuilt('thing', sourceManifest('someone-else', 'thing')), { outRoot: temporary('packs') });
        expect(stranger.notes.join('\n')).toContain('不在受信表里');
    });

    it('produces the same bytes twice when unsigned', () => {
        const dist = makeBuilt('qishui', sourceManifest('qishui', 'qishui'));
        const first = fs.readFileSync(packSource(dist, { outRoot: temporary('packs'), folia: null }).zipPath);
        const second = fs.readFileSync(packSource(dist, { outRoot: temporary('packs'), folia: null }).zipPath);
        expect(first.equals(second)).toBe(true);
    });
});

describe('native files, by system', () => {
    const spotify = () => makeBuilt('spotify', sourceManifest('spotify', 'spotify', { native: ['librespot'] }));
    const appleMusic = () => makeBuilt('appleMusic', sourceManifest('apple-music', 'appleMusic', { native: ['apple-music-companion'] }));

    it('carries the system\'s librespot where the host looks for it, and the takeover resolves it once installed', async () => {
        const result = packSource(spotify(), { outRoot: temporary('packs'), system: 'win32-x64', nativeRoot: fakeRoot() });
        expect(result.system).toBe('win32-x64');
        expect(path.basename(result.zipPath)).toBe('spotify-1.0.0-win32-x64-unsigned.zip');
        expect(result.files.filter((file: string) => file.startsWith('native/'))).toEqual([
            'native/librespot/win32-x64/dist/index.js',
            'native/librespot/win32-x64/dist/types.js',
            'native/librespot/win32-x64/package.json',
            'native/librespot/win32-x64/prebuilds/win32-x64-msvc/librespot_addon.node',
        ]);
        expect(result.notes.join('\n')).toContain('带原生件 librespot（win32-x64');
        const installed = await install(result.zipPath);
        const resolved = resolveModNativeFile('librespot', installed, { platform: 'win32', arch: 'x64', fs });
        expect(resolved).toEqual({ path: path.join(installed, 'native', 'librespot', 'win32-x64', 'dist', 'index.js') });
        // The other systems' builds stay out.
        expect(fs.existsSync(path.join(installed, 'native', 'librespot', 'win32-x64', 'prebuilds', 'linux-x64-gnu'))).toBe(false);
    });

    it('says what it leaves out on a system without a build, and with --no-native', () => {
        const none = packSource(spotify(), { outRoot: temporary('packs'), system: 'darwin-x64', nativeRoot: fakeRoot() });
        expect(none.files.some((file: string) => file.startsWith('native/'))).toBe(false);
        expect(none.notes.join('\n')).toMatch(/不带原生件 librespot：.*darwin-x64.*native-not-in-mod/);
        // Nothing carried: the same package as one without native files, named the same way.
        expect(none.system).toBeNull();
        expect(path.basename(none.zipPath)).toBe('spotify-1.0.0-unsigned.zip');
        expect(() => packSource(spotify(), { outRoot: temporary('packs'), system: '../evil', nativeRoot: fakeRoot() })).toThrow(/platform/);
        const off = packSource(spotify(), { outRoot: temporary('packs'), native: false, nativeRoot: fakeRoot() });
        expect(off.system).toBeNull();
        expect(path.basename(off.zipPath)).toBe('spotify-1.0.0-unsigned.zip');
        expect(off.notes.join('\n')).toContain('--no-native');
    });

    it('carries the Windows companion only, and says how to build it when it is not there', () => {
        const root = fakeRoot();
        const mac = packSource(appleMusic(), { outRoot: temporary('packs'), system: 'darwin-arm64', nativeRoot: root });
        expect(mac.notes.join('\n')).toMatch(/不带原生件 apple-music-companion：macOS/);
        expect(() => packSource(appleMusic(), { outRoot: temporary('packs'), system: 'win32-x64', nativeRoot: root })).toThrow(/buildCompanion\.ps1/);
        const companion = path.join(root, 'build', 'apple-music-native', 'windows');
        fs.mkdirSync(companion, { recursive: true });
        for (const file of WINDOWS_COMPANION_FILES) fs.writeFileSync(path.join(companion, file), file);
        fs.writeFileSync(path.join(companion, 'FoliaAppleMusicCompanion.pdb'), 'debug');
        const windows = packSource(appleMusic(), { outRoot: temporary('packs'), system: 'win32-x64', nativeRoot: root });
        expect(windows.files.filter((file: string) => file.startsWith('native/')).sort())
            .toEqual(WINDOWS_COMPANION_FILES.map((file: string) => `native/apple-music-companion/win32-x64/${file}`).sort());
    });

    it('stops at a native file past the install limit', () => {
        expect(() => packSource(spotify(), {
            outRoot: temporary('packs'), system: 'win32-x64', nativeRoot: fakeRoot(), limits: { ...PACK_LIMITS, maxFileBytes: 4096 },
        })).toThrow(/librespot_addon\.node.*单个文件的上限/);
    });
});

describe('what packing refuses', () => {
    it('a directory that does not match its build.json', () => {
        const dist = makeBuilt('qishui', sourceManifest('qishui', 'qishui'));
        fs.writeFileSync(path.join(dist, 'stray.txt'), 'x');
        expect(() => packSource(dist, { outRoot: temporary('packs') })).toThrow(/build\.json.*多出 stray\.txt.*关掉应用/);
    });

    it('leaves room for the signature file under the file limit', () => {
        const dist = makeBuilt('qishui', sourceManifest('qishui', 'qishui'));
        const count = packSource(dist, { outRoot: temporary('packs') }).files.length;
        const limits = { ...PACK_LIMITS, maxFiles: count };
        expect(() => packSource(dist, { outRoot: temporary('packs'), limits })).not.toThrow();
        const signingKey = loadSigningKey(TEST_PEM, TEST_KEY_ID, TEST_KEYS);
        expect(() => packSource(dist, { outRoot: temporary('packs'), limits, signingKey, trustedKeys: TEST_KEYS })).toThrow(/含签名文件/);
    });

    it('a file or a total past the install limits', () => {
        const dist = makeBuilt('qishui', sourceManifest('qishui', 'qishui'));
        expect(() => packSource(dist, { outRoot: temporary('packs'), limits: { ...PACK_LIMITS, maxFileBytes: 1024 } })).toThrow(/单个文件的上限/);
        expect(() => packSource(dist, { outRoot: temporary('packs'), limits: { ...PACK_LIMITS, maxTotalBytes: 2048 } })).toThrow(/合计/);
        expect(() => packSource(dist, { outRoot: temporary('packs'), limits: { ...PACK_LIMITS, maxFiles: 2 } })).toThrow(/个文件/);
    });

    it('a manifest the host would not install', () => {
        const dist = makeBuilt('qishui', sourceManifest('qishui', 'qishui'));
        expect(() => packSource(dist, { outRoot: temporary('packs'), version: 'next' })).toThrow(/mod\.json/);
    });

    it('a key that is not in the trusted list, is not the pair of the listed key, is revoked, or has no key id', () => {
        expect(() => loadSigningKey(TEST_PEM, 'folium-unknown', TEST_KEYS)).toThrow(/没有 folium-unknown/);
        const other = crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
        expect(() => loadSigningKey(other, TEST_KEY_ID, TEST_KEYS)).toThrow(/不是一对/);
        expect(() => loadSigningKey(TEST_PEM, TEST_KEY_ID, [{ ...TEST_KEYS[0], revoked: true }])).toThrow(/吊销/);
        expect(() => loadSigningKey(TEST_PEM, null, TEST_KEYS)).toThrow(/keyId/);
        expect(() => loadSigningKey('not a key', TEST_KEY_ID, TEST_KEYS)).toThrow(/读不了私钥/);
        // A broken JWK reports only that it is broken, not the text around the fault.
        expect(() => loadSigningKey('{"kty":"OKP","d":"secretfragment"', TEST_KEY_ID, TEST_KEYS)).toThrow(/：JWK 不是合法 JSON$/);
    });

    it('reads a JWK private key and its kid', () => {
        const jwk = { ...TEST_PRIVATE.export({ format: 'jwk' }), kid: TEST_KEY_ID };
        expect(loadSigningKey(JSON.stringify(jwk), null, TEST_KEYS)).toMatchObject({ keyId: TEST_KEY_ID, channel: 'release' });
    });
});

describe('the command line', () => {
    it('lists nothing to pack without arguments, and takes ids, --all and the options', () => {
        expect(parseArgs([])).toMatchObject({ ids: [], all: false, version: null, folia: undefined });
        expect(parseArgs(['--all'])).toMatchObject({ all: true });
        expect(parseArgs(['qishui', '--version', '1.0.1', '--folia', 'none', '--key', 'k.pem', '--key-id', 'x']))
            .toMatchObject({ ids: ['qishui'], version: '1.0.1', folia: null, keyFile: 'k.pem', keyId: 'x' });
        expect(() => parseArgs(['--all', 'qishui'])).toThrow();
        expect(() => parseArgs(['--nope'])).toThrow(/不认识/);
        expect(parseArgs(['spotify', '--system', 'linux-arm64', '--no-native'])).toMatchObject({ system: 'linux-arm64', native: false });
        expect(parseArgs(['spotify'])).toMatchObject({ system: `${process.platform}-${process.arch}`, native: true });
        expect(() => parseArgs(['--system', '../x'])).toThrow(/platform/);
    });

    it('finds a built source by its folder name or its mod id, and lists only built folders', () => {
        const distRoot = temporary('dist-root');
        const built = makeBuilt('appleMusic', sourceManifest('apple-music', 'appleMusic'));
        fs.cpSync(built, path.join(distRoot, 'appleMusic'), { recursive: true });
        fs.mkdirSync(path.join(distRoot, 'half'));
        fs.writeFileSync(path.join(distRoot, 'half', 'mod.json'), '{}');
        const packable = listPackable(distRoot);
        expect(packable.map((item: { name: string }) => item.name)).toEqual(['appleMusic']);
        expect(findPackable(packable, 'apple-music').name).toBe('appleMusic');
        expect(findPackable(packable, 'appleMusic').name).toBe('appleMusic');
        expect(() => findPackable(packable, 'nothing')).toThrow(/没有构建好的 nothing/);
    });

    it('reads the private key from the option first, then the environment', () => {
        const keyFile = path.join(temporary('key'), 'key.pem');
        fs.writeFileSync(keyFile, TEST_PEM);
        expect(signingKeyText({ keyFile, env: { FOLIUM_SIGNING_KEY: 'env' } })).toBe(TEST_PEM);
        expect(signingKeyText({ env: { FOLIUM_SIGNING_KEY: 'env' } })).toBe('env');
        expect(signingKeyText({ env: { FOLIUM_SIGNING_KEY_FILE: keyFile } })).toBe(TEST_PEM);
        expect(signingKeyText({ env: {} })).toBeNull();
    });
});
