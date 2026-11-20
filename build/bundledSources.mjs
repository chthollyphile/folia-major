import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageExclusionPattern, upstreamPackageExclusions } from '../dev/sources/packaging.mjs';
import { bundledSourceIds, listSourceIds, selectSourceIds, sourceModId } from '../dev/sources/selection.mjs';
// build/bundledSources.mjs
// electron-builder 的上层配置（package.json 的 build.extends 指过来，electron-builder 先读它，再把 package.json 的 build 合上去）：
// 内置音源在安装包里的样子（Folium 2.0 方案 §6.2「打包」、§11「合规预案」）。随包带哪些由构建参数 FOLIA_BUNDLED_SOURCES 定
// （dev/sources/selection.mjs：没设是 sources/ 里全部，空是一个都不带，否则是逗号隔开的短 id），它决定：
//   - extraResources：只放带的那几个 dist-mods/<id> 到 resources/builtin-mods/<id>（sources:build 要用同一个参数先构建）；
//   - extraMetadata.foliaBundledSources：写进安装包里的 package.json，主进程据此判断「不带」的音源（builtinSources.cjs）；
//   - files 的排除规则：各音源自己带着的上游库都不进 app.asar（dev/sources/packaging.mjs），不带的音源的原生件也不进；
//   - Apple Music 的伴侣程序（win / mac 的 extraResources）只在带 Apple Music 时放。
// 受信表（electron/modSystem/builtinSources.cjs）九行都留着：外部模组接管一个不带的音源时，它声明的旧登录
// （sources[].claims）要拿那一行核对（sourceOwnership.cjs 的 claimRefusal），删了那一行接管就拿不到旧登录。
// electron-builder 合并数组时取并集，所以这里给的 extraResources 接在 package.json 的那些后面。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_STAMP = 'build.json';
const APPLE_MUSIC = 'appleMusic';

// The Apple Music companion's files (sources/appleMusic/native/windows/prepareBundle.cjs WINDOWS_COMPANION_FILES).
const WINDOWS_COMPANION = {
    from: 'build/apple-music-native/windows',
    to: 'apple-music/windows',
    filter: [
        'FoliaAppleMusicCompanion.exe',
        'FoliaAppleMusicCompanion.exe.config',
        'Microsoft.Web.WebView2.Core.dll',
        'Microsoft.Web.WebView2.WinForms.dll',
        'WebView2Loader.dll',
    ],
};
const MAC_COMPANION = {
    from: 'build/apple-music-native/darwin-${arch}/FoliaAppleMusicCompanion.app',
    to: 'apple-music/FoliaAppleMusicCompanion.app',
};

/** 这次带的音源目录名（`bundled` 缺省读 FOLIA_BUNDLED_SOURCES）。 */
export const bundledSourceDirs = ({ root = ROOT, bundled = process.env.FOLIA_BUNDLED_SOURCES } = {}) => (
    selectSourceIds(listSourceIds(path.join(root, 'sources')), bundled)
);

/**
 * dist-mods/ 和这次的选择对不上时的说明，对得上时是 null：带的每个都要构建过（有 build.json），构建过的不能多出来
 * （没跑 sources:build、或用了另一个 FOLIA_BUNDLED_SOURCES 构建，打出的包会和它的声明不一致）。
 */
export const builtModsMismatch = (selected, outRoot) => {
    const built = fs.existsSync(outRoot)
        ? fs.readdirSync(outRoot, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && fs.existsSync(path.join(outRoot, entry.name, BUILD_STAMP)))
            .map((entry) => entry.name)
        : [];
    const missing = selected.filter((id) => !built.includes(id));
    const extra = built.filter((id) => !selected.includes(id));
    if (missing.length === 0 && extra.length === 0) return null;
    return [
        missing.length > 0 ? `dist-mods 里没有构建好的 ${missing.join('、')}` : '',
        extra.length > 0 ? `dist-mods 里多出 ${extra.join('、')}` : '',
    ].filter(Boolean).join('；') + '：先用同一个 FOLIA_BUNDLED_SOURCES 跑 npm run sources:build';
};

/**
 * 交给 electron-builder 的配置。`checkBuilt` 时核对 dist-mods/ 与选择一致（真打包时；单测不核对）。
 * @param {{ root?: string, bundled?: string, checkBuilt?: boolean }} [options]
 */
export const bundledSourcesConfig = ({ root = ROOT, bundled = process.env.FOLIA_BUNDLED_SOURCES, checkBuilt = false } = {}) => {
    const selected = bundledSourceDirs({ root, bundled });
    if (checkBuilt) {
        const mismatch = builtModsMismatch(selected, path.join(root, 'dist-mods'));
        if (mismatch) throw new Error(`[bundledSources] ${mismatch}`);
        // electron-builder merges extraMetadata into the app's package.json by union: a list already written there
        // (sources:build --stamp) would outlast this one.
        const stamped = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).foliaBundledSources;
        if (stamped !== undefined) throw new Error('[bundledSources] package.json 里已经写着 foliaBundledSources：打包时由这里写，先去掉它');
    }
    const foliaBundledSources = bundledSourceIds(selected.map((id) => sourceModId(path.join(root, 'sources', id))));
    const keepNative = (_name, owners) => owners.some((owner) => selected.includes(owner.sourceId));
    const withAppleMusic = selected.includes(APPLE_MUSIC);
    return {
        extraMetadata: { foliaBundledSources },
        files: upstreamPackageExclusions({ root, keepNative }).map(packageExclusionPattern),
        extraResources: selected.map((id) => ({ from: `dist-mods/${id}`, to: `builtin-mods/${id}`, filter: ['**/*', '!**/*.tmp'] })),
        win: { extraResources: withAppleMusic ? [WINDOWS_COMPANION] : [] },
        mac: { extraResources: withAppleMusic ? [MAC_COMPANION] : [] },
    };
};

/** beforePack / afterPack 用：这次带不带 `sourceId` 这个音源目录。 */
export const bundlesSource = (sourceId, options) => bundledSourceDirs(options).includes(sourceId);

export default () => {
    const config = bundledSourcesConfig({ checkBuilt: true });
    console.log(`[bundledSources] foliaBundledSources = ${JSON.stringify(config.extraMetadata.foliaBundledSources)}`);
    return config;
};
