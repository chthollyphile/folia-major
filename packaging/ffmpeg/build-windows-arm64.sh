#!/usr/bin/env bash
# Builds Folia's audio-only FFmpeg using MSYS2 CLANGARM64 or an LLVM-MinGW cross compiler.
set -euo pipefail

source_dir="$1"
prefix="$2"
if command -v cygpath >/dev/null 2>&1; then
  source_dir="$(cygpath -u "$source_dir")"
  prefix="$(cygpath -u "$prefix")"
fi
cd "$source_dir"

toolchain=(--cc=clang --ar=llvm-ar --ranlib=llvm-ranlib --strip=llvm-strip)
if [[ -n "${FOLIA_FFMPEG_CROSS_PREFIX:-}" ]]; then
  toolchain=(--enable-cross-compile "--cross-prefix=${FOLIA_FFMPEG_CROSS_PREFIX}")
fi

# Match the pinned Folia runtime: local audio decoding plus FLAC/WAV encoding only.
./configure \
  --prefix="$prefix" --target-os=mingw32 --arch=aarch64 "${toolchain[@]}" \
  --disable-autodetect --disable-shared --enable-static --enable-pic \
  --disable-doc --disable-debug --disable-avdevice --disable-swscale \
  --disable-programs --enable-ffmpeg --disable-network \
  --disable-muxers --disable-demuxers --disable-bsfs --disable-filters \
  --disable-parsers --disable-indevs --disable-outdevs \
  --disable-encoders --disable-decoders --disable-hwaccels \
  --disable-protocols --enable-protocol=file,pipe \
  --enable-filter=aformat,anull,atrim,format,null,setpts,trim,aresample \
  --enable-demuxer=image2,aac,ac3,aiff,ape,asf,au,avi,flac,flv,matroska,mov,m4v,mp3,mpc,mpc8,ogg,rm,shorten,tak,tta,wav,wv,xwma,dsf,caf \
  --enable-demuxer=pcm_alaw,pcm_mulaw,pcm_f64be,pcm_f64le,pcm_f32be,pcm_f32le,pcm_s32be,pcm_s32le,pcm_s24be,pcm_s24le,pcm_s16be,pcm_s16le,pcm_s8,pcm_u32be,pcm_u32le,pcm_u24be,pcm_u24le,pcm_u16be,pcm_u16le,pcm_u8 \
  --enable-decoder=aac,aac_latm,ac3,alac,als,ape,atrac1,atrac3,eac3,flac,gsm,gsm_ms,mp1,mp1float,mp2,mp2float,mp3,mp3adu,mp3adufloat,mp3float,mp3on4,mp3on4float,mpc7,mpc8,opus,ra_144,ra_288,ralf,shorten,tak,tta,vorbis,wavpack,wmalossless,wmapro,wmav1,wmav2,wmavoice \
  --enable-decoder=pcm_alaw,pcm_bluray,pcm_dvd,pcm_f32be,pcm_f32le,pcm_f64be,pcm_f64le,pcm_lxf,pcm_mulaw,pcm_s8,pcm_s8_planar,pcm_s16be,pcm_s16be_planar,pcm_s16le,pcm_s16le_planar,pcm_s24be,pcm_s24daud,pcm_s24le,pcm_s24le_planar,pcm_s32be,pcm_s32le,pcm_s32le_planar,pcm_u8,pcm_u16be,pcm_u16le,pcm_u24be,pcm_u24le,pcm_u32be,pcm_u32le \
  --enable-decoder=dsd_lsbf,dsd_msbf,dsd_lsbf_planar,dsd_msbf_planar \
  --enable-parser=aac,aac_latm,ac3,cook,dca,flac,gsm,mpegaudio,tak,vorbis \
  --enable-encoder=flac,pcm_s16le,pcm_s24le,pcm_s32le \
  --enable-muxer=flac,wav,null --extra-ldflags=-static
make -j"${FOLIA_FFMPEG_JOBS:-4}"
make install
