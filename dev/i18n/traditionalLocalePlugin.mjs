import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'vite';
import { toTaiwanTraditional } from './localeTextRewrite.mjs';

// dev/i18n/traditionalLocalePlugin.mjs
// 构建期从 src/i18n/locales/zh-CN.ts 生成繁体中文（台湾惯用词）文案，以 Vite 虚拟模块
// virtual:folia-locale-zh-TW 提供，不签入仓库。做法同 dev/pinyin/commandPinyinPlugin.mjs。
//
// 只换 zh-CN 里每一个值位置的字符串字面量，键和结构原样保留，所以繁中与 zh-CN 的键集合、
// 顺序天然一致，改 zh-CN 之后不需要再跑任何脚本。怎么转见 localeTextRewrite.mjs 和
// traditionalTerms.mjs；opencc-js 只在 devDependencies 里，运行时不带转换表。
//
// 主进程（electron/*.cjs）不经 Vite 打包，那几张原生对话框文案表里的 zh-TW 仍是手写的，
// 由 test/unit/i18n/traditionalMainProcessText.test.ts 核对它们等于这里的转换结果。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

export const VIRTUAL_MODULE_ID = 'virtual:folia-locale-zh-TW';
const RESOLVED_VIRTUAL_MODULE_ID = `\0${VIRTUAL_MODULE_ID}`;

const ZH_LOCALE_PATH = path.join(ROOT, 'src/i18n/locales/zh-CN.ts');

/** `export default { ... } as const` 里的那个对象字面量：类型断言和括号剥掉。 */
const findExportedObject = (program) => {
    for (const statement of program.body) {
        if (statement.type !== 'ExportDefaultDeclaration') {
            continue;
        }
        let node = statement.declaration;
        while (node && (node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression' || node.type === 'ParenthesizedExpression')) {
            node = node.expression;
        }
        if (node?.type === 'ObjectExpression') {
            return node;
        }
    }
    return null;
};

/**
 * 按源码顺序收集**值位置**的字符串字面量。键也是 Literal 节点，靠 Property 分支只下钻 value 跳过。
 * 模板字符串转不了也不该出现在 locale 里：遇到就报错，免得某条文案静默留成简体。
 */
const collectValueLiterals = (node, sink) => {
    if (!node || typeof node !== 'object') {
        return;
    }
    if (Array.isArray(node)) {
        node.forEach(child => collectValueLiterals(child, sink));
        return;
    }
    if (typeof node.type !== 'string') {
        return;
    }
    if (node.type === 'Property') {
        collectValueLiterals(node.value, sink);
        return;
    }
    if (node.type === 'Literal' && typeof node.value === 'string') {
        sink.push(node);
        return;
    }
    if (node.type === 'TemplateLiteral') {
        throw new Error(
            '[folia-locale-zh-TW] src/i18n/locales/zh-CN.ts 里出现了模板字符串，繁中只转换普通字符串字面量；'
            + '请改成普通字符串，插值用 {{name}}。',
        );
    }
    for (const key of Object.keys(node)) {
        if (key === 'type' || key === 'loc' || key === 'range' || key === 'parent') {
            continue;
        }
        collectValueLiterals(node[key], sink);
    }
};

/** 繁中 locale 模块的源码（JS），每条文案是 zh-CN 对应值的 toTaiwanTraditional。 */
export const renderTraditionalLocale = () => {
    const source = fs.readFileSync(ZH_LOCALE_PATH, 'utf8');
    const object = findExportedObject(parseAst(source, { lang: 'ts' }));
    if (!object) {
        throw new Error('[folia-locale-zh-TW] 在 src/i18n/locales/zh-CN.ts 里找不到 export default 的对象字面量。');
    }
    const literals = [];
    collectValueLiterals(object, literals);
    literals.sort((a, b) => a.start - b.start);

    // 一次拼出整段：逐条 slice 替换会把 300KB 的源码复制几千遍（约 0.4 秒），这样不到 1 毫秒。
    const chunks = [];
    let cursor = object.start;
    for (const literal of literals) {
        chunks.push(source.slice(cursor, literal.start), JSON.stringify(toTaiwanTraditional(literal.value)));
        cursor = literal.end;
    }
    chunks.push(source.slice(cursor, object.end));

    return [
        '// 由 dev/i18n/traditionalLocalePlugin.mjs 在构建期从 src/i18n/locales/zh-CN.ts 生成，不签入仓库，不要手改。',
        `export default ${chunks.join('')};`,
        '',
    ].join('\n');
};

/*
 * zh-CN.ts 变了就让虚拟模块失效，否则 dev 下改了简体文案，繁中还是旧的。
 * 改 traditionalTerms.mjs 要重启 dev server：它在插件加载时就被导入了。
 */
export const traditionalLocalePlugin = () => ({
    name: 'folia-locale-zh-TW',
    enforce: 'pre',
    resolveId(id) {
        return id === VIRTUAL_MODULE_ID ? RESOLVED_VIRTUAL_MODULE_ID : null;
    },
    load(id) {
        return id === RESOLVED_VIRTUAL_MODULE_ID ? renderTraditionalLocale() : null;
    },
    configureServer(server) {
        server.watcher.add(ZH_LOCALE_PATH);
        server.watcher.on('change', (changedPath) => {
            if (changedPath !== ZH_LOCALE_PATH) {
                return;
            }
            const virtualModule = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_MODULE_ID);
            if (virtualModule) {
                server.moduleGraph.invalidateModule(virtualModule);
                server.ws.send({ type: 'full-reload' });
            }
        });
    },
});

export default traditionalLocalePlugin;
