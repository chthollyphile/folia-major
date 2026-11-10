import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// packaging/macos/build-desktop-click-guard.mjs
// Builds libfolia_click_guard.dylib (packaging/macos/desktop-click-guard/ClickGuard.swift; the macOS
// wallpaper's Stage Manager click guard, issue #698, loaded into Folia's main process through koffi)
// for one target CPU into build/mac-helper/darwin-<arch>/, which the mac extraResources ship as
// Resources/libfolia_click_guard.dylib. Called from build/beforePack.cjs per packaged arch; one
// macOS job packages both CPUs, so it cross-compiles with swiftc's -target. Needs the Xcode
// command line tools (swiftc), like the MNN runtime needs cmake.

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = path.join(ROOT, 'packaging', 'macos', 'desktop-click-guard', 'ClickGuard.swift');
const TARGETS = { arm64: 'arm64-apple-macos12', x64: 'x86_64-apple-macos12' };
export const DESKTOP_CLICK_GUARD_NAME = 'libfolia_click_guard.dylib';

export async function prepareDesktopClickGuard({ arch, projectRoot = ROOT } = {}) {
    const target = TARGETS[arch];
    if (!target) throw new Error(`No desktop click guard build for macOS/${arch}`);
    const outDir = path.join(projectRoot, 'build', 'mac-helper', `darwin-${arch}`);
    await mkdir(outDir, { recursive: true });
    const out = path.join(outDir, DESKTOP_CLICK_GUARD_NAME);
    await run('xcrun', ['swiftc', '-O', '-emit-library', '-module-name', 'FoliaClickGuard', '-target', target, SOURCE, '-o', out]);
    return out;
}
