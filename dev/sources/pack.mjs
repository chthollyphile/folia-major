#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
// dev/sources/pack.mjs
// 把构建好的内置音源模组（dist-mods/<id>/）打成能用「从 zip 安装」装上的包（Folium 2.0 方案 §5.1、§6.2、§11 的合规预案）。
// 用法见 dev/sources/README.md：
//
//   npm run sources:pack                      列出能打的音源
//   npm run sources:pack -- <id> [<id> …]     打这几个（目录名或模组 id）
//   npm run sources:pack -- --all             全部打
//
// 包里是 <模组 id>/ 一个目录：构建产物原样（不带 build.json），mod.json 补上接管要的 sources[].claims（受信表那一行，
// electron/modSystem/builtinSources.cjs）和 folia 范围。给了私钥就照宿主的签名格式（electron/modSystem/modSignature.cjs）
// 在目录里写 folium.sig.json；没给就是未签名的包。产物在 dist-mod-packs/（git 忽略）。
// 清单要原生件的（librespot、Apple Music 伴侣程序）按系统出包：带上那个系统的一份，放在 native/<名字>/<系统>/，
// 接管副本经 api.native 用它（electron/modSystem/nativeFiles.cjs 的 MOD_NATIVE_ENTRIES）。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requireHere = createRequire(import.meta.url);
const { zipSync } = requireHere('fflate');
const { validateManifest, compareVersionStrings } = requireHere('../../electron/modSystem/manifest.cjs');
const { BUILTIN_SOURCE_TABLE } = requireHere('../../electron/modSystem/builtinSources.cjs');
const {
    SIGNATURE_FILE, SIGNATURE_FORMAT, SIGNATURE_VERSION, buildSignedMessage, computeSignedDigestDetailed, verifyModSignature,
} = requireHere('../../electron/modSystem/modSignature.cjs');
const { TRUSTED_SIGNING_KEYS } = requireHere('../../electron/modSystem/trustedKeys.cjs');
const { INSTALL_LIMITS } = requireHere('../../electron/modSystem/zipInstall.cjs');
const { DIGEST_LIMITS } = requireHere('../../electron/modSystem/modDigest.cjs');
const { modNativeRelativePath } = requireHere('../../electron/modSystem/nativeFiles.cjs');
const { WINDOWS_COMPANION_FILES } = requireHere('../../sources/appleMusic/native/windows/prepareBundle.cjs');

/** 这台机器的 `<platform>-<arch>`：不给 --system 时出这个系统的包。 */
export const DEFAULT_SYSTEM = `${process.platform}-${process.arch}`;
const SYSTEM_PATTERN = /^[a-z0-9]+-[a-z0-9]+$/;

export const DEFAULT_DIST_ROOT = path.join(ROOT, 'dist-mods');
export const DEFAULT_PACK_ROOT = path.join(ROOT, 'dist-mod-packs');
// build.mjs 的 BUILD_STAMP：只给开发版的主进程盯着重载用，不进包（不从 build.mjs 取，免得为打包加载打包器）。
const BUILD_STAMP = 'build.json';
// 包里每个文件的修改时间：固定，未签名的包同一份产物打出来字节相同。
const ZIP_MTIME = new Date(2000, 0, 1);

/*
 * 「从 zip 安装」（zipInstall.cjs）和内容摘要、签名摘要（modDigest.cjs）的上限里最紧的那份：装得上的包也要验得了。
 * 归档本身的上限是安装时读文件前查的那一项。
 */
export const PACK_LIMITS = Object.freeze({
    maxArchiveBytes: INSTALL_LIMITS.maxArchiveBytes,
    maxFiles: Math.min(INSTALL_LIMITS.maxEntries, DIGEST_LIMITS.maxFiles),
    maxFileBytes: INSTALL_LIMITS.maxFileBytes,
    maxTotalBytes: Math.min(INSTALL_LIMITS.maxTotalBytes, DIGEST_LIMITS.maxTotalBytes),
});

