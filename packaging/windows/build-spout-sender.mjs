#!/usr/bin/env node
// Build the Windows Spout sender helper (Spout output for OBS).
//
// Builds the Rust crate in packaging/windows/spout-sender/ with `cargo build --release` and
// copies folia-spout-sender.exe into build/ so electron-builder's win extraResources packages
// it as resources/folia-spout-sender.exe. Mirrors packaging/windows/build-wallpaper-helper.mjs:
// shared by local `npm run build:electron*` and the CI release workflows, and its output doubles
// as the dev-path override for FOLIA_SPOUT_SENDER_PATH. No-op on non-Windows hosts (the
// Linux/macOS build must not depend on a Rust Windows toolchain).
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC_DIR = path.join(ROOT, 'packaging', 'windows', 'spout-sender');
const OUT_DIR = path.join(ROOT, 'build');
const OUT_BIN = path.join(OUT_DIR, 'folia-spout-sender.exe');

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit', cwd: SRC_DIR });
}

if (process.platform !== 'win32') {
  console.log('[spout-sender] non-Windows host, skipping build');
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
run('cargo', ['build', '--release']);
copyFileSync(path.join(SRC_DIR, 'target', 'release', 'folia-spout-sender.exe'), OUT_BIN);
console.log(`[spout-sender] built ${OUT_BIN}`);
