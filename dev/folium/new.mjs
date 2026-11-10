#!/usr/bin/env node
// dev/folium/new.mjs
// `npm run folium:new <folder>`: writes a starting mod. `mod.json` is the
// smallest one the app accepts; `client.mjs` registers one lyric style, uses the
// context's helpers (so it has nothing to undo by hand) and points at
// mods/folium.d.ts for editor hints. With `--main` it also writes `index.cjs`, a
// main entry that answers an rpc call, and `client.mjs` gets a command that
// makes that call. What it writes passes `npm run folium:check`, and the command
// says so by running that check.
//
//   node dev/folium/new.mjs <folder> [--main]     a path, or a name: the mod then goes to mods/<name>
//   The folder's name becomes the mod's id (lower-case letters, digits and "-").
//   An existing folder is never written into.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFoliumMod, resolveModFolder } from './check.mjs';
import { readFoliumShared } from './api-docs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES_FILE = path.join(ROOT, 'mods', 'folium.d.ts');
const CHECK_FILE = path.join(ROOT, 'dev', 'folium', 'check.mjs');

const USAGE = `usage: npm run folium:new <folder>          (add -- --main for a main entry too)
       node dev/folium/new.mjs <folder> [--main]
  <folder>  a path, or a name: the mod then goes to mods/<name>. The folder's name becomes the mod's id.
  --main    also write index.cjs, a main entry that runs in Node, and a command in client.mjs that calls it.
  --help    show this.`;

const manifestOf = (id, main) => `${JSON.stringify({
    folium: readFoliumShared().version.major,
    id,
    name: id,
    version: '0.1.0',
    description: '',
    ...(main ? { main: 'index.cjs' } : {}),
    client: 'client.mjs',
}, null, 2)}\n`;

/* What `--main` adds to activate(): a command that hands its work to the main entry. */
const commandOf = (id) => `

  // 一条命令，出现在模组面板和命令面板里。run 把活交给 main 入口（index.cjs），
  // 它的答复显示在命令的结果里。
  folium.registries.commands.register({
    id: 'hello',
    label: { 'zh-CN': '${id}：问 main 入口', en: '${id}: ask the main entry' },
    run: () => folium.rpc.call('hello'),
  });`;

/* `types` is how the client entry reaches the type file from where it is, e.g. "../folium". */
const clientOf = (id, types, main) => `// ${id}/client.mjs
// 由 \`npm run folium:new\` 生成的起点：登记一个歌词动画，居中显示当前这一行。
// 它用的是宿主给的现成函数（ctx.onChange），所以没有要自己取消的东西：
// 这个歌词动画被换掉、模组被停掉时，宿主替它停掉监听、拿走容器。
// 下面的 @typedef 只给编辑器看（补全和每个成员的说明），运行时不起作用。

/** @typedef {import('${types}').FoliumClientApi} Folium */
/** @typedef {import('${types}').FoliumStageContext} StageContext */

/** @param {Folium} folium */
export default function activate(folium) {
  folium.registries.visualizers.register({
    id: 'main',
    label: { 'zh-CN': '${id}', en: '${id}' },
    mount: (container, ctx) => mount(folium, container, ctx),
  });${main ? commandOf(id) : ''}
}

/**
 * 挂载一次。之后换行、暂停、换主题、改显示设置，宿主都会调用 draw，不会重新挂载。
 * @param {Folium} folium
 * @param {HTMLElement} container
 * @param {StageContext} ctx
 */
function mount(folium, container, ctx) {
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;padding:0 8%;text-align:center;line-height:1.3;';
  container.appendChild(box);

  const draw = () => {
    const theme = ctx.getTheme();
    const index = ctx.staticMode ? ctx.staticLineIndex : ctx.getLineIndex();
    const line = index !== null && index >= 0 ? ctx.lines[index] : null;
    box.textContent = line ? line.fullText : '';
    box.style.color = theme.primaryColor;
    box.style.fontFamily = folium.theme.resolveFontStack(theme);
    box.style.fontWeight = String(folium.theme.resolveFontWeight(theme, 600));
    box.style.fontSize = \`\${48 * ctx.getDisplay().lyricsFontScale}px\`;
  };

  draw();
  ctx.onChange(draw);
}
`;