const log = (message) => console.log(`[sources:pack] ${message}`);
const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** `dir` 下的文件（相对路径，`/` 分隔，排好序）；有符号链接或特殊文件时报错（签名摘要不收它们）。 */
const listFiles = (dir) => {
    const found = [];
    const walk = (relative) => {
        for (const entry of fs.readdirSync(path.join(dir, relative), { withFileTypes: true })) {
            const child = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.isSymbolicLink()) throw new Error(`${child} 是符号链接，打不进包`);
            if (entry.isDirectory()) walk(child);
            else if (entry.isFile()) found.push(child);
            else throw new Error(`${child} 不是普通文件，打不进包`);
        }
    };
    walk('');
    return found.sort();
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** `distRoot` 下能打的模组目录：有 mod.json 和 build.json（sources:build 写的）。交回目录名与它的 mod.json。 */
export const listPackable = (distRoot = DEFAULT_DIST_ROOT) => {
    if (!fs.existsSync(distRoot)) return [];
    return fs.readdirSync(distRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => path.join(distRoot, entry.name))
        .filter((dir) => fs.existsSync(path.join(dir, 'mod.json')) && fs.existsSync(path.join(dir, BUILD_STAMP)))
        .map((dir) => ({ name: path.basename(dir), dir, manifest: readJson(path.join(dir, 'mod.json')) }))
        .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
};

/** 按目录名（就是短音源 id）或模组 id 找 `listPackable` 里的那一项；找不到报错并列出有的。 */
export const findPackable = (packable, wanted) => {
    const hit = packable.find((item) => item.name === wanted || item.manifest.id === wanted);
    if (!hit) {
        throw new Error(`没有构建好的 ${wanted}（先 npm run sources:build；能打的有：${packable.map((item) => item.name).join('、') || '无'}）`);
    }
    return hit;
};

/*
 * 接管（方案 §5.1）要的 `sources[].claims`：这个模组在受信表里那一行认领的短 id，连同那一行的旧 electron-store 键、
 * 会话分区、userData 目录、媒体缓存目录下的旧缓存目录（legacyCacheDirs）。宿主核对 claims 不超出那一行（sourceOwnership.cjs 的 claimRefusal），所以照抄整行。
 * 不在受信表里的模组没有 claims：装上后是第三方音源 folium.<模组 id>.<名字>。
 */
/**
 * @param {string} modId
 * @param {string} sourceId
 * @returns {{ id: string, storeKeys?: string[], partitions?: string[], userDataDirs?: string[], legacyCacheDirs?: string[] } | null}
 */
export const claimsFor = (modId, sourceId) => {
    const row = Object.hasOwn(BUILTIN_SOURCE_TABLE, modId) ? BUILTIN_SOURCE_TABLE[modId] : null;
    if (!row || !row.sources.includes(sourceId)) return null;
    /** @type {{ id: string, storeKeys?: string[], partitions?: string[], userDataDirs?: string[], legacyCacheDirs?: string[] }} */
    const claims = { id: sourceId };
    for (const field of ['storeKeys', 'partitions', 'userDataDirs', 'legacyCacheDirs']) {
        if ((row[field] ?? []).length > 0) claims[field] = [...row[field]];
    }
    return claims;
};

/*
 * 包里的 mod.json：构建出的那份，补上 claims（已经写了的不动）、换掉版本号（`version`，给覆盖用：要比安装包里那份高）、
 * 写上宿主范围（`folia`，null 是不写）。
 */
/**
 * @param {Record<string, any>} manifest
 * @param {{ version?: string | null, folia?: string | null }} [options]
 * @returns {Record<string, any>}
 */
export const packedManifest = (manifest, { version = null, folia = null } = {}) => {
    const next = { ...manifest };
    if (version !== null) next.version = version;
    if (folia !== null) next.folia = folia;
    if (Array.isArray(manifest.sources)) {
        next.sources = manifest.sources.map((entry) => {
            if (entry.claims) return entry;
            const claims = claimsFor(manifest.id, entry.id);
            return claims ? { ...entry, claims } : entry;
        });
    }
    return next;
};

