import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// packaging/librespot/fetch-librespot.mjs
// 校验 Electron 的 extraResources 与开发检出都指向的 resources/librespot 是否可用。
// 文件名保留 fetch- 前缀是因为 build/beforePack.cjs 按这个名字 import；它现在不再下载任何东西。
//
// 上游发布包是动态链接的：运行需要 libFLAC.dll / libmpg123-0.dll 等六个 MinGW 解码库，而那些库
// 在上游没有任何可 pin 的分发渠道。所以运行时改成用 npm run librespot:build 从下面 pin 住的
// 来源自己编成静态链接的 exe（上游 release.yml 的 windows 作业用的是同一套 MSYS2 工具链与同一个
// 包路径，只多了 -static）。
//
// 仍然遵守仓库规则：二进制不入库，来源与版本 pin 在这里，产物哈希写进 BUNDLE-INFO.txt。
// go-librespot 是 GPL-3.0，来源见 LIBRESPOT_SOURCE_URL。

export const LIBRESPOT_RELEASE_TAG = "v0.10.3";
export const LIBRESPOT_COMMIT = "4dbc099f46da3529adaa85feb97c4f49deb0b130";
export const LIBRESPOT_SOURCE_URL = "https://github.com/devgianlu/go-librespot";
export const LIBRESPOT_BINARY = "go-librespot.exe";
export const BUNDLE_INFO_NAME = "BUNDLE-INFO.txt";

/** 动态链接版本会引用这些 MinGW 库；静态构建里一个都不该出现 */
export const DYNAMIC_IMPORTS = Object.freeze([
  "libFLAC.dll",
  "libmpg123-0.dll",
  "libogg-0.dll",
  "libvorbis-0.dll",
  "libvorbisenc-2.dll",
  "libwinpthread-1.dll",
]);

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_OUTPUT_ROOT = path.resolve(
  HERE,
  "..",
  "..",
  "resources",
  "librespot",
);

export const sha256File = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

/** 二进制里还引用哪些 MinGW 运行库；静态构建应当返回空数组 */
export const dynamicImportsOf = (file) => {
  const bytes = readFileSync(file).toString("latin1");
  return DYNAMIC_IMPORTS.filter((dll) => bytes.includes(dll));
};

/**
 * 校验 resources/librespot 里的静态运行时是否可用，可用时返回根目录。
 *
 * 只有 Windows 打包需要 go-librespot（main.cjs 也只在 win32 启动守护进程），其余平台直接跳过：
 * 这里"没有文件"是正常的，不是失败。
 */
export function verifyBundledLibrespot({
  platform = process.platform,
  outputRoot = DEFAULT_OUTPUT_ROOT,
} = {}) {
  if (platform !== "win32") {
    console.log(`[librespot] no bundled runtime for ${platform}, skipping`);
    return null;
  }

  const binaryPath = path.join(outputRoot, LIBRESPOT_BINARY);
  if (!existsSync(binaryPath)) {
    throw new Error(
      `缺少 ${binaryPath}。先跑 npm run librespot:build，从 ${LIBRESPOT_SOURCE_URL} 的 ` +
        `${LIBRESPOT_RELEASE_TAG}（${LIBRESPOT_COMMIT}）编出静态版本；` +
        "它不入库，所以每台构建机都要跑一次。",
    );
  }

  const stillDynamic = dynamicImportsOf(binaryPath);
  if (stillDynamic.length > 0) {
    throw new Error(
      `${binaryPath} 是动态链接版本（引用了 ${stillDynamic.join(", ")}），它需要上游没有分发渠道的 MinGW 解码库。` +
        "改用 npm run librespot:build 编出的静态版本。",
    );
  }

  const binarySha256 = sha256File(binaryPath);
  const markerPath = path.join(outputRoot, BUNDLE_INFO_NAME);
  if (existsSync(markerPath)) {
    const recorded = /^Binary SHA-256: ([a-f0-9]{64})$/m.exec(
      readFileSync(markerPath, "utf8"),
    )?.[1];
    if (recorded && recorded !== binarySha256) {
      throw new Error(
        `${markerPath} 记的哈希与 ${LIBRESPOT_BINARY} 不符：期望 ${recorded}，实际 ${binarySha256}。` +
          "要么重新跑 npm run librespot:build，要么说明这个 exe 被换过。",
      );
    }
  }

  return outputRoot;
}

/** build/beforePack.cjs 用的旧名字，行为等同校验 */
export const prepareBundledLibrespot = verifyBundledLibrespot;

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    const output = verifyBundledLibrespot();
    if (output) console.log(`[librespot] verified ${output}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