const mainOf = (id, types) => `// ${id}/index.cjs
// 由 \`npm run folium:new -- --main\` 生成：模组的 main 入口，在 Folia 的主进程里运行（Node）。
// 它答 client.mjs 里那条命令的 folium.rpc.call('hello')。要在模组停掉时收拾的东西
// （定时器、子进程、监听），交给 api.onDispose。
// 下面的 @typedef 只给编辑器看，运行时不起作用。

'use strict';

/** @typedef {import('${types}').FoliumMainApi} MainApi */

/** @param {MainApi} api */
module.exports = function activate(api) {
  api.rpc.handle('hello', () => \`\${api.manifest.name} 的 main 入口在 Node \${process.version} 里运行\`);
};
`;

const isInside = (parent, child) => {
    const relative = path.relative(parent, child);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

/**
 * How an entry in `directory` reaches the type file: an import path without the extension. Inside
 * this repository that is a path to mods/folium.d.ts. Outside it, the entry expects a copy next to
 * the mod's folder (`copyTo`), so that the path stays right wherever the repository is.
 */
export const typesImportFor = (directory) => {
    if (!isInside(ROOT, directory)) {
        return { path: '../folium', copyTo: path.join(path.dirname(directory), 'folium.d.ts') };
    }
    const asImport = path.relative(directory, TYPES_FILE).replace(/\\/g, '/').replace(/\.d\.ts$/, '');
    return { path: asImport.startsWith('.') ? asImport : `./${asImport}`, copyTo: null };
};

/** The command that checks the mod again: the npm script for a folder under mods/, node elsewhere. */
export const checkCommandFor = (directory) => {
    if (path.dirname(directory) === path.join(ROOT, 'mods')) {
        return `npm run folium:check ${path.basename(directory)}`;
    }
    const quote = (value) => (/\s/.test(value) ? `"${value}"` : value);
    const script = isInside(process.cwd(), CHECK_FILE) ? path.relative(process.cwd(), CHECK_FILE) : CHECK_FILE;
    return `node ${quote(script.replace(/\\/g, '/'))} ${quote(directory)}`;
};

/**
 * Writes the starting mod into `directory`, which must not exist yet; with `main`, a main entry
 * too. Outside this repository it also copies the type file next to the mod's folder, when none is
 * there. Returns what the check says about the mod, and the files written. Throws when the
 * folder's name cannot be a mod id or the folder is there.
 */
export const createFoliumMod = (directory, { main = false } = {}) => {
    const id = path.basename(directory);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
        throw new Error(`"${id}" cannot be a mod id: use lower-case letters, digits and "-", starting with a letter or a digit`);
    }
    if (fs.existsSync(directory)) {
        throw new Error(`${directory} is already there: nothing was written`);
    }
    const types = typesImportFor(directory);
    const files = [
        ['mod.json', manifestOf(id, main)],
        ['client.mjs', clientOf(id, types.path, main)],
        ...(main ? [['index.cjs', mainOf(id, types.path)]] : []),
    ];
    fs.mkdirSync(directory, { recursive: true });
    const written = files.map(([name, text]) => {
        fs.writeFileSync(path.join(directory, name), text);
        return path.join(directory, name);
    });
    if (types.copyTo && !fs.existsSync(types.copyTo)) {
        fs.copyFileSync(TYPES_FILE, types.copyTo);
        written.push(types.copyTo);
    }
    return { ...checkFoliumMod(directory), written };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        console.log(USAGE);
        process.exit(0);
    }
    const unknown = args.filter((arg) => arg.startsWith('-') && arg !== '--main');
    const given = args.filter((arg) => !arg.startsWith('-'));
    if (unknown.length > 0 || given.length !== 1) {
        console.error(unknown.length > 0 ? `unknown option ${unknown.join(', ')}` : 'name one folder');
        console.error(USAGE);
        process.exit(2);
    }
    const directory = resolveModFolder(given[0]);
    try {
        const { ok, problems, written } = createFoliumMod(directory, { main: args.includes('--main') });
        written.forEach((file) => console.log(`wrote ${file}`));
        if (!ok) {
            problems.forEach((problem) => console.error(`  problem: ${problem}`));
            process.exit(1);
        }
        const copy = typesImportFor(directory).copyTo;
        if (copy && !written.includes(copy)) {
            console.log(`${copy} was already there and is kept: copy ${TYPES_FILE} over it when Folia's types change.`);
        }
        console.log(`The check finds no problem in it. To check it again after a change: ${checkCommandFor(directory)}`);
        console.log('Next: start the app (npm run dev:electron), open Settings > Mods, press Reload, enable the mod,');
        console.log('then choose it under the lyric styles. docs/folium/quickstart.md has the steps.');
        if (args.includes('--main')) {
            console.log('Its command is in the mod\'s row in Settings > Mods and in the command palette.');
        }
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}