/*
 * 签名用的私钥：PEM（PKCS#8）或 JWK 的文字。按 keyId 在受信公钥表（trustedKeys.cjs，测试可换）里找到那把公钥，
 * 私钥要和它是一对；表里没有、已吊销、对不上都报错（签出来宿主也只会标「签名不匹配」）。
 */
/**
 * @param {string} keyText
 * @param {string | null} keyId
 * @param {readonly { keyId: string, publicKey: { x?: string }, revoked?: boolean, channel?: string }[]} [trustedKeys]
 */
export const loadSigningKey = (keyText, keyId, trustedKeys = TRUSTED_SIGNING_KEYS) => {
    let privateKey;
    let jwkKeyId = null;
    const trimmed = String(keyText ?? '').trim();
    try {
        if (trimmed.startsWith('{')) {
            let jwk;
            // JSON.parse 的报错会引出错处附近的原文，那是私钥的一段：不往外带。
            try { jwk = JSON.parse(trimmed); } catch { throw new Error('JWK 不是合法 JSON'); }
            jwkKeyId = typeof jwk.kid === 'string' ? jwk.kid : null;
            privateKey = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
        } else {
            privateKey = crypto.createPrivateKey(trimmed);
        }
    } catch (error) {
        throw new Error(`读不了私钥（要 PEM 或 JWK 的 Ed25519 私钥）：${error.message}`, { cause: error });
    }
    if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error(`私钥要是 Ed25519 的，这把是 ${privateKey.asymmetricKeyType}`);
    const id = keyId || jwkKeyId;
    if (!id) throw new Error('给了私钥就要给它的 keyId（--key-id 或 FOLIUM_SIGNING_KEY_ID）');
    const trusted = trustedKeys.find((key) => key.keyId === id);
    if (!trusted) throw new Error(`受信公钥表里没有 ${id}：用它签的包装上会标「签名不匹配」（unknown-key）`);
    if (trusted.revoked) throw new Error(`${id} 已吊销`);
    const publicX = crypto.createPublicKey(privateKey).export({ format: 'jwk' }).x;
    if (publicX !== trusted.publicKey.x) throw new Error(`这把私钥和受信公钥表里的 ${id} 不是一对`);
    return { privateKey, keyId: id, channel: trusted.channel === undefined ? 'release' : trusted.channel };
};

/** 私钥从哪来：参数 `--key <文件>`，或环境变量 FOLIUM_SIGNING_KEY（文字）、FOLIUM_SIGNING_KEY_FILE（文件）。没有是 null。 */
/**
 * @param {{ keyFile?: string | null, env?: Record<string, string | undefined> }} [options]
 * @returns {string | null}
 */
export const signingKeyText = ({ keyFile = null, env = process.env } = {}) => {
    if (keyFile) return fs.readFileSync(keyFile, 'utf8');
    if (env.FOLIUM_SIGNING_KEY) return env.FOLIUM_SIGNING_KEY;
    if (env.FOLIUM_SIGNING_KEY_FILE) return fs.readFileSync(env.FOLIUM_SIGNING_KEY_FILE, 'utf8');
    return null;
};

/*
 * 原生件从哪来。名字 → (system, root) 交回 { files: [{ from, to }] }（to 是 native/<名字>/<系统>/ 下的相对路径），
 * 或 { none: 为什么这个系统不带 }。本机缺构建产物时报错并说怎么补（不悄悄出一个缺原生件的包；不要原生件用 --no-native）。
 */
