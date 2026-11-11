import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// test/unit/electron/linuxDesktopIntegration.test.ts
// Tests Linux desktop entry metadata, WM_CLASS / app_id alignment, and packaging configuration.

describe('linuxDesktopIntegration', () => {
  const rootDir = path.resolve(__dirname, '../../../');
  const packageJsonPath = path.join(rootDir, 'package.json');
  const mainCjsPath = path.join(rootDir, 'electron/main.cjs');
  const linuxDesktopTemplatePath = path.join(rootDir, 'packaging/linux/folia-major.desktop');
  const aurDesktopPath = path.join(rootDir, 'packaging/aur/folia-major-bin/folia-major.desktop');
  const aurPkgbuildPath = path.join(rootDir, 'packaging/aur/folia-major-bin/PKGBUILD');
  const aurSrcinfoPath = path.join(rootDir, 'packaging/aur/folia-major-bin/.SRCINFO');

  it('declares desktopName and syncDesktopName in package.json matching executableName', () => {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    expect(pkg.desktopName).toBe('folia-major.desktop');
    expect(pkg.build?.linux?.executableName).toBe('folia-major');
    expect(pkg.build?.linux?.syncDesktopName).toBe(true);
    expect(pkg.build?.linux?.desktop?.entry?.StartupWMClass).toBe('folia-major');
  });

  it('leaves Linux desktop identity to package.json desktopName instead of electron/main.cjs', () => {
    // Electron applies package.json desktopName at startup; a second setDesktopName call would drift from it.
    const mainContent = fs.readFileSync(mainCjsPath, 'utf8');

    expect(mainContent).not.toContain('app.setDesktopName(');
  });

  it('aligns StartupWMClass to folia-major in portable linux desktop entry', () => {
    const content = fs.readFileSync(linuxDesktopTemplatePath, 'utf8');

    expect(content).toMatch(/^StartupWMClass=folia-major$/m);
  });

  it('aligns StartupWMClass and verifies sha256 checksums in AUR package', () => {
    const desktopContent = fs.readFileSync(aurDesktopPath, 'utf8');
    expect(desktopContent).toMatch(/^StartupWMClass=folia-major$/m);

    const desktopHash = crypto.createHash('sha256').update(desktopContent).digest('hex');
    const pkgbuildContent = fs.readFileSync(aurPkgbuildPath, 'utf8');
    const srcinfoContent = fs.readFileSync(aurSrcinfoPath, 'utf8');

    expect(pkgbuildContent).toContain(desktopHash);
    expect(srcinfoContent).toContain(desktopHash);
  });

  it('disables makepkg strip/debug for the prebuilt AUR package (#1138)', () => {
    // Prebuilt Electron binaries carry incomplete split-DWARF; makepkg strip/debug only yields gdb-add-index errors.
    const pkgbuildContent = fs.readFileSync(aurPkgbuildPath, 'utf8');
    const srcinfoContent = fs.readFileSync(aurSrcinfoPath, 'utf8');
    const updateScript = fs.readFileSync(path.join(rootDir, 'packaging/aur/folia-major-bin/update.sh'), 'utf8');

    expect(pkgbuildContent).toMatch(/^options=\('!strip' '!debug'\)$/m);
    for (const content of [srcinfoContent, updateScript]) {
      expect(content).toMatch(/^\toptions = !strip$/m);
      expect(content).toMatch(/^\toptions = !debug$/m);
    }
  });
});
