"use strict";

// build/beforePack.cjs
// Stages native runtimes for electron-builder's target platform and architecture.

const ARCH_NAMES = ["ia32", "x64", "armv7l", "arm64", "universal"];

exports.default = async (context) => {
  const arch = ARCH_NAMES[context.arch];
  if (!arch)
    throw new Error(
      `Unsupported electron-builder architecture ordinal: ${context.arch}`,
    );
  const { prepareBundledFfmpeg } = await import(
    "../packaging/ffmpeg/fetch-ffmpeg.mjs"
  );
  await prepareBundledFfmpeg({ platform: context.electronPlatformName, arch });
  const { prepareBundledLibrespot } = await import(
    "../packaging/librespot/fetch-librespot.mjs"
  );
  // Windows 打包需要 go-librespot 运行时；其他平台这一步自己跳过。
  await prepareBundledLibrespot({ platform: context.electronPlatformName });
  if (context.electronPlatformName === 'darwin') {
    const { prepareBundledKoffi } = await import('../packaging/macos/prepare-koffi.mjs');
    await prepareBundledKoffi({ arch, projectRoot: context.packager.projectDir });
  }
};
