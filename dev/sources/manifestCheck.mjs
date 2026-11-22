import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
// dev/sources/manifestCheck.mjs
// 仓库里内置音源（sources/<id>/）的清单校验：签名检查（test/unit/mod-system/sampleMods.test.ts）只扫 mods/，
// sources/ 不签名（方案 §5.2），所以另有这一份。测试在 test/unit/sources/builtinManifests.test.ts，
// 它扫 sources/*/mod.json，并用构建夹具证明每条都会报。
//
// 一个内置音源目录要满足：
//   - mod.json 是合法的清单（electron/modSystem/manifest.cjs 的 validateManifest），folium 2，声明了 sources；
//   - 模组 id 在受信表里（electron/modSystem/builtinSources.cjs），目录名是那一行的一个短音源 id；
//   - sources[] 的 id 正是那一行的短 id，一个不多一个不少（内置副本按 id 认领短 id，sourceOwnership.cjs）；
//   - 每个音源的名字（sources[].name）给了四种语言，或者是一个字符串；
//   - 有 locales/ 时 en、zh-CN、in、vi 四份都在，zh-TW.json 不手写（构建生成）；
//   - 没有 folium.sig.json（内置副本不签名）。

const requireHere = createRequire(import.meta.url);
const { validateManifest } = requireHere('../../electron/modSystem/manifest.cjs');
const { BUILTIN_SOURCE_TABLE } = requireHere('../../electron/modSystem/builtinSources.cjs');

export const SOURCE_LANGUAGES = Object.freeze(['zh-CN', 'en', 'in', 'vi']);

/** 一个内置音源目录的问题（空的就是没问题）。`table` 给测试换受信表用。 */
export const checkBuiltinSourceDir = (dir, { table = BUILTIN_SOURCE_TABLE } = {}) => {
    const problems = [];
    const dirName = path.basename(dir);
    const manifestFile = path.join(dir, 'mod.json');
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    } catch (error) {
        return [`mod.json 读不出来：${error.message}`];
    }
    const validation = validateManifest(raw);
    if (!validation.ok) problems.push(...validation.errors.map((error) => `mod.json：${error}`));
    if (raw.folium !== 2) problems.push('mod.json：folium 要是 2');
    const declared = Array.isArray(raw.sources) ? raw.sources : [];
    if (declared.length === 0) problems.push('mod.json：sources 要列出这个模组提供的音源');

    const row = typeof raw.id === 'string' && Object.hasOwn(table, raw.id) ? table[raw.id] : null;
    if (!row) {
        problems.push(`模组 id "${raw.id}" 不在受信表里（electron/modSystem/builtinSources.cjs）：内置音源的短 id 只由受信表认领`);
    } else {
        if (!row.sources.includes(dirName)) problems.push(`目录名 "${dirName}" 不是受信表里 ${raw.id} 那一行的短音源 id（${row.sources.join('、')}）`);
        const ids = declared.map((entry) => entry?.id);
        const missing = row.sources.filter((id) => !ids.includes(id));
        const extra = ids.filter((id) => !row.sources.includes(id));
        if (missing.length > 0) problems.push(`sources 少了受信表里的 ${missing.join('、')}`);
        if (extra.length > 0) problems.push(`sources 多了受信表里没有的 ${extra.join('、')}`);
    }
    for (const entry of declared) {
        const name = entry?.name;
        if (typeof name === 'string') continue;
        const lacking = SOURCE_LANGUAGES.filter((language) => typeof name?.[language] !== 'string' || !name[language]);
        if (lacking.length > 0) problems.push(`音源 ${entry?.id} 的名字缺 ${lacking.join('、')}`);
    }

    const locales = path.join(dir, 'locales');
    if (fs.existsSync(locales)) {
        const files = fs.readdirSync(locales);
        const lacking = SOURCE_LANGUAGES.filter((language) => !files.includes(`${language}.json`));
        if (lacking.length > 0) problems.push(`locales/ 缺 ${lacking.map((language) => `${language}.json`).join('、')}`);
        if (files.includes('zh-TW.json')) problems.push('locales/zh-TW.json 由构建从 zh-CN.json 生成，不手写');
    }
    if (fs.existsSync(path.join(dir, 'folium.sig.json'))) problems.push('内置副本不带签名文件（folium.sig.json）');
    return problems;
};

/**
 * `root` 下每个子目录的问题：目录名 → 问题。没有问题的不列。sources/ 下的子目录都该是音源目录，没有 mod.json 的
 * 也报（搬到一半的目录不会被构建，也不会被测试夹具注册，悄悄少一家）。
 */
export const checkBuiltinSources = (root, options) => {
    if (!fs.existsSync(root)) return new Map();
    const found = new Map();
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const dir = path.join(root, entry.name);
        if (!fs.existsSync(path.join(dir, 'mod.json'))) {
            found.set(entry.name, ['没有 mod.json']);
            continue;
        }
        const problems = checkBuiltinSourceDir(dir, options);
        if (problems.length > 0) found.set(entry.name, problems);
    }
    return found;
};
