const fs = require('node:fs/promises');
const path = require('node:path');

// build/afterPack.cjs

const ONNX_BIN_RELATIVE_PATH = path.join(
  'app.asar.unpacked',
  'node_modules',
  'onnxruntime-node',
  'bin',
  'napi-v6',
);

// electron-builder 的 Arch 枚举，按序号展开。刻意不 require('builder-util')：那只是
// electron-builder 的传递依赖，能解析到纯属 npm 扁平提升的副作用，依赖树一变就会在打包
// 末期才炸。这五个值是 electron-builder 的公开契约，比提升可靠。
const ARCH_NAMES = ['ia32', 'x64', 'armv7l', 'arm64', 'universal'];

/** 打包产物的入口名，与 package.json 的 build.linux.executableName 一致。 */
const LINUX_ENTRY_NAME = 'folia-major';
/** 改名后的 Electron 二进制名，被包装脚本 exec，见 packaging/linux/folia-major-launch.sh。 */
const LINUX_APP_BINARY_NAME = 'folia-major-app';
/** 包装脚本模板：抬 renderer 的 fd 上限，然后 exec 上面的二进制。 */
const LINUX_LAUNCHER_TEMPLATE = path.join(__dirname, '..', 'packaging', 'linux', 'folia-major-launch.sh');

async function pathExists(candidate) {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

// Keep only the native ONNX Runtime binaries usable by the package being built.
async function pruneOnnxRuntimeBinaries(context) {
  const resourcesDir = context.packager.getResourcesDir(context.appOutDir);
  const binariesDir = path.join(resourcesDir, ONNX_BIN_RELATIVE_PATH);
  if (!(await pathExists(binariesDir))) return;

  const targetPlatform = context.electronPlatformName;
  const targetArch = ARCH_NAMES[context.arch];
  if (!targetArch) {
    // 不认识的架构就整包留着。少几百 MB 好过删光目标架构自己的 .so。
    console.warn(`[afterPack] unknown Arch ordinal ${context.arch}, keeping every onnxruntime binary`);
    return;
  }
  const keptArchitectures = targetArch === 'universal'
    ? new Set(['x64', 'arm64'])
    : new Set([targetArch]);

  for (const platformEntry of await fs.readdir(binariesDir, { withFileTypes: true })) {
    if (!platformEntry.isDirectory()) continue;
    const platformDir = path.join(binariesDir, platformEntry.name);

    if (platformEntry.name !== targetPlatform) {
      await fs.rm(platformDir, { recursive: true, force: true });
      continue;
    }

    for (const archEntry of await fs.readdir(platformDir, { withFileTypes: true })) {
      if (archEntry.isDirectory() && !keptArchitectures.has(archEntry.name)) {
        await fs.rm(path.join(platformDir, archEntry.name), { recursive: true, force: true });
      }
    }
  }

  await warnIfTargetHasNoBinary(binariesDir, targetPlatform, keptArchitectures);
}

/**
 * 目标平台/架构在 onnxruntime-node 里根本没有原生库时，在构建日志里喊一声。
 *
 * 现在就有一例：onnxruntime-node 1.29 的 darwin 只发 arm64，而 build.mac.target 仍然构建 x64，
 * 于是 mac x64 包裁剪后这里是空的。功能上不是回归——原先塞进去的是 arm64 的 .node，Intel
 * Electron 一样 require 不动，worker.cjs 的顶层 catch 会把它降级成渲染层估算器——但沉默地发一个
 * 分析功能失效的包不该靠人去发现。上游哪天再砍掉一个架构，这行会在打包时就说出来。
 */
async function warnIfTargetHasNoBinary(binariesDir, targetPlatform, keptArchitectures) {
  const platformDir = path.join(binariesDir, targetPlatform);
  const present = (await pathExists(platformDir))
    ? (await fs.readdir(platformDir, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
    : [];

  const missing = [...keptArchitectures].filter(arch => !present.includes(arch));
  if (missing.length === 0) return;

  console.warn(
    `[afterPack] onnxruntime-node ships no binary for ${targetPlatform}/${missing.join(', ')}`
    + ' - beat detection will fall back to the renderer estimators in this package',
  );
}

/**
 * Linux：把入口可执行文件换成"抬 fd 上限"的包装脚本。
 *
 * renderer 的 soft RLIMIT_NOFILE 是从启动进程继承的，Chromium 从不为 renderer 抬高它，而
 * systemd 给桌面应用的默认值是 1024。播放期间的共享内存泄漏（~0.5 fd/s）撞上这个 1024 之后，
 * 合成器不再出帧——画面定格、进程还活着。把包装脚本放到入口名上，deb/rpm 的
 * `/usr/bin/folia-major` 符号链接、AUR 包和便携版说明就一起生效，不需要改 .desktop，也不需要
 * 发行版配合。实测：这样启动后 renderer 的 soft 上限是 524288（未经启动脚本时是 1024），
 * 页面与播放正常。
 */
async function installLinuxLauncher(context) {
  if (context.electronPlatformName !== 'linux') return;

  const appDir = context.appOutDir;
  const entry = path.join(appDir, LINUX_ENTRY_NAME);
  const renamed = path.join(appDir, LINUX_APP_BINARY_NAME);

  // afterPack 每个 platform/arch 打包进一次（platformPackager 在 pack 阶段调它，之后
  // tar.gz / deb / rpm 都从这同一个 appOutDir 出包），正常流程只会走到这里一次。
  // 这个判断是防御性的：万一钩子被再调一次，入口已经是脚本、二进制已经改名，再走一遍就会把脚本
  // 改名成 folia-major-app、用 shell 覆盖掉真正的 Electron 二进制。
  if (await pathExists(renamed)) return;
  if (!(await pathExists(entry))) {
    console.warn(`[afterPack] ${LINUX_ENTRY_NAME} not found in ${appDir}, skipping the Linux launcher`);
    return;
  }

  await fs.rename(entry, renamed);
  await fs.copyFile(LINUX_LAUNCHER_TEMPLATE, entry);
  await fs.chmod(entry, 0o755);
}

exports.default = async (context) => {
  await pruneOnnxRuntimeBinaries(context);
  await installLinuxLauncher(context);
};