// librespot 的现成构建目录（包里 prebuilds/ 下的名字）：只有这四个系统有；Linux 只带 glibc 的。
const LIBRESPOT_PREBUILDS = Object.freeze({
    'win32-x64': 'win32-x64-msvc',
    'darwin-arm64': 'darwin-arm64',
    'linux-x64': 'linux-x64-gnu',
    'linux-arm64': 'linux-arm64-gnu',
});
const LIBRESPOT_PACKAGE = '@lox-audioserver/node-librespot';
const NATIVE_SOURCES = Object.freeze({
    librespot: (system, root) => {
        const prebuild = Object.hasOwn(LIBRESPOT_PREBUILDS, system) ? LIBRESPOT_PREBUILDS[system] : null;
        if (!prebuild) return { none: `${LIBRESPOT_PACKAGE} 没有 ${system} 的现成构建` };
        let packageDir;
        try {
            packageDir = path.dirname(path.dirname(createRequire(path.join(root, 'package.json')).resolve(LIBRESPOT_PACKAGE)));
        } catch {
            throw new Error(`没装 ${LIBRESPOT_PACKAGE}（根目录 package.json 的 optionalDependencies）：npm ci 装上再打，或 --no-native`);
        }
        // 包自己的加载器（dist/index.js 再 require ./types）、package.json（版本与许可）、这个系统的 .node。
        const wanted = ['package.json', 'dist/index.js', 'dist/types.js', `prebuilds/${prebuild}/librespot_addon.node`];
        const absent = wanted.filter((file) => !fs.existsSync(path.join(packageDir, ...file.split('/'))));
        if (absent.length > 0) throw new Error(`${packageDir} 里没有 ${absent.join('、')}：重新 npm ci，或 --no-native`);
        return { files: wanted.map((file) => ({ from: path.join(packageDir, ...file.split('/')), to: file })) };
    },
    'apple-music-companion': (system, root) => {
        if (system.startsWith('darwin-')) {
            return { none: 'macOS 的伴侣程序是签名的 .app，经 zip 解到用户目录后签名与可执行位保不保得住没验证，不带' };
        }
        if (system !== 'win32-x64') return { none: `${system} 没有伴侣程序` };
        const folder = path.join(root, 'build', 'apple-music-native', 'windows');
        const absent = WINDOWS_COMPANION_FILES.filter((file) => !fs.existsSync(path.join(folder, file)));
        if (absent.length > 0) {
            throw new Error(`build/apple-music-native/windows 里没有 ${absent.join('、')}：在 Windows 上先构建伴侣程序`
                + '（powershell -NoProfile -ExecutionPolicy Bypass -File sources/appleMusic/native/windows/buildCompanion.ps1，要 .NET SDK），或 --no-native');
        }
        return { files: WINDOWS_COMPANION_FILES.map((file) => ({ from: path.join(folder, file), to: file })) };
    },
});

/**
 * 一个模组在 `system` 上要带的原生件：清单 native 与受信表那一行 native 都写了的名字（接管副本只能用这些，
 * sourceOwnership.cjs ownNative）。交回 { files: Map<包里路径, 来源>, carried: [名字], skipped: [{ name, reason }] }。
 * @param {Record<string, any>} manifest
 * @param {string} system
 * @param {string} [root]
 */
export const nativeFilesFor = (manifest, system, root = ROOT) => {
    const row = Object.hasOwn(BUILTIN_SOURCE_TABLE, manifest.id) ? BUILTIN_SOURCE_TABLE[manifest.id] : null;
    const names = (manifest.native ?? []).filter((name) => row?.native.includes(name));
    const files = new Map();
    const carried = [];
    const skipped = [];
    for (const name of names) {
        const source = Object.hasOwn(NATIVE_SOURCES, name) ? NATIVE_SOURCES[name](system, root) : { none: '打包脚本不认识这个原生件' };
        if (source.none) {
            skipped.push({ name, reason: source.none });
            continue;
        }
        // 入口要和宿主找的那个对上（nativeFiles.cjs MOD_NATIVE_ENTRIES），不然装上也找不到。
        const entry = modNativeRelativePath(name, system);
        const prefix = `native/${name}/${system}/`;
        if (!entry || !source.files.some((file) => `${prefix}${file.to}` === entry)) {
            throw new Error(`${name} 在 ${system} 上的入口和宿主的 MOD_NATIVE_ENTRIES 对不上`);
        }
        source.files.forEach((file) => files.set(`${prefix}${file.to}`, file.from));
        carried.push(name);
    }
    return { files, carried, skipped };
};

