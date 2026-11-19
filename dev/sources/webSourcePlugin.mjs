import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toTraditionalLocale } from './locales.mjs';

// dev/sources/webSourcePlugin.mjs
// 网页版用的音源模组「包」（Folium 2.0 方案 §8）：网页构建不加载模组，src/services/onlineMusic/web/<id>.ts 拿 sources/<id>/core
// 的 createSource 自己注册（web/foliumWebSource.ts），它还要那个模组的清单和语言表。这个插件以 Vite 虚拟模块
// `virtual:folia-source/<id>` 提供它们：`{ manifest, locales }`，manifest 是 sources/<id>/mod.json，locales 是 locales/ 下的每份
// 语言表，外加由 zh-CN 生成的 zh-TW（和 dev/sources/build.mjs 给桌面产物生成的是同一条转换，locales.mjs）。
// 不签入生成的文件，改了 mod.json 或语言表不用再跑脚本。vite.config.ts、vitest.config.ts、dev/perf/vite.config.ts 各挂一次。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCES_DIR = path.resolve(HERE, '../../sources');

export const WEB_SOURCE_MODULE_PREFIX = 'virtual:folia-source/';
const RESOLVED_PREFIX = `\0${WEB_SOURCE_MODULE_PREFIX}`;

// 目录名就是受信表里的短 id：只认字母数字（不让 `../` 之类走出 sources/）。
const SOURCE_ID = /^[a-zA-Z][a-zA-Z0-9]*$/;

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** 一个音源目录的 `{ manifest, locales }`；目录或 mod.json 不在时报错（写错了 id 是构建错误）。 */
export const readWebSourcePackage = (id, root = SOURCES_DIR) => {
    if (!SOURCE_ID.test(id)) throw new Error(`[folia-source] ${id} 不是音源目录名`);
    const dir = path.join(root, id);
    const manifestFile = path.join(dir, 'mod.json');
    if (!fs.existsSync(manifestFile)) throw new Error(`[folia-source] sources/${id}/mod.json 不存在`);
    const manifest = readJson(manifestFile);
    const localeDir = path.join(dir, typeof manifest.locales === 'string' ? manifest.locales : 'locales');
    const locales = {};
    if (fs.existsSync(localeDir)) {
        for (const file of fs.readdirSync(localeDir).filter((name) => name.endsWith('.json')).sort()) {
            const language = file.slice(0, -'.json'.length);
            // zh-TW 由 zh-CN 生成：手写的一份不认（和构建一样）。
            if (language === 'zh-TW') continue;
            locales[language] = readJson(path.join(localeDir, file));
        }
        if (locales['zh-CN']) locales['zh-TW'] = toTraditionalLocale(locales['zh-CN']);
    }
    return { manifest, locales };
};

export const webSourcePlugin = ({ root = SOURCES_DIR } = {}) => ({
    name: 'folia-web-source',
    enforce: 'pre',
    resolveId(id) {
        return id.startsWith(WEB_SOURCE_MODULE_PREFIX) ? `\0${id}` : null;
    },
    load(id) {
        if (!id.startsWith(RESOLVED_PREFIX)) return null;
        const source = readWebSourcePackage(id.slice(RESOLVED_PREFIX.length), root);
        return `export default ${JSON.stringify(source)};\n`;
    },
    // 开发版里改了某个音源的 mod.json 或语言表：它的虚拟模块失效，页面整页重载（sources/ 在项目根下，Vite 本来就盯着）。
    configureServer(server) {
        server.watcher.on('change', (changed) => {
            const relative = path.relative(root, changed).split(path.sep);
            if (relative.length < 2 || relative[0].startsWith('..')) return;
            if (relative[1] !== 'mod.json' && !(relative.length === 3 && relative[2].endsWith('.json'))) return;
            const module = server.moduleGraph.getModuleById(`${RESOLVED_PREFIX}${relative[0]}`);
            if (!module) return;
            server.moduleGraph.invalidateModule(module);
            server.ws.send({ type: 'full-reload' });
        });
    },
});

export default webSourcePlugin;
