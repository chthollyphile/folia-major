import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// packaging/beat-this-small/fetch-beat-this-small.mjs
// Downloads the pinned Beat This! small0 WebGPU export - the model Sonnet's 智能动感模式 runs - from its
// own release repository and stages it in the repo's models/ for electron-builder's extraResources
// (resources/models, where electron/main.cjs getBundledModelsDirectory looks). A dev checkout finds it
// in the same place.
//
// Not in git and not a listener download: like FFmpeg, one exact file pinned by tag and sha256, pulled
// in when the app is packaged. The release repository says how the file was made from the authors'
// checkpoint (build/beat_this_wgsl/export_weights.py --f16).

export const BEAT_THIS_SMALL_RELEASE_TAG = "small0-v1";
const RELEASE_BASE_URL = `https://github.com/lantudou/folia-beat-this-small/releases/download/${BEAT_THIS_SMALL_RELEASE_TAG}`;

export const BEAT_THIS_SMALL_ASSET = Object.freeze({
  file: "beat_this-small-wgsl.bin",
  bytes: 4755823,
  sha256: "b143091f1c2060169d7f72276bc84684c8bd22b19d5c6a9a60cdf4eaf20079b4",
});

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const isPinnedFile = async (file) => {
  try {
    const bytes = await readFile(file);
    return bytes.length === BEAT_THIS_SMALL_ASSET.bytes && sha256(bytes) === BEAT_THIS_SMALL_ASSET.sha256;
  } catch {
    return false;
  }
};

/** Puts the verified file at <outputDir>/beat_this-small-wgsl.bin, downloading only when it is not already there. */
export async function prepareBundledBeatThisSmall({
  outputDir = path.resolve("models"),
} = {}) {
  const target = path.join(outputDir, BEAT_THIS_SMALL_ASSET.file);
  if (await isPinnedFile(target)) return target;

  const url = `${RELEASE_BASE_URL}/${BEAT_THIS_SMALL_ASSET.file}`;
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Unable to download ${url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (bytes.length !== BEAT_THIS_SMALL_ASSET.bytes || actual !== BEAT_THIS_SMALL_ASSET.sha256) {
    throw new Error(
      `Checksum mismatch for ${BEAT_THIS_SMALL_ASSET.file}: expected ${BEAT_THIS_SMALL_ASSET.sha256} (${BEAT_THIS_SMALL_ASSET.bytes} bytes), got ${actual} (${bytes.length} bytes)`,
    );
  }

  // Written beside the target and renamed, so a failed write is never found under the real name.
  await mkdir(outputDir, { recursive: true });
  const part = `${target}.${process.pid}.part`;
  try {
    await writeFile(part, bytes);
    await rename(part, target);
  } finally {
    await rm(part, { force: true });
  }
  return target;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  prepareBundledBeatThisSmall().then(
    (output) => console.log(`[beat-this-small] prepared ${output}`),
    (error) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
