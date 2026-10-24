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

// macOS 上的本地化目录用下划线命名（zh_CN.lproj、zh_TW.lproj），而 electron-builder 是拿
// build.electronLanguages 里的字符串去匹配这些目录名的：写成连字符（zh-CN）时一条都匹配不上，
// 中文目录会被当成没人要的语言删掉。删掉之后，系统是中文的机器上 app.getLocale() 只会落到
// en-US，渲染层的「跟随系统」于是永远是英文，而应用里没有任何报错。所以打包时就检查，
// 而不是发出去再靠人发现。
const REQUIRED_MAC_LOCALES = ['en', 'zh_CN', 'zh_TW', 'id'];

async function verifyMacLocalizations(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appResources = context.packager.getResourcesDir(context.appOutDir);
  // 应用包里那几个 .lproj 是空目录，只用来告诉 macOS 这个应用支持哪些语言；
  // Chromium 真正拿来翻译菜单/原生弹窗的 locale.pak 在 Electron 框架里，两边都要在。
  const frameworkResources = typeof context.packager.getMacOsElectronFrameworkResourcesDir === 'function'
    ? context.packager.getMacOsElectronFrameworkResourcesDir(context.appOutDir)
    : path.join(appResources, '..', 'Frameworks', 'Electron Framework.framework', 'Resources');
  const missing = [];
  for (const locale of REQUIRED_MAC_LOCALES) {
    if (!(await pathExists(path.join(appResources, `${locale}.lproj`)))) {
      missing.push(`${locale}.lproj`);
    }
    if (!(await pathExists(path.join(frameworkResources, `${locale}.lproj`, 'locale.pak')))) {
      missing.push(`Electron Framework/${locale}.lproj/locale.pak`);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `[afterPack] macOS localizations were pruned: ${missing.join(', ')} - "follow system" would resolve to English. `
      + 'build.electronLanguages must use Electron\'s on-disk names (zh_CN, not zh-CN)',
    );
  }
}

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
  await verifyBundledMnn(context);
  await pruneLibrespotBinaries(context);
  if (context.electronPlatformName === 'darwin') {
    await verifyMacLocalizations(context);
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
