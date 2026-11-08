import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// The afterPack check that fails a package whose electronLanguages pruned a locale "follow system" needs.
const require = createRequire(import.meta.url);
type Context = {
    electronPlatformName: string;
    appOutDir: string;
    packager: {
        getResourcesDir: (out: string) => string;
        getMacOsElectronFrameworkResourcesDir: (out: string) => string;
    };
};
const { verifyBundledLocales } = require('../../../build/afterPack.cjs') as {
    verifyBundledLocales: (context: Context) => Promise<void>;
};
const directories: string[] = [];
const macLocales = ['en', 'zh_CN', 'zh_TW', 'id', 'vi'];
const pakLocales = ['en-US', 'zh-CN', 'zh-TW', 'id', 'vi'];

afterEach(async () => {
    await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

/** A packed app with every locale electron-builder should have kept, laid out as on that platform. */
async function bundle(platform: string) {
    const appOutDir = await mkdtemp(path.join(os.tmpdir(), 'folia-locales-'));
    directories.push(appOutDir);
    const resources = path.join(appOutDir, 'Folia.app', 'Contents', 'Resources');
    const framework = path.join(appOutDir, 'Folia.app', 'Contents', 'Frameworks', 'Electron Framework.framework', 'Resources');
    const context: Context = {
        electronPlatformName: platform,
        appOutDir,
        packager: { getResourcesDir: () => resources, getMacOsElectronFrameworkResourcesDir: () => framework },
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
    return { context, resources, framework };
}

describe('verifyBundledLocales', () => {
    it.each(['darwin', 'win32', 'linux'])('accepts a complete %s bundle', async platform => {
        const { context } = await bundle(platform);
        await expect(verifyBundledLocales(context)).resolves.toBeUndefined();
    });

    it('rejects a mac bundle without zh_CN.lproj', async () => {
        const { context, resources } = await bundle('darwin');
        await rm(path.join(resources, 'zh_CN.lproj'), { recursive: true });
        await expect(verifyBundledLocales(context)).rejects.toThrow('zh_CN.lproj');
    });

    it('rejects a mac bundle whose Electron framework lost zh_CN.lproj/locale.pak', async () => {
        const { context, framework } = await bundle('darwin');
        await rm(path.join(framework, 'zh_CN.lproj', 'locale.pak'));
        await expect(verifyBundledLocales(context)).rejects.toThrow(path.join('zh_CN.lproj', 'locale.pak'));
    });

    it.each(['win32', 'linux'])('rejects a %s bundle without zh-CN.pak', async platform => {
        const { context } = await bundle(platform);
        await rm(path.join(context.appOutDir, 'locales', 'zh-CN.pak'));
        await expect(verifyBundledLocales(context)).rejects.toThrow('zh-CN.pak');
    });
});
