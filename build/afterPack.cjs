const fs = require('node:fs/promises');
const path = require('node:path');

// build/afterPack.cjs

// electron-builder 的 Arch 枚举，按序号展开。刻意不 require('builder-util')：那只是
// electron-builder 的传递依赖，能解析到纯属 npm 扁平提升的副作用，依赖树一变就会在打包
// 末期才炸。这五个值是 electron-builder 的公开契约，比提升可靠。
const ARCH_NAMES = ['ia32', 'x64', 'armv7l', 'arm64', 'universal'];

const MNN_LIBRARY_FILES = { darwin: 'libfolia_mnn.dylib', linux: 'libfolia_mnn.so', win32: 'folia_mnn.dll' };

/**
 * 包里必须有分析模型的运行库（resources/mnn，build/buildMnnRuntime.mjs 在 beforePack 里编出来）。
 * 缺了它 worker.cjs 每个请求都只会回 null、渲染层退回估算器——功能整块失效却没有任何报错，
 * 所以在打包时就失败，而不是发出去再靠人发现。
 */
async function verifyBundledMnn(context) {
  const library = MNN_LIBRARY_FILES[context.electronPlatformName];
  if (!library) return;
  const file = path.join(context.packager.getResourcesDir(context.appOutDir), 'mnn', library);
  try {
    await fs.access(file);
  } catch {
    throw new Error(`[afterPack] ${file} is missing - the analysis models would not run in this package`);
  }
}

async function pathExists(candidate) {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

/*
 * electron-builder 拿 electronLanguages 里的字符串去比对盘上的文件名，不在连字符和下划线之间换算。
 * Windows/Linux 的 Chromium 语言包叫 locales/zh-CN.pak，所以 build.electronLanguages 写连字符；
 * macOS 的是 zh_CN.lproj，所以 build.mac.electronLanguages 单独写一份下划线的。写错了对应目录会被
 * 当成没人要的语言删掉，Chromium 的 app.getLocale() 落回英文，「跟随系统」也就成了英文，而应用里
 * 没有任何报错。macOS 上应用包里的 .lproj 告诉系统支持哪些语言，Electron 框架里的 locale.pak 才是
 * 真正的翻译，两边都要在。
 */
const BUNDLED_LOCALES = {
  darwin: ['en', 'zh_CN', 'zh_TW', 'id', 'vi'],
  win32: ['en-US', 'zh-CN', 'zh-TW', 'id', 'vi'],
  linux: ['en-US', 'zh-CN', 'zh-TW', 'id', 'vi'],
};

async function verifyBundledLocales(context) {
  const locales = BUNDLED_LOCALES[context.electronPlatformName];
  if (!locales) return;
  const files = context.electronPlatformName === 'darwin'
    ? locales.flatMap(locale => [
      path.join(context.packager.getResourcesDir(context.appOutDir), `${locale}.lproj`),
      path.join(context.packager.getMacOsElectronFrameworkResourcesDir(context.appOutDir), `${locale}.lproj`, 'locale.pak'),
    ])
    : locales.map(locale => path.join(context.appOutDir, 'locales', `${locale}.pak`));
  const missing = [];
  for (const file of files) {
    if (!(await pathExists(file))) missing.push(file);
  }
  if (missing.length > 0) {
    throw new Error(`[afterPack] locales were pruned: ${missing.join(', ')} - "follow system" would fall back to English; check electronLanguages`);
  }
}

exports.verifyBundledLocales = verifyBundledLocales;

const LIBRESPOT_PREBUILDS_RELATIVE_PATH = path.join(
  'app.asar.unpacked',
  'node_modules',
  '@lox-audioserver',
  'node-librespot',
  'prebuilds',
);

// The Spotify playback component ships one native build per system, each in a folder named
// `<platform>-<arch>` with an optional suffix (`win32-x64-msvc`). Only the target's is kept.
// It has none for some targets (darwin-x64 in 0.5.1): Spotify cannot be played in that package,
// and the app says so when a track is asked for.
async function pruneLibrespotBinaries(context) {
  const prebuildsDir = path.join(context.packager.getResourcesDir(context.appOutDir), LIBRESPOT_PREBUILDS_RELATIVE_PATH);
  if (!(await pathExists(prebuildsDir))) return;
  const targetArch = ARCH_NAMES[context.arch];
  if (!targetArch) {
    console.warn(`[afterPack] unknown Arch ordinal ${context.arch}, keeping every node-librespot build`);
    return;
  }
  const kept = (targetArch === 'universal' ? ['x64', 'arm64'] : [targetArch]).map(arch => `${context.electronPlatformName}-${arch}`);
  let left = 0;
  for (const entry of await fs.readdir(prebuildsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (kept.some(name => entry.name === name || entry.name.startsWith(`${name}-`))) left += 1;
    else await fs.rm(path.join(prebuildsDir, entry.name), { recursive: true, force: true });
  }
  if (left < kept.length) {
    console.warn(`[afterPack] node-librespot ships no build for ${kept.join(', ')} - Spotify cannot be played in this package`);
  }
}

exports.default = async (context) => {
  await verifyBundledLocales(context);
  await verifyBundledMnn(context);
  await pruneLibrespotBinaries(context);
  if (context.electronPlatformName === 'darwin') {
    const { verifyBundledKoffi } = await import('../packaging/macos/prepare-koffi.mjs');
    await verifyBundledKoffi({
      resourcesDir: context.packager.getResourcesDir(context.appOutDir),
      arch: ARCH_NAMES[context.arch],
      version: JSON.parse(await fs.readFile(
        path.join(path.dirname(require.resolve('koffi')), 'package.json'), 'utf8',
      )).version,
    });
  }
};
