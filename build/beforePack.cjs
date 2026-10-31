"use strict";

// build/beforePack.cjs
// Stages native runtimes for electron-builder's target platform and architecture.

const ARCH_NAMES = ["ia32", "x64", "armv7l", "arm64", "universal"];

exports.default = async (context) => {
  if (context.electronPlatformName === 'win32') {
    // Nsis7z cannot decode modern 7-Zip's automatic ARM64/BCJ2 filters (electron-builder#9983).
    process.env.ELECTRON_BUILDER_7Z_FILTER ??= 'BCJ';
  }
  const arch = ARCH_NAMES[context.arch];
  if (!arch)
    throw new Error(
      `Unsupported electron-builder architecture ordinal: ${context.arch}`,
    );
  const { prepareBundledFfmpeg } = await import(
    "../packaging/ffmpeg/fetch-ffmpeg.mjs"
  );
  await prepareBundledFfmpeg({ platform: context.electronPlatformName, arch });
  // The analysis models' runtime (electron/analysis/mnn.cjs), built from the pinned MNN source.
  const { prepareBundledMnn } = await import("./buildMnnRuntime.mjs");
  await prepareBundledMnn({ platform: context.electronPlatformName, arch });
  // The two models (Beat This! final0, htdemucs), verified against shared/modelManifest.json; one
  // file each for every platform.
  const { prepareBundledModels } = await import("./fetchModels.mjs");
  await prepareBundledModels({ outputDir: require("path").join(context.packager.projectDir, "models") });
  if (context.electronPlatformName === 'darwin') {
    const { prepareBundledKoffi } = await import('../packaging/macos/prepare-koffi.mjs');
    await prepareBundledKoffi({ arch, projectRoot: context.packager.projectDir });
    // The wallpaper's Stage Manager click guard (issue #698), a small native helper.
    const { prepareDesktopClickGuard } = await import('../packaging/macos/build-desktop-click-guard.mjs');
    await prepareDesktopClickGuard({ arch, projectRoot: context.packager.projectDir });
  }
};
