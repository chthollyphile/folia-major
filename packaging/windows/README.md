# Windows builds

Release, RC, Cielo and Limo builds use `windows-latest` for x64 and `windows-11-arm`
for native ARM64. Installers are named `Folia-Setup-<version>-x64.exe` and
`Folia-Setup-<version>-arm64.exe`.

On Windows ARM64, install Node 24+, Rust's native ARM64 MSVC toolchain and the
Visual Studio ARM64 C++ build tools. Then from a shell with Node and Cargo on PATH:

```sh
npm ci
npm run build:electron -- --win --arm64 --publish never --config.publish.channel=latest-arm64
node packaging/windows/verify-arm64-install.mjs
```

FFmpeg binaries are built and released by
[folia-ffmpeg-build](https://github.com/chthollyphile/folia-ffmpeg-build).
`beforePack` downloads the target-specific archive pinned in
`packaging/ffmpeg/fetch-ffmpeg.mjs`, verifies its SHA-256, and bundles the runtime
with its source and license metadata. Folia's application build needs no FFmpeg
compiler or MSYS2 setup. Windows ARM64 requires a published
`ffmpeg-8.1.2-folia-aarch64-w64-mingw32.tar.gz` asset in the pinned release;
there is no x64 FFmpeg fallback.

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