/*
 * 装上之后要知道的事，只按产物和受信表那一行判断（这里不写平台名）：带着的 deps 归档、清单要的原生件、claims 写不进的
 * 旧数据、旧媒体协议、签名与版本对覆盖的影响。
 */
const runtimeNotes = ({ manifest, files, sizes, signature, sourceVersion, native, system }) => {
    const notes = [];
    const row = Object.hasOwn(BUILTIN_SOURCE_TABLE, manifest.id) ? BUILTIN_SOURCE_TABLE[manifest.id] : null;
    files.filter((file) => /^deps\.[0-9a-f]+\.asar$/.test(file)).forEach((file) => {
        notes.push(`带 deps 归档 ${file}（${megabytes(sizes.get(file))}）：装上后入口从 userData/mods/${manifest.id}/ 里的这份读上游库，和内置副本一样`);
    });
    (native?.carried ?? []).forEach((name) => {
        const bytes = [...native.files.keys()].filter((file) => file.startsWith(`native/${name}/`)).reduce((sum, file) => sum + sizes.get(file), 0);
        notes.push(`带原生件 ${name}（${system}，${megabytes(bytes)}，在 native/${name}/${system}/）：接管时 api.native 用包里这份；`
            + '安装包带着这个音源时，覆盖副本仍用应用带的那份；只能装在这个系统上用');
    });
    (native?.skipped ?? []).forEach(({ name, reason }) => {
        notes.push(`不带原生件 ${name}：${reason}；接管时 api.native 报 native-not-in-mod，靠它的功能用不了`);
    });
    if (!native && (manifest.native ?? []).length > 0) {
        notes.push(`没带原生件（--no-native）：接管时 ${manifest.native.join('、')} 报 native-not-in-mod，靠它的功能用不了`);
    }
    if (!row) {
        notes.push('不在受信表里：没有 claims，装上后是第三方音源 folium.<模组 id>.<名字>');
        return notes;
    }
    (row.legacyMediaSchemes ?? []).forEach((scheme) => {
        notes.push(`旧媒体协议 ${scheme}:// 只交给内置副本：接管时存下的这类地址回 404`);
    });
    if (!signature) {
        notes.push('未签名：只能在安装包不带它时经确认接管；安装包带着它时不会覆盖内置副本（要官方签名）');
    } else if (signature.status !== 'verified') {
        notes.push(`签名状态是 ${signature.status}：覆盖内置副本只认 verified，这个包只能用来接管`);
    } else if (compareVersionStrings(manifest.version, sourceVersion) <= 0) {
        notes.push(`版本 ${manifest.version} 不高于构建出的 ${sourceVersion}：覆盖内置副本要版本更高（--version）`);
    }
    return notes;
};

/** 写包之前查上限：每个文件、文件数、合计，和安装、验签时一样。 */
const checkLimits = (files, sizes, limits, { reserveFiles = 0 } = {}) => {
    // reserveFiles：之后还要加进包的文件（签名文件），先给它留出位置。
    if (files.length + reserveFiles > limits.maxFiles) {
        throw new Error(`${files.length + reserveFiles} 个文件${reserveFiles ? `（含签名文件）` : ''}，超过「从 zip 安装」的上限 ${limits.maxFiles}`);
    }
    let total = 0;
    for (const file of files) {
        const size = sizes.get(file);
        if (size > limits.maxFileBytes) throw new Error(`${file} 有 ${megabytes(size)}，超过单个文件的上限 ${megabytes(limits.maxFileBytes)}`);
        total += size;
    }
    if (total > limits.maxTotalBytes) throw new Error(`合计 ${megabytes(total)}，超过上限 ${megabytes(limits.maxTotalBytes)}`);
    return total;
};

