# Windows builds

Release, RC, Cielo and Limo builds use `windows-latest` for x64 and `windows-11-arm`
for native ARM64. Installers are named `Folia-Setup-<version>-x64.exe` and
`Folia-Setup-<version>-arm64.exe`.

On Windows ARM64, install Node 24+, Rust's native ARM64 MSVC toolchain and the
Visual Studio ARM64 C++ build tools. Prepare FFmpeg in an MSYS2 **CLANGARM64** shell
with `make`, `diffutils`, `tar`, `mingw-w64-clang-aarch64-clang` and
`mingw-w64-clang-aarch64-llvm` installed:

```sh
npm ci
npm run build:ffmpeg
```

Then from a shell with Node and Cargo on PATH:

```sh
npm run build:electron -- --win --arm64 --publish never --config.publish.channel=latest-arm64
node packaging/windows/verify-arm64-install.mjs
```

`beforePack` reuses the verified FFmpeg bundle. If it is absent or stale, run the
FFmpeg command again in CLANGARM64. The source archive is pinned by SHA-256; the
cache also records the build recipe and binary hashes and rejects non-ARM64 PE
files. The source URL, build recipe and LGPL notice travel with the runtime.
There is no x64 FFmpeg fallback. The shell script also supports Linux cross builds
with `FOLIA_FFMPEG_CROSS_PREFIX` pointing to an LLVM-MinGW `aarch64-w64-mingw32-` prefix.

Windows packaging forces the compatible `BCJ` filter by default. Do not use 7-Zip's
automatic ARM64/BCJ2 filters: the bundled NSIS extractor silently skips these
executables ([electron-builder#9983](https://github.com/electron-userland/electron-builder/issues/9983)).
The CI check performs a real silent installation, compares every payload file,
checks the architecture of the primary native binaries, and runs a WAV → FLAC → WAV
round-trip through the installed FFmpeg.

Windows ARM64 update feeds are `latest-arm64.yml`, `beta-arm64.yml` and
`alpha-arm64.yml`; x64 retains the existing channel names. This prevents artifact
collisions and cross-architecture updates. RC updates remain disabled. The optional htdemucs Python runtime currently has no
Windows ARM64 asset; native ONNX beat analysis is bundled.
