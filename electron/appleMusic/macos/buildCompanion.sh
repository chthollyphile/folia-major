#!/bin/sh
set -eu

# Compile the system-WebKit host without downloading a browser runtime.
native_source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
native_repo_root=$(CDPATH= cd -- "$native_source_dir/../../.." && pwd)
native_bundle=${1:-"$native_repo_root/build/apple-music-native/FoliaAppleMusicCompanion.app"}
native_bundle_id=${2:-org.folia.AppleMusicCompanion}
native_arch=${3:-$(uname -m)}
case "$native_arch" in
    arm64|x86_64) ;;
    *) echo 'Unsupported companion target architecture' >&2; exit 1 ;;
esac
native_cache="$native_repo_root/test-results/apple-music-wk-probe/module-cache-$native_arch"
mkdir -p "$native_bundle/Contents/MacOS" "$native_cache"
# Bundle identifiers are fixed by the developer-facing build command, never supplied by a webpage.
case "$native_bundle_id" in
    org.folia.AppleMusicCompanion|org.folia.AppleMusicWKProbe) ;;
    *) echo 'Unsupported companion bundle identifier' >&2; exit 1 ;;
esac
cat > "$native_bundle/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>$native_bundle_id</string>
<key>CFBundleName</key><string>FoliaAppleMusicCompanion</string>
<key>CFBundleExecutable</key><string>FoliaAppleMusicCompanion</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
swiftc -parse-as-library -module-cache-path "$native_cache" \
    -target "$native_arch-apple-macosx14.0" -framework AppKit -framework WebKit \
    "$native_source_dir/navigationPolicy.swift" "$native_source_dir/nativeCompanion.swift" \
    -o "$native_bundle/Contents/MacOS/FoliaAppleMusicCompanion"
printf '%s\n' "$native_bundle/Contents/MacOS/FoliaAppleMusicCompanion"