/*
 * 打一个包。`distDir` 是 sources:build 产出的模组目录。options：
 *   outRoot    产物目录（默认 dist-mod-packs/）
 *   version    换掉的版本号（null 是用构建出的）
 *   folia      宿主范围（undefined 是 >=<仓库 package.json 的版本>，null 是不写）
 *   signingKey loadSigningKey 交回的私钥（null 是不签）
 *   trustedKeys 验签用的公钥表（测试用）
 *   limits     上限（测试用）
 *   now        签名时间（测试用）
 *   system     原生件的系统 <platform>-<arch>（默认本机）
 *   native     带不带原生件（默认带；false 是 --no-native）
 *   nativeRoot 找原生件的仓库根（测试用）
 * 交回 { modId, version, zipPath, archiveBytes, files, totalBytes, digest, signature, notes, manifest, system }（system：带了原生件时是那个系统，否则 null）。
 *
 * @param {string} distDir
 * @param {{
 *   outRoot?: string, version?: string | null, folia?: string | null, signingKey?: ReturnType<typeof loadSigningKey> | null,
 *   trustedKeys?: Parameters<typeof loadSigningKey>[2], limits?: typeof PACK_LIMITS, now?: () => Date,
 *   system?: string, native?: boolean, nativeRoot?: string,
 * }} [options]
 */
