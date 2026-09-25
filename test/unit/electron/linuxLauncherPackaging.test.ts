import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// test/unit/electron/linuxLauncherPackaging.test.ts
// Covers the packaging half of the renderer fd budget fix: the app dir must end up with the
// launcher on the entry name and the Electron binary renamed underneath it, because that is
// what puts the raised RLIMIT_NOFILE in front of every Linux launch path (deb/rpm symlink,
// AUR package, portable README) without touching any .desktop file.

const afterPack = require('../../../build/afterPack.cjs').default as (context: unknown) => Promise<void>;

const LAUNCHER_TEMPLATE = path.resolve(__dirname, '../../../packaging/linux/folia-major-launch.sh');
const ENTRY_NAME = 'folia-major';
const APP_BINARY_NAME = 'folia-major-app';

const makeContext = (appOutDir: string, electronPlatformName = 'linux') => ({
  appOutDir,
  arch: 1,
  electronPlatformName,
  packager: { getResourcesDir: (dir: string) => path.join(dir, 'resources') },
});

const makeAppDir = () => {
  const appOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-afterpack-'));
  fs.writeFileSync(path.join(appOutDir, ENTRY_NAME), 'FAKE-ELECTRON-BINARY', { mode: 0o755 });
  return appOutDir;
};

describe('afterPack linux launcher', () => {
  it('renames the electron binary and puts the launcher on the entry name', async () => {
    const appOutDir = makeAppDir();
    try {
      await afterPack(makeContext(appOutDir));

      const binaryPath = path.join(appOutDir, APP_BINARY_NAME);
      const entryPath = path.join(appOutDir, ENTRY_NAME);

      expect(fs.readFileSync(binaryPath, 'utf8')).toBe('FAKE-ELECTRON-BINARY');
      expect(fs.statSync(binaryPath).mode & 0o111).not.toBe(0);

      const launcher = fs.readFileSync(entryPath, 'utf8');
      expect(launcher).toBe(fs.readFileSync(LAUNCHER_TEMPLATE, 'utf8'));
      expect(launcher).toContain(APP_BINARY_NAME);
      expect(fs.statSync(entryPath).mode & 0o111).not.toBe(0);
    } finally {
      fs.rmSync(appOutDir, { recursive: true, force: true });
    }
  });

  it('is idempotent, so a second invocation cannot rename the launcher over the binary', async () => {
    const appOutDir = makeAppDir();
    try {
      await afterPack(makeContext(appOutDir));
      const launcherAfterFirst = fs.readFileSync(path.join(appOutDir, ENTRY_NAME), 'utf8');

      await afterPack(makeContext(appOutDir));

      expect(fs.readFileSync(path.join(appOutDir, ENTRY_NAME), 'utf8')).toBe(launcherAfterFirst);
      expect(fs.readFileSync(path.join(appOutDir, APP_BINARY_NAME), 'utf8')).toBe('FAKE-ELECTRON-BINARY');
    } finally {
      fs.rmSync(appOutDir, { recursive: true, force: true });
    }
  });

  it('leaves non-linux builds alone', async () => {
    const appOutDir = makeAppDir();
    try {
      await afterPack(makeContext(appOutDir, 'darwin'));

      expect(fs.readFileSync(path.join(appOutDir, ENTRY_NAME), 'utf8')).toBe('FAKE-ELECTRON-BINARY');
      expect(fs.existsSync(path.join(appOutDir, APP_BINARY_NAME))).toBe(false);
    } finally {
      fs.rmSync(appOutDir, { recursive: true, force: true });
    }
  });

  it('warns instead of throwing when the packaged entry is missing', async () => {
    const appOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-afterpack-'));
    try {
      await expect(afterPack(makeContext(appOutDir))).resolves.toBeUndefined();
      expect(fs.existsSync(path.join(appOutDir, APP_BINARY_NAME))).toBe(false);
    } finally {
      fs.rmSync(appOutDir, { recursive: true, force: true });
    }
  });
});
