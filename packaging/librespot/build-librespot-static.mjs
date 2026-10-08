import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUNDLE_INFO_NAME,
  DEFAULT_OUTPUT_ROOT,
  LIBRESPOT_BINARY,
  LIBRESPOT_COMMIT,
  LIBRESPOT_RELEASE_TAG,
  LIBRESPOT_SOURCE_URL,
  dynamicImportsOf,
  sha256File,
} from "./fetch-librespot.mjs";

// packaging/librespot/build-librespot-static.mjs
// 在 Windows 上用 MSYS2 的 MinGW 工具链把 pin 住的 go-librespot 编成静态链接的 go-librespot.exe，
// 放进 resources/librespot（不入库，见同目录 README.md）。
//
// 用的是上游 release.yml 里 windows-2022 作业的同一套工具链与同一个包路径（./cmd/daemon），
// 只多加了 -linkmode external -extldflags -static：上游发布的 Windows 包是动态链接的，运行需要
// libFLAC.dll / libmpg123-0.dll 等六个 MinGW 库，而那些库没有可 pin 的分发渠道。静态链接之后
// resources/librespot 里只有一个 exe，构建机之外不再依赖任何第三方二进制。

const MSYS2_CANDIDATES = [
  process.env.MSYS2_ROOT,
  "C:\\msys64",
  "C:\\tools\\msys64",
].filter(Boolean);

/** 与上游 windows 作业一致的依赖，另加 Go 与 git（本地没有 setup-go 步骤） */
const MINGW_PACKAGES = [
  "mingw-w64-x86_64-go",
  "mingw-w64-x86_64-gcc",
  "mingw-w64-x86_64-pkg-config",
  "mingw-w64-x86_64-libogg",
  "mingw-w64-x86_64-libvorbis",
  "mingw-w64-x86_64-flac",
  "mingw-w64-x86_64-mpg123",
];

const SOURCE_DIR = path.join(os.tmpdir(), "folia-librespot-src");

const toMsysPath = (value) => path.resolve(value).replace(/\\/g, "/");

/** 找到 MSYS2 安装根目录；没装就抛出带安装指引的错误 */
function findMsys2Root() {
  for (const candidate of MSYS2_CANDIDATES) {
    if (existsSync(path.join(candidate, "usr", "bin", "bash.exe"))) return candidate;
  }
  throw new Error(
    "找不到 MSYS2。先安装它（winget install MSYS2.MSYS2），装好后重开一次终端再跑 npm run librespot:build；" +
      "若装在别处，把安装目录写进环境变量 MSYS2_ROOT。",
  );
}

/** 在 MSYS2 的 MINGW64 环境里执行一条命令；失败即抛出，避免编出半个产物 */
function runInMsys2(root, command) {
  const result = spawnSync(path.join(root, "usr", "bin", "bash.exe"), ["-lc", command], {
    stdio: "inherit",
    env: { ...process.env, MSYSTEM: "MINGW64", CHERE_INVOKING: "1" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`MSYS2 命令失败（exit ${result.status}）：${command}`);
}

/** 把 go-librespot 检出到 pin 住的 commit；已存在则复用并校验版本 */
function checkoutPinnedSource(sourceDir = SOURCE_DIR) {
  const runGit = (args) => {
    const result = spawnSync("git", args, { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`git ${args.join(" ")} 失败（exit ${result.status}）`);
  };

  if (!existsSync(path.join(sourceDir, ".git"))) {
    runGit(["clone", "--filter=blob:none", "--no-checkout", LIBRESPOT_SOURCE_URL, sourceDir]);
  }
  runGit(["-C", sourceDir, "fetch", "--depth", "1", "origin", `refs/tags/${LIBRESPOT_RELEASE_TAG}`]);
  runGit(["-C", sourceDir, "checkout", "--detach", "FETCH_HEAD"]);

  const head = spawnSync("git", ["-C", sourceDir, "rev-parse", "HEAD"], { encoding: "utf8" });
  const headSha = String(head.stdout || "").trim();
  if (headSha !== LIBRESPOT_COMMIT) {
    throw new Error(
      `检出到的 commit 与 pin 的不一致：期望 ${LIBRESPOT_COMMIT}，实际 ${headSha}。` +
        "标签可能被上游移动过，先确认再更新脚本里的 pin。",
    );
  }
}

/**
 * 编出静态链接的 go-librespot.exe 并写出 BUNDLE-INFO.txt。
 * 返回产物路径；非 Windows 平台直接跳过（main.cjs 也只在 win32 启动守护进程）。
 */
export async function buildStaticLibrespot({
  platform = process.platform,
  outputRoot = DEFAULT_OUTPUT_ROOT,
  sourceDir = SOURCE_DIR,
} = {}) {
  if (platform !== "win32") {
    console.log(`[librespot] static build is Windows-only, skipping on ${platform}`);
    return null;
  }

  const msys2Root = findMsys2Root();
  console.log(`[librespot] MSYS2: ${msys2Root}`);
  runInMsys2(msys2Root, `pacman -S --needed --noconfirm --noprogressbar ${MINGW_PACKAGES.join(" ")}`);

  checkoutPinnedSource(sourceDir);

  await mkdir(outputRoot, { recursive: true });
  const binaryPath = path.join(outputRoot, LIBRESPOT_BINARY);
  // MSYS2 的 FLAC 头文件按 dllimport 声明，与 libFLAC.a 对不上，必须定义 FLAC__NO_DLL；
  // libmpg123.a 的 compat.o 用到 shlwapi 的 Path* 系列函数，静态链接时要显式带上它。
  const cgoCflags = "-DFLAC__NO_DLL";
  const cgoLdflags = "-lshlwapi";
  const ldflags = "-s -w -linkmode external -extldflags -static";
  runInMsys2(
    msys2Root,
    `cd "${toMsysPath(sourceDir)}" && CC=gcc CGO_ENABLED=1 CGO_CFLAGS="${cgoCflags}" CGO_LDFLAGS="${cgoLdflags}" ` +
      `go build -trimpath -o "${toMsysPath(binaryPath)}" -ldflags "${ldflags}" ./cmd/daemon`,
  );

  if (!existsSync(binaryPath)) throw new Error(`编译结束但找不到产物：${binaryPath}`);
  const stillDynamic = dynamicImportsOf(binaryPath);
  if (stillDynamic.length > 0) {
    throw new Error(
      `产物仍是动态链接（引用了 ${stillDynamic.join(", ")}）。` +
        "多半是 MinGW 只找到了导入库，确认 MSYS2 里装了上面那组 mingw-w64-x86_64-* 包后重试。",
    );
  }

  const binarySha256 = sha256File(binaryPath);
  await writeFile(
    path.join(outputRoot, BUNDLE_INFO_NAME),
    `Source: ${LIBRESPOT_SOURCE_URL}\nRelease: ${LIBRESPOT_RELEASE_TAG}\nCommit: ${LIBRESPOT_COMMIT}\n` +
      `Linkage: static\nBinary SHA-256: ${binarySha256}\n`,
  );
  console.log(`[librespot] built ${binaryPath}\n[librespot] sha256 ${binarySha256}`);
  return binaryPath;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  buildStaticLibrespot().then(
    (binary) => {
      if (binary) console.log("[librespot] done - resources/librespot 现在可以打包了");
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
