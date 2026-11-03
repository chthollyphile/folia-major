import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Downloads one pinned Folia FFmpeg release asset for the Electron target and
// stages only its runtime binary plus redistribution metadata for electron-builder.

export const FFMPEG_RELEASE_TAG = "v8.1.2-folia.5";
const RELEASE_BASE_URL = `https://github.com/chthollyphile/folia-ffmpeg-build/releases/download/${FFMPEG_RELEASE_TAG}`;

export const FFMPEG_ASSETS = Object.freeze({
  "linux-x64": {
    archive: "ffmpeg-8.1.2-folia-x86_64-linux-gnu.tar.gz",
    sha256: "2d401c977d47a025abc3ebbf8d2a68de15141bbfa5f7a9ea8919fca855303bb3",
  },
  "linux-arm64": {
    archive: "ffmpeg-8.1.2-folia-arm64-linux-gnu.tar.gz",
    sha256: "287d831a1aaa15d99a00b71cd1a5441e93ab0851cad504b7994456bf8209f19c",
  },
  "mac-x64": {
    archive: "ffmpeg-8.1.2-folia-x86_64-apple-macos10.9.tar.gz",
    sha256: "77305368d6b7d3129f87e5b5ce7173f07ccb570ebb797560512862e467589b6b",
  },
  "mac-arm64": {
    archive: "ffmpeg-8.1.2-folia-arm64-apple-macos11.tar.gz",
    sha256: "9a913e1ea30c813f187a5d9985006969c7493f637a6452162de9e3e52cc4e563",
  },
  "win-x64": {
    archive: "ffmpeg-8.1.2-folia-x86_64-w64-mingw32.tar.gz",
    sha256: "66e4514a41edaa2245eaf2bc5f08d506d99d06979d171d2283a635fc879b3db6",
  },
});

const PLATFORM_NAMES = Object.freeze({
  darwin: "mac",
  linux: "linux",
  win32: "win",
});

export function resolveFfmpegAsset(platform, arch) {
  const osName = PLATFORM_NAMES[platform] ?? platform;
  const key = `${osName}-${arch}`;
  const asset = FFMPEG_ASSETS[key];
  if (!asset)
    throw new Error(`No bundled Folia FFmpeg release for ${platform}/${arch}`);
  return {
    ...asset,
    key,
    osName,
    binaryName: osName === "win" ? "ffmpeg.exe" : "ffmpeg",
  };
}

const sha256File = async (file) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");

const download = async (url, destination) => {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok)
    throw new Error(`Unable to download ${url}: HTTP ${response.status}`);
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
};

const extractArchive = (archive, destination) => {
  const result = spawnSync("tar", ["-xzf", archive, "-C", destination], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`tar failed with exit code ${result.status}`);
};

/** Prepares the exact architecture directory consumed by the extraResources FileSet. */
export async function prepareBundledFfmpeg({
  platform = process.platform,
  arch = process.arch,
  outputRoot = path.resolve("build", "ffmpeg"),
} = {}) {
  const asset = resolveFfmpegAsset(platform, arch);
  if (!/^[a-f0-9]{64}$/.test(asset.sha256)) {
    throw new Error(`Folia FFmpeg checksum is not pinned for ${asset.key}`);
  }

  const targetDir = path.join(outputRoot, asset.key);
  const targetBinary = path.join(targetDir, asset.binaryName);
  const markerPrefix = `Release: ${FFMPEG_RELEASE_TAG}\nArchive: ${asset.archive}\nArchive SHA-256: ${asset.sha256}\n`;
  try {
    const cachedMarker = await readFile(
      path.join(targetDir, "BUNDLE-INFO.txt"),
      "utf8",
    );
    const cachedBinarySha256 = /^Binary SHA-256: ([a-f0-9]{64})$/m.exec(
      cachedMarker,
    )?.[1];
    if (
      cachedMarker.startsWith(markerPrefix) &&
      cachedBinarySha256 &&
      (await sha256File(targetBinary)) === cachedBinarySha256
    )
      return targetDir;
  } catch {
    // Missing/stale output is rebuilt below.
  }

  await mkdir(outputRoot, { recursive: true });
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "folia-ffmpeg-"));
  let stagingDir;
  try {
    const archivePath = path.join(temporaryRoot, asset.archive);
    await download(`${RELEASE_BASE_URL}/${asset.archive}`, archivePath);
    const actualSha256 = await sha256File(archivePath);
    if (actualSha256 !== asset.sha256) {
      throw new Error(
        `Checksum mismatch for ${asset.archive}: expected ${asset.sha256}, got ${actualSha256}`,
      );
    }

    extractArchive(archivePath, temporaryRoot);
    const archiveRoot = path.join(
      temporaryRoot,
      asset.archive.slice(0, -".tar.gz".length),
    );
    const sourceBinary = path.join(archiveRoot, "bin", asset.binaryName);
    const binarySha256 = await sha256File(sourceBinary);
    stagingDir = await mkdtemp(
      path.join(outputRoot, `.${asset.key}-${process.pid}-`),
    );
    await copyFile(sourceBinary, path.join(stagingDir, asset.binaryName));
    if (asset.binaryName === "ffmpeg")
      await chmod(path.join(stagingDir, asset.binaryName), 0o755);
    await cp(
      path.join(archiveRoot, "share", "folia-ffmpeg"),
      path.join(stagingDir, "share", "folia-ffmpeg"),
      { recursive: true },
    );
    await rm(targetDir, { recursive: true, force: true });
    await cp(stagingDir, targetDir, { recursive: true });
    // Written last so a failed copy can never be accepted as a valid cache hit.
    await writeFile(
      path.join(targetDir, "BUNDLE-INFO.txt"),
      `${markerPrefix}Binary SHA-256: ${binarySha256}\n`,
    );
    return targetDir;
  } finally {
    if (stagingDir) await rm(stagingDir, { recursive: true, force: true });
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  prepareBundledFfmpeg().then(
    (output) => console.log(`[ffmpeg] prepared ${output}`),
    (error) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
