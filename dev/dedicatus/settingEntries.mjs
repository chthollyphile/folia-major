import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// dev/dedicatus/settingEntries.mjs
// D514–D516：设置的入口，也就是界面、命令面板等处在哪些文件里切换一个设置。登记表是同目录的 settingEntries.json。
// 起因是 895471e85：Lattice「切歌时自动聚焦」的开关从工具面板拿掉了，混在一个改了 1999 个文件的提交里，提交说明没提，
// 测试也跟着改成“面板里没有它”，没有任何检查报出来（#1363 加了回去）。
//
// - entries：「store 文件名.设置函数」→ 调用它的文件。扫描规则见 scanSettingEntries；表由 `npm run dedicatus:setting-entries`
//   按现状重写（removed 保留），检查在 test/unit/dedicatus/contracts/settingEntries.test.ts（D514：表与现状一致）。
// - 比的是「位置」不是文件（placeOf）：设置页、命令面板、同步与导入，以及其余各个功能目录（app/lattice、panelTab……）。
//   同一位置里换了文件（拆文件、重组设置页）不算拿掉；一个设置在某个位置一处都不剩了，才算拿掉了一个入口。
//   拿 895471e85 回放：按文件比报 213 条（几乎全是设置页重组），按位置比只剩真正少了的几处，自动聚焦那一条在里面。
// - removed：拿掉的入口 { entry, place, why, date }。拿掉一个入口是用户可见的变化，必须是用户的决定：why 写明谁定的、为什么。
//   和比较基点比，少了的入口没有 removed 记录，`npm run dedicatus` 报 D515（checks/settingEntries.mjs）；
//   PR 里少了入口、PR 描述没写到那个设置函数，CI 报 D516（.github/workflows/pr-setting-entries.yml）。
//   入口加回来时删掉对应的 removed 记录（契约测试会提醒）。
// 初始名单是 2026-11-27 的现状。

export const REGISTRY_FILE = 'dev/dedicatus/settingEntries.json';

/** 设置 store：文件名是 use…Settings…Store.ts 的，加上下面几个名字里不带 Settings 的。 */
const SETTING_STORE_NAME = /^use\w*Settings\w*Store\.ts$/;
export const EXTRA_SETTING_STORES = [
    // bravais 资料库墙的外观偏好
    'src/stores/useLibraryWallLookStore.ts',
    // 场景的声线追踪开关
    'src/components/scenes/settings/useSoundTracingStore.ts',
    // 推荐偏好
    'src/components/recommendationPreferences/useRecommendationPreferencesStore.ts',
];
/** 名字带 Settings、但不是设置的 store。 */
export const EXCLUDED_SETTING_STORES = [
    // 设置弹窗自己开没开、在哪一页
    'src/stores/useSettingsModalStore.ts',
];

/** 设置函数：store 状态类型里以这些动词开头的函数成员。 */
const SETTER_NAME = /^(handle(Toggle|Set|Reset)|set|toggle|reset)[A-Z]\w*$/;
const SOURCE = /\.(ts|tsx)$/;
const SKIP = /\.test\.|\.spec\.|\.d\.ts$/;

const listFiles = (root, dir) => {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) return [];
    return fs.readdirSync(full, { withFileTypes: true }).flatMap(entry => {
        const relative = path.posix.join(dir, entry.name);
        if (entry.isDirectory()) return listFiles(root, relative);
        return SOURCE.test(entry.name) && !SKIP.test(relative) ? [relative] : [];
    });
};

/** 仓库里的设置 store（相对路径，排好序）。 */
export function findSettingStores(root) {
    const excluded = new Set(EXCLUDED_SETTING_STORES);
    const named = listFiles(root, 'src').filter(file => SETTING_STORE_NAME.test(path.posix.basename(file)));
    const extras = EXTRA_SETTING_STORES.filter(file => fs.existsSync(path.join(root, file)));
    return [...new Set([...named, ...extras])].filter(file => !excluded.has(file)).sort();
}

