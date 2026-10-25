import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import packageJson from '../../../package.json';

// Verify target-specific locale pruning configuration and the afterPack checks against bundle fixtures.
const require = createRequire(import.meta.url);
type Context = {
    electronPlatformName: string;
    appOutDir: string;
    packager: {
        getResourcesDir: (out: string) => string;
        getMacOsElectronFrameworkResourcesDir?: (out: string) => string;
    };
};
const { verifyLocalizations, default: afterPack } = require('../../../build/afterPack.cjs') as {
    verifyLocalizations: (context: Context) => Promise<void>;
    default: (context: Context) => Promise<void>;
};
const directories: string[] = [];
const macLocales = ['en', 'zh_CN', 'zh_TW', 'id'];
const pakLocales = ['en-US', 'zh-CN', 'zh-TW', 'id'];

afterEach(async () => {
    await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function bundle(platform: string) {
    const appOutDir = await mkdtemp(path.join(os.tmpdir(), 'folia-locales-'));
    directories.push(appOutDir);
    const resources = path.join(appOutDir, 'Folia.app', 'Contents', 'Resources');
    const framework = path.join(resources, '..', 'Frameworks', 'Electron Framework.framework', 'Resources');
    const context: Context = {
        electronPlatformName: platform,
        appOutDir,
        packager: { getResourcesDir: () => resources },
    };
    const files = platform === 'darwin'
        ? macLocales.map(locale => path.join(framework, `${locale}.lproj`, 'locale.pak'))
        : pakLocales.map(locale => path.join(appOutDir, 'locales', `${locale}.pak`));
    if (platform === 'darwin') {
        await Promise.all(macLocales.map(locale => mkdir(path.join(resources, `${locale}.lproj`), { recursive: true })));
    }
    for (const file of files) {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, 'locale fixture');
    }
    return { context, resources, framework, files };
}

describe('bundled Electron localizations', () => {
    it.each(['darwin', 'win32', 'linux'])('%s configuration retains every supported on-disk locale', platform => {
        const wanted = (platform === 'darwin'
            ? packageJson.build.mac.electronLanguages
            : packageJson.build.electronLanguages).map(locale => locale.toLowerCase());
        // electron-builder 26.15.3 compares names without normalizing hyphens/underscores.
        for (const locale of platform === 'darwin' ? macLocales : pakLocales) {
            const language = locale.toLowerCase();
            expect(wanted.some(value => value === language
                || value.startsWith(`${language}-`) || value.startsWith(`${language}_`))).toBe(true);
        }
    });

    it.each(['darwin', 'win32', 'linux'])('accepts a complete %s bundle', async platform => {
        const { context } = await bundle(platform);
        await expect(verifyLocalizations(context)).resolves.toBeUndefined();
    });

    it.each(['win32', 'linux'])('checks %s locales in appOutDir rather than resources', async platform => {
        const { context, resources, files } = await bundle(platform);
        await rm(files[1]);
        const misplaced = path.join(resources, 'locales');
        await mkdir(misplaced, { recursive: true });
        await writeFile(path.join(misplaced, 'zh-CN.pak'), 'wrong location');
        await expect(verifyLocalizations(context)).rejects.toThrow('zh-CN.pak');
        await expect(afterPack(context)).rejects.toThrow('zh-CN.pak');
    });

    it.each(['win32', 'linux'].flatMap(platform => pakLocales.map(locale => [platform, locale])))('rejects a missing %s %s.pak', async (platform, locale) => {
        const { context } = await bundle(platform);
        await rm(path.join(context.appOutDir, 'locales', `${locale}.pak`));
        await expect(verifyLocalizations(context)).rejects.toThrow(`${locale}.pak`);
    });

    it.each(macLocales)('requires both the macOS app and framework %s localization', async locale => {
        const { context, resources, framework } = await bundle('darwin');
        const appLocale = path.join(resources, `${locale}.lproj`);
        await rm(appLocale, { recursive: true });
        await expect(verifyLocalizations(context)).rejects.toThrow(`${locale}.lproj`);
        await expect(afterPack(context)).rejects.toThrow(`${locale}.lproj`);
        await mkdir(appLocale);
        await rm(path.join(framework, `${locale}.lproj`, 'locale.pak'));
        await expect(verifyLocalizations(context)).rejects.toThrow(`Electron Framework/${locale}.lproj/locale.pak`);
    });

    it('uses the packager framework resource path when available', async () => {
        const { context, framework } = await bundle('darwin');
        const versioned = path.join(context.appOutDir, 'Versions', 'A', 'Resources');
        await mkdir(path.dirname(versioned), { recursive: true });
        await rename(framework, versioned);
        context.packager.getMacOsElectronFrameworkResourcesDir = () => versioned;
        await expect(verifyLocalizations(context)).resolves.toBeUndefined();
    });
});
