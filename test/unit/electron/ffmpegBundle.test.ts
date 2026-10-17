import { describe, expect, it } from "vitest";
import {
  FFMPEG_ASSETS,
  FFMPEG_RELEASE_TAG,
  resolveFfmpegAsset,
} from "../../../packaging/ffmpeg/fetch-ffmpeg.mjs";

// Locks the release/target mapping without performing network access in unit tests.

describe("bundled Folia FFmpeg manifest", () => {
  it("pins the Folia FFmpeg release whose macOS binaries load only system libraries", () => {
    expect(FFMPEG_RELEASE_TAG).toBe("v8.1.2-folia.3");
    for (const asset of Object.values(FFMPEG_ASSETS)) {
      expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it.each([
    ["win32", "x64", "win-x64", "ffmpeg.exe"],
    ["linux", "x64", "linux-x64", "ffmpeg"],
    ["linux", "arm64", "linux-arm64", "ffmpeg"],
    ["darwin", "x64", "mac-x64", "ffmpeg"],
    ["darwin", "arm64", "mac-arm64", "ffmpeg"],
  ])("maps %s/%s to %s", (platform, arch, key, binaryName) => {
    expect(resolveFfmpegAsset(platform, arch)).toMatchObject({
      key,
      binaryName,
    });
  });

  it("fails instead of silently bundling a binary for the wrong architecture", () => {
    expect(() => resolveFfmpegAsset("win32", "arm64")).toThrow(
      "No bundled Folia FFmpeg release",
    );
  });
});