/** store 文件里声明的设置函数：`name: (` 形式的成员（类型里的签名和实现里的箭头函数都是这个样子）。 */
export function settersOf(text) {
    const names = new Set();
    for (const match of text.matchAll(/^\s+(\w+)\??\s*:\s*\(/gm)) {
        if (SETTER_NAME.test(match[1])) names.add(match[1]);
    }
    return [...names].sort();
}

/** 这个文件有没有导入那个 store 模块（静态 import、export from、动态 import()）。 */
const importsModule = (text, moduleName) => new RegExp(`(?:from\\s+|import\\s*\\(\\s*)['"][^'"]*/${moduleName}['"]`).test(text);

/**
 * 按现状读出每个设置函数的入口：src/ 里（测试和设置 store 自己除外）导入了这个 store、又用到这个函数名的文件。
 * 按文件记，不按行：同一个文件里有两处入口、拿掉一处，这里看不出来。
 * @returns {Record<string, string[]>} 「store 文件名.设置函数」→ 文件（都排好序）
 */
export function scanSettingEntries(root) {
    const stores = findSettingStores(root);
    const storeSet = new Set(stores);
    const files = listFiles(root, 'src').filter(file => !storeSet.has(file)).map(file => ({ file, text: fs.readFileSync(path.join(root, file), 'utf8') }));
    /** @type {Record<string, string[]>} */
    const entries = {};
    for (const store of stores) {
        const moduleName = path.posix.basename(store, '.ts');
        const importers = files.filter(({ text }) => importsModule(text, moduleName));
        for (const setter of settersOf(fs.readFileSync(path.join(root, store), 'utf8'))) {
            const word = new RegExp(`\\b${setter}\\b`);
            entries[`${moduleName}.${setter}`] = importers.filter(({ text }) => word.test(text)).map(({ file }) => file).sort();
        }
    }
    return Object.fromEntries(Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * 一个入口文件属于哪个位置：设置页（设置弹窗和它的各页，含存储页的配置导入导出）、命令面板、同步；其余按功能目录：
 * src/components/app/<功能>、src/components/<功能>、src/<目录>/<子目录>（src/mods/folium……），直接放在 src/<目录> 下的
 * 文件算 src/<目录>（src/hooks），src 根上的文件（App.tsx）就是它自己。
 */
export function placeOf(file) {
    if (/^src\/components\/modal\/(settings\/|SettingsModal\.tsx$)/.test(file)) return 'settings-page';
    if (/(^|\/)command-palette(-context)?\//.test(file)) return 'command-palette';
    if (file.startsWith('src/services/sync/')) return 'sync';
    const dirs = file.split('/').slice(0, -1);
    if (dirs.length <= 1) return file;
    const depth = dirs[1] === 'components' && dirs[2] === 'app' ? 4 : 3;
    return dirs.slice(0, depth).join('/');
}

/** @typedef {{ entry: string, place: string, why: string, date: string }} RemovedSettingEntry */
/** @typedef {{ entries: Record<string, string[]>, removed: RemovedSettingEntry[] }} SettingEntriesRegistry */

/** @returns {SettingEntriesRegistry} */
export function parseRegistry(text) {
    const parsed = JSON.parse(text);
    return { entries: parsed.entries ?? {}, removed: parsed.removed ?? [] };
}

export function readRegistry(root) {
    return parseRegistry(fs.readFileSync(path.join(root, REGISTRY_FILE), 'utf8'));
}

/**
 * 基点上有、现在没有的入口：一个设置函数还在，但在某个位置一处都不剩了。文件改了名的按新名字算。
 * @param {SettingEntriesRegistry} before
 * @param {SettingEntriesRegistry} after
 * @param {Map<string, string>} renameMap 旧路径 → 新路径
 * @returns {{ entry: string, place: string, files: string[] }[]} files 是基点上这个位置的文件
 */
export function lostEntries(before, after, renameMap = new Map()) {
    const lost = [];
    for (const [entry, files] of Object.entries(before.entries)) {
        // 整个设置函数没了（改名、并进生成的 tuning 动作、设置删掉）不在这里管：设置本身删掉时它的存储键也跟着删，D507 拦着。
        if (!Object.hasOwn(after.entries, entry)) continue;
        const now = new Set(after.entries[entry].map(placeOf));
        /** @type {Map<string, string[]>} */
        const was = new Map();
        for (const file of files) {
            const place = placeOf(renameMap.get(file) ?? file);
            was.set(place, [...(was.get(place) ?? []), file]);
        }
        for (const [place, placeFiles] of was) {
            if (!now.has(place)) lost.push({ entry, place, files: placeFiles });
        }
    }
    return lost;
}

/** 这条拿掉的入口在 removed 里有没有记录。 */
export const isRecorded = (registry, { entry, place }) => registry.removed.some(record => record.entry === entry && record.place === place);

const formatRegistry = registry => `${JSON.stringify(registry, null, 4)}\n`;

/** 按现状重写 entries，removed 原样保留。 */
export function writeRegistry(root) {
    const file = path.join(root, REGISTRY_FILE);
    const removed = fs.existsSync(file) ? readRegistry(root).removed : [];
    fs.writeFileSync(file, formatRegistry({ entries: scanSettingEntries(root), removed }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    writeRegistry(root);
    const { entries } = readRegistry(root);
    console.log(`[settingEntries] 写好了 ${REGISTRY_FILE}：${Object.keys(entries).length} 个设置函数，${Object.values(entries).flat().length} 处入口`);
}