export const packSource = (distDir, options = {}) => {
    const {
        outRoot = DEFAULT_PACK_ROOT, version = null, signingKey = null, trustedKeys = TRUSTED_SIGNING_KEYS,
        limits = PACK_LIMITS, now = () => new Date(), system = DEFAULT_SYSTEM, nativeRoot = ROOT,
    } = options;
    // 默认下限只是占位：仓库版本号以下的宿主本来就不收 Folium 2 的模组，这一条不额外挡什么。预发布号（-alpha.x）去掉，
    // 宿主的范围写法只认 x.y.z。
    const folia = options.folia === undefined
        ? `>=${String(readJson(path.join(ROOT, 'package.json')).version).split(/[-+]/)[0]}`
        : options.folia;
    if (!SYSTEM_PATTERN.test(system)) throw new Error(`system 要写成 <platform>-<arch>，如 win32-x64，不是 ${system}`);
    const built = readJson(path.join(distDir, 'mod.json'));
    const stamp = readJson(path.join(distDir, BUILD_STAMP));
    const files = listFiles(distDir).filter((file) => file !== BUILD_STAMP);
    if (files.includes(SIGNATURE_FILE)) throw new Error(`${distDir} 里已经有 ${SIGNATURE_FILE}：构建产物不该带签名`);
    // build.json 的文件表是这次构建写下的全部：对不上说明目录被手动改过或构建没写完，重新构建再打。
    const expected = [...(stamp.files ?? [])].sort();
    const extra = files.filter((file) => !expected.includes(file));
    const missing = expected.filter((file) => !files.includes(file));
    if (extra.length > 0 || missing.length > 0) {
        const sample = (list) => list.slice(0, 5).join('、') + (list.length > 5 ? ` 等 ${list.length} 个` : '');
        throw new Error([
            `${distDir} 的文件和 ${BUILD_STAMP} 里记的对不上`,
            extra.length > 0 ? `多出 ${sample(extra)}` : null,
            missing.length > 0 ? `缺 ${sample(missing)}` : null,
            '先重新 npm run sources:build；重新构建删不掉多出的旧文件时，多半是开着的应用占着它们，关掉应用再构建',
        ].filter(Boolean).join('；'));
    }

    const manifest = packedManifest(built, { version, folia });
    const validation = validateManifest(manifest);
    if (!validation.ok) throw new Error(`包里的 mod.json 不合格：${validation.errors.join('; ')}`);
    if (manifest.folium !== 2 || !Array.isArray(manifest.sources)) throw new Error(`${built.id} 不是音源模组（Folium 2 且声明了 sources）`);

    // 包里每个文件从哪拷：构建产物，加上这个系统的原生件（native/<名字>/<系统>/，构建产物里没有 native/）。
    const from = new Map(files.map((file) => [file, path.join(distDir, ...file.split('/'))]));
    const native = options.native === false ? null : nativeFilesFor(manifest, system, nativeRoot);
    if (native) {
        for (const [file, source] of native.files) {
            if (from.has(file)) throw new Error(`构建产物里已经有 ${file}`);
            from.set(file, source);
        }
    }
    const contentFiles = [...from.keys()].sort();
    const sizes = new Map(contentFiles.map((file) => [file, fs.statSync(from.get(file)).size]));
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    sizes.set('mod.json', Buffer.byteLength(manifestText));
    checkLimits(contentFiles, sizes, limits, { reserveFiles: signingKey ? 1 : 0 });
    // 声明了原生件的包按系统出（内容随系统变）；没声明的、--no-native 的和以前一样。
    const systemTag = native && native.carried.length > 0 ? system : null;

    // 在临时目录里摆出装上后的样子：签名摘要就按这个目录算，和装上后宿主验的是同一份字节。
    const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-sources-pack-'));
    try {
        const stageDir = path.join(stageRoot, manifest.id);
        for (const file of contentFiles) {
            const destination = path.join(stageDir, ...file.split('/'));
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.copyFileSync(from.get(file), destination);
        }
        fs.writeFileSync(path.join(stageDir, 'mod.json'), manifestText);

        const { digest } = computeSignedDigestDetailed(stageDir);
        let signature = null;
        const packedFiles = [...contentFiles];
        if (signingKey) {
            const record = {
                format: SIGNATURE_FORMAT,
                version: SIGNATURE_VERSION,
                modId: manifest.id,
                modVersion: manifest.version,
                digest,
                keyId: signingKey.keyId,
                signedAt: now().toISOString(),
            };
            record.signature = crypto.sign(null, buildSignedMessage(record), signingKey.privateKey).toString('base64');
            fs.writeFileSync(path.join(stageDir, SIGNATURE_FILE), `${JSON.stringify(record, null, 2)}\n`);
            packedFiles.push(SIGNATURE_FILE);
            // 用宿主自己的验签走一遍：签坏了在这里就知道，不等装上。
            signature = verifyModSignature(stageDir, manifest, { keys: trustedKeys, revokedDigests: [] });
            if (signature.status !== 'verified' && signature.status !== 'beta') {
                throw new Error(`签完自己验不过：${signature.reason ?? signature.status}`);
            }
        }

        const entries = {};
        for (const file of packedFiles.sort()) {
            const bytes = fs.readFileSync(path.join(stageDir, ...file.split('/')));
            entries[`${manifest.id}/${file}`] = [new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), { mtime: ZIP_MTIME }];
        }
        const archive = zipSync(entries, { level: 6 });
        if (archive.byteLength > limits.maxArchiveBytes) {
            throw new Error(`包有 ${megabytes(archive.byteLength)}，超过「从 zip 安装」的上限 ${megabytes(limits.maxArchiveBytes)}`);
        }
        fs.mkdirSync(outRoot, { recursive: true });
        const zipPath = path.join(outRoot, `${manifest.id}-${manifest.version}${systemTag ? `-${systemTag}` : ''}${signingKey ? '' : '-unsigned'}.zip`);
        fs.writeFileSync(zipPath, archive);
        const totalBytes = [...sizes.values()].reduce((sum, size) => sum + size, 0);
        return {
            modId: manifest.id,
            version: manifest.version,
            zipPath,
            archiveBytes: archive.byteLength,
            files: packedFiles,
            totalBytes,
            digest,
            signature,
            manifest,
            system: systemTag,
            notes: runtimeNotes({ manifest, files: contentFiles, sizes, signature, sourceVersion: built.version, native, system }),
        };
    } finally {
        // 只删自己在系统临时目录里建的这一个目录。
        fs.rmSync(stageRoot, { recursive: true, force: true });
    }
};

