import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// packaging/librespot/fetch-librespot.mjs
// Puts the pinned go-librespot Windows build where Electron's extraResources FileSet and a dev
// checkout expect it - resources/librespot - and refuses to hand over a file it cannot vouch for.
//
// Why this is not in git: a 13.8MB third-party executable that only changes when upstream cuts a
// release does not belong in every clone's history. Same rule as models/ and build/ffmpeg/: the
// hash is the point of this script, not the download.
//
// go-librespot is GPL-3.0 (https://github.com/devgianlu/go-librespot). Its Windows build links
// against MinGW decoder libraries that upstream's archive does not ship, so this script checks for
// them too and names what is missing, instead of letting a packaged app fail to start on a user's
// machine. See README.md beside this file.

export const LIBRESPOT_RELEASE_TAG = "v0.10.3";
const RELEASE_BASE_URL = `https://github.com/devgianlu/go-librespot/releases/download/${LIBRESPOT_RELEASE_TAG}`;

export const LIBRESPOT_ASSET = Object.freeze({
  archive: "go-librespot_windows_amd64.tar.gz",
  sha256: "d58659bbd66fc3c57029c7cc5d9c1a6d7d866bc1026f819bd95bc964d3e7872a",
  binaryName: "go-librespot.exe",
});

/**
 * 上游发布包只带 exe，它在 Windows 上动态链接这些 MinGW 解码库；缺任何一个进程都起不来，
 * 所以在交给打包之前显式检查，而不是让用户机器上的应用静默失败。
 */
export const REQUIRED_DLLS = Object.freeze([
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

const sha256File = async (file) =>
  createHash("sha256").update(await readFile(file)).digest("hex");

/** 下载 pin 住的发布包；非 200 直接失败，避免把错误页当压缩包解开。 */
const download = async (url, destination) => {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok)
    throw new Error(`Unable to download ${url}: HTTP ${response.status}`);
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
};

/** 解官方 tar.gz；只取 exe，压缩包里的 README 不进 resources。 */
const extractArchive = (archive, destination) => {
  const result = spawnSync("tar", ["-xzf", archive, "-C", destination], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`tar failed with exit code ${result.status}`);
};

/**
 * Prepares resources/librespot for this machine.
 *
 * 只有 Windows 打包需要 go-librespot（main.cjs 也只在 win32 启动守护进程），其余平台直接跳过：
 * 这里"没有文件"是正常的，不是失败。
 */
export async function prepareBundledLibrespot({
  platform = process.platform,
  outputRoot = DEFAULT_OUTPUT_ROOT,
} = {}) {
  if (platform !== "win32") {
    console.log(`[librespot] no bundled runtime for ${platform}, skipping`);
    return null;
  }
  if (!/^[a-f0-9]{64}$/.test(LIBRESPOT_ASSET.sha256))
    throw new Error("go-librespot checksum is not pinned");

  const binaryPath = path.join(outputRoot, LIBRESPOT_ASSET.binaryName);
  const markerPrefix = `Release: ${LIBRESPOT_RELEASE_TAG}\nArchive: ${LIBRESPOT_ASSET.archive}\nArchive SHA-256: ${LIBRESPOT_ASSET.sha256}\n`;
  try {
    const cachedMarker = await readFile(
      path.join(outputRoot, "BUNDLE-INFO.txt"),
      "utf8",
    );
    const cachedBinarySha256 = /^Binary SHA-256: ([a-f0-9]{64})$/m.exec(
      cachedMarker,
    )?.[1];
    if (
      cachedMarker.startsWith(markerPrefix) &&
      cachedBinarySha256 &&
      (await sha256File(binaryPath)) === cachedBinarySha256 &&
      REQUIRED_DLLS.every((dll) => existsSync(path.join(outputRoot, dll)))
    )
      return outputRoot;
  } catch {
    // Missing or stale output is rebuilt below.
  }

  await mkdir(outputRoot, { recursive: true });
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "folia-librespot-"));
  try {
    const archivePath = path.join(temporaryRoot, LIBRESPOT_ASSET.archive);
    await download(`${RELEASE_BASE_URL}/${LIBRESPOT_ASSET.archive}`, archivePath);
    const actualSha256 = await sha256File(archivePath);
    if (actualSha256 !== LIBRESPOT_ASSET.sha256) {
      throw new Error(
        `Checksum mismatch for ${LIBRESPOT_ASSET.archive}: expected ${LIBRESPOT_ASSET.sha256}, got ${actualSha256}`,
      );
    }

    extractArchive(archivePath, temporaryRoot);
    const sourceBinary = path.join(temporaryRoot, LIBRESPOT_ASSET.binaryName);
    const binarySha256 = await sha256File(sourceBinary);
    await copyFile(sourceBinary, binaryPath);
    if ((await sha256File(binaryPath)) !== binarySha256)
      throw new Error("go-librespot binary changed while it was being staged");
    // 最后才写标记文件：一次中途失败的复制不该被下一次运行当成有效缓存。
    await writeFile(
      path.join(outputRoot, "BUNDLE-INFO.txt"),
      `${markerPrefix}Binary SHA-256: ${binarySha256}\n`,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }

  const missing = REQUIRED_DLLS.filter(
    (dll) => !existsSync(path.join(outputRoot, dll)),
  );
  if (missing.length > 0) {
    throw new Error(
      `go-librespot cannot run without ${missing.join(", ")} in ${outputRoot}. ` +
        "Upstream's release archive ships the executable alone and this repo has no " +
        "redistribution channel for the MinGW decoder libraries yet - see " +
        "packaging/librespot/README.md.",
    );
  }
  return outputRoot;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  prepareBundledLibrespot().then(
    (output) => {
      if (output) console.log(`[librespot] prepared ${output}`);
    },
    (error) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
