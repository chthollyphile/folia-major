import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseAst } from 'vite';
import { toTaiwanTraditional } from '../../../dev/i18n/localeTextRewrite.mjs';

// test/unit/i18n/traditionalMainProcessText.test.ts
// 主进程不经 Vite 打包，读不到构建期生成的繁中 locale，原生对话框、托盘和登录回跳页的文案表
// 只能各自手写一份 zh-TW。这里核对每张表的 zh-TW 与 zh-CN 键一致、每条都等于
// toTaiwanTraditional(zh-CN 的对应条目)：改了简体忘了改繁中，或繁中被手改得与界面用词不一致，都会失败。
//
// main.cjs 是 Electron 入口，加载不了；这几张表都是只含字面量和箭头函数的对象，
// 所以统一从源码里按变量名取出那段对象字面量求值，不去 require 整个模块。

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const TABLES = [
    ['electron/main.cjs', 'mainLocale'],
    ['electron/modSystem/approval.cjs', 'TRUST_DIALOG_LOCALE'],
    ['electron/modSystem/safeStart.cjs', 'SAFE_START_LOCALE'],
    ['electron/spotify/signIn.cjs', 'PAGE_TEXT'],
] as const;

type Entry = string | ((...args: string[]) => string);
type LocaleTable = Record<string, Record<string, Entry>>;

type AstNode = { type: string; start: number; end: number; [key: string]: unknown };

/** 在一个文件里找 `const <name> = ...` 的初始值节点。 */
const findInit = (node: unknown, name: string): AstNode | null => {
    if (!node || typeof node !== 'object') {
        return null;
    }
    if (Array.isArray(node)) {
        for (const child of node) {
            const found = findInit(child, name);
            if (found) return found;
        }
        return null;
    }
    const current = node as AstNode;
    if (current.type === 'VariableDeclarator' && (current.id as { name?: string })?.name === name) {
        return current.init as AstNode;
    }
    for (const [key, child] of Object.entries(current)) {
        if (key === 'type' || key === 'loc' || key === 'range' || key === 'parent') continue;
        const found = findInit(child, name);
        if (found) return found;
    }
    return null;
};

const readTable = (file: string, name: string): LocaleTable => {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const init = findInit(parseAst(source, { lang: 'js' }), name);
    if (!init) {
        throw new Error(`${file} 里找不到 ${name}`);
    }
    // 只含字面量和只用参数的箭头函数（signIn.cjs 外面包了一层 Object.freeze），求值不会碰到别的绑定。
    return new Function(`return (${source.slice(init.start, init.end)});`)() as LocaleTable;
};

/** 函数条目用纯 ASCII 的实参调用再比，实参不会被转换，比出来的只是文案本身。 */
const render = (entry: Entry): string => (
    typeof entry === 'function' ? entry(...Array.from({ length: entry.length }, (_, index) => `arg${index}`)) : entry
);

describe.each(TABLES)('%s %s', (file, name) => {
    const table = readTable(file, name);

    it('有 zh-TW，并且和 zh-CN 是同一组键', () => {
        expect(table['zh-TW'], `${name} 缺 zh-TW`).toBeDefined();
        expect(Object.keys(table['zh-TW']).sort()).toEqual(Object.keys(table['zh-CN']).sort());
    });

    it('每条 zh-TW 都等于 zh-CN 对应条目的转换结果', () => {
        const zhCN = table['zh-CN'];
        const zhTW = table['zh-TW'] ?? {};
        const drifted = Object.keys(zhCN)
            .map(key => ({ key, expected: toTaiwanTraditional(render(zhCN[key])), actual: zhTW[key] === undefined ? undefined : render(zhTW[key]) }))
            .filter(({ expected, actual }) => expected !== actual);
        expect(drifted, `${file} 的 ${name}['zh-TW'] 要按 toTaiwanTraditional(zh-CN) 改写`).toEqual([]);
    });
});