/** 命令行参数。没给 id 也没给 --all 是列出能打的。 */
export const parseArgs = (argv) => {
    const options = {
        ids: [], all: false, distRoot: DEFAULT_DIST_ROOT, outRoot: DEFAULT_PACK_ROOT, version: null, folia: undefined, keyFile: null, keyId: null,
        system: DEFAULT_SYSTEM, native: true,
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const value = () => {
            const next = argv[index + 1];
            if (next === undefined) throw new Error(`${arg} 后面要跟一个值`);
            index += 1;
            return next;
        };
        if (arg === '--all') options.all = true;
        else if (arg === '--dist') options.distRoot = path.resolve(value());
        else if (arg === '--out') options.outRoot = path.resolve(value());
        else if (arg === '--version') options.version = value();
        else if (arg === '--folia') {
            const range = value();
            options.folia = range === 'none' ? null : range;
        } else if (arg === '--key') options.keyFile = value();
        else if (arg === '--key-id') options.keyId = value();
        else if (arg === '--system') {
            options.system = value();
            if (!SYSTEM_PATTERN.test(options.system)) throw new Error('--system 要写成 <platform>-<arch>，如 win32-x64、darwin-arm64、linux-x64');
        } else if (arg === '--no-native') options.native = false;
        else if (arg.startsWith('--')) throw new Error(`不认识的参数 ${arg}`);
        else options.ids.push(arg);
    }
    if (options.all && options.ids.length > 0) throw new Error('--all 和具体的 id 只给一种');
    return options;
};

const printList = (packable) => {
    if (packable.length === 0) {
        log('dist-mods/ 里没有构建好的音源，先 npm run sources:build');
        return;
    }
    log('能打的音源（npm run sources:pack -- <id> 或 --all）：');
    for (const item of packable) {
        const files = listFiles(item.dir).filter((file) => file !== BUILD_STAMP);
        const bytes = files.reduce((sum, file) => sum + fs.statSync(path.join(item.dir, file)).size, 0);
        const extras = [
            files.some((file) => /^deps\.[0-9a-f]+\.asar$/.test(file)) ? 'deps 归档' : '',
            (item.manifest.native ?? []).length > 0 ? `原生件 ${item.manifest.native.join('、')}（按系统带，--system）` : '',
        ].filter(Boolean);
        log(`  ${item.name.padEnd(12)} 模组 ${item.manifest.id} ${item.manifest.version}  ${megabytes(bytes)}${extras.length > 0 ? `  ${extras.join('，')}` : ''}`);
    }
};

const main = () => {
    const options = parseArgs(process.argv.slice(2));
    const packable = listPackable(options.distRoot);
    if (!options.all && options.ids.length === 0) {
        printList(packable);
        return;
    }
    const targets = options.all ? packable : options.ids.map((id) => findPackable(packable, id));
    if (targets.length === 0) throw new Error('dist-mods/ 里没有构建好的音源，先 npm run sources:build');
    const keyText = signingKeyText({ keyFile: options.keyFile });
    const signingKey = keyText ? loadSigningKey(keyText, options.keyId ?? process.env.FOLIUM_SIGNING_KEY_ID ?? null) : null;
    if (!signingKey) {
        log('没有给私钥（--key <文件>、FOLIUM_SIGNING_KEY 或 FOLIUM_SIGNING_KEY_FILE）：打的是未签名的包，只能用来接管安装包不带的音源');
    }
    for (const target of targets) {
        const result = packSource(target.dir, {
            outRoot: options.outRoot, version: options.version, folia: options.folia, signingKey, system: options.system, native: options.native,
        });
        const signed = result.signature ? `已签名（${result.signature.status}，${signingKey.keyId}）` : '未签名';
        log(`${target.name}: ${path.relative(ROOT, result.zipPath)}  ${megabytes(result.archiveBytes)}（解开 ${megabytes(result.totalBytes)}，${result.files.length} 个文件），${signed}`);
        log(`  签名摘要 ${result.digest}`);
        result.notes.forEach((note) => log(`  - ${note}`));
    }
};

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    try {
        main();
    } catch (error) {
        console.error(`[sources:pack] ${error.message}`);
        process.exitCode = 1;
    }
}
