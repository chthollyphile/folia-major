import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
// dev/sources/selection.mjs
// 这次带哪些内置音源（Folium 2.0 方案 §6.2 的 FOLIA_BUNDLED_SOURCES）：构建（build.mjs）、electron-builder 的上层配置
// （build/bundledSources.mjs、packaging.mjs）和网页构建（webSourcePlugin.mjs）都从这里取，选法只有一份。不 import 打包器，
// electron-builder 读配置时也能加载它。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requireHere = createRequire(import.meta.url);
const { BUILTIN_SOURCE_TABLE } = requireHere('../../electron/modSystem/builtinSources.cjs');

export const SOURCES_ROOT = path.join(ROOT, 'sources');

/** 一个目录是不是音源目录：有 mod.json。 */
export const isSourceDir = (dir) => fs.existsSync(path.join(dir, 'mod.json'));

/** `root` 下的音源目录名（排好序）；目录不存在时是空的。 */
export const listSourceIds = (root = SOURCES_ROOT) => {
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && isSourceDir(path.join(root, entry.name)))
        .map((entry) => entry.name)
        .sort();
};

/*
 * 这次带哪些：FOLIA_BUNDLED_SOURCES 没设是全部；设成空是一个都不带；否则是逗号隔开的目录名（就是音源的短 id），
 * 不在 sources/ 里的报错（拼错了不能悄悄少带一个）。
 */
export const selectSourceIds = (available, bundled = process.env.FOLIA_BUNDLED_SOURCES) => {
    if (bundled === undefined) return [...available];
    const wanted = bundled.split(',').map((id) => id.trim()).filter(Boolean);
    const unknown = wanted.filter((id) => !available.includes(id));
    if (unknown.length > 0) {
        throw new Error(`FOLIA_BUNDLED_SOURCES 里的 ${unknown.join('、')} 不在 sources/ 里（有的是：${available.join('、') || '无'}）`);
    }
    return available.filter((id) => wanted.includes(id));
};

/**
 * 安装包的 `foliaBundledSources`：构建了的那些模组在受信表（electron/modSystem/builtinSources.cjs）里那一行的短音源 id。
 * 不在受信表里的模组不算内置音源（它的音源是 folium.<模组 id>.<名字>）。
 */
export const bundledSourceIds = (modIds) => [...new Set(modIds.flatMap((modId) => (
    Object.hasOwn(BUILTIN_SOURCE_TABLE, modId) ? BUILTIN_SOURCE_TABLE[modId].sources : []
)))];

/** 音源目录 `dir` 的模组 id（mod.json 的 id）。 */
export const sourceModId = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'mod.json'), 'utf8')).id;
