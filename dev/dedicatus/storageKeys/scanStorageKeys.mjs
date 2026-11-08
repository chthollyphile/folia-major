import fs from 'node:fs';
import path from 'node:path';
// dev/dedicatus/storageKeys/scanStorageKeys.mjs
// 读出仓库里持久化的键（D507）：渲染进程的 localStorage / sessionStorage（含 `storage()?.getItem` 这类本地包装）、
// storagePrimitives、providerStorage、useOneTimeHint，主进程 electron-store 的 store.get / set / delete / has。
// 按文本扫描：键是字符串字面量，或者 `const NAME = '字面量'` 定义的常量。常量先认本文件的定义，
// 再认从相对路径导入的那个文件的定义，最后才认全仓唯一的同名定义（同名不同值的常量各文件都有：SESSION_KEY、STORAGE_KEY）。
// 模板字符串、`NAME + 变量` 只记到变化部分之前的前缀，写成 `前缀*`。
// 认不出的（变量拼的键、函数返回的键）不记。src/stores 和 tuning 经 helper 拼出来的键由 D501（storeContract 快照）管。

const SOURCE = /\.(ts|tsx|js|mjs|cjs)$/;
const SKIP = /(^|\/)(node_modules|dist|release)\/|\.test\.|\.spec\.|\.d\.ts$/;
const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.js', '.mjs', '.cjs', '/index.ts', '/index.tsx', '/index.js'];

const listFiles = (root, dir) => {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) return [];
    return fs.readdirSync(full, { withFileTypes: true }).flatMap(entry => {
        const relative = path.posix.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : listFiles(root, relative);
        return SOURCE.test(entry.name) && !SKIP.test(relative) ? [relative] : [];
    });
};

/** 本文件 `const NAME = '字面量'` 的定义。 */
const ownConstants = text => {
    const values = new Map();
    for (const match of text.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*(['"])([^'"]+)\2/g)) {
        if (!values.has(match[1])) values.set(match[1], match[3]);
    }
    return values;
};

/** 本文件从相对路径导入的名字 → { from: 那个文件, name: 它在那边的名字 }（ES 的具名导入和 CJS 的解构 require）。 */
const importedNames = (root, file, text) => {
    const names = new Map();
    const add = (list, specifier) => {
        if (!specifier.startsWith('.')) return;
        const base = path.posix.join(path.posix.dirname(file), specifier);
        const from = RESOLVE_SUFFIXES.map(suffix => base + suffix).find(candidate => fs.existsSync(path.join(root, candidate)) && fs.statSync(path.join(root, candidate)).isFile());
        if (!from) return;
        for (const part of list.split(',')) {
            const [original, local = original] = part.replace(/\btype\s+/, '').split(/\s+as\s+|\s*:\s*/).map(name => name.trim());
            if (original) names.set(local, { from, name: original });
        }
    };
    for (const match of text.matchAll(/\bimport\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) add(match[1], match[2]);
    for (const match of text.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g)) add(match[1], match[2]);
    return names;
};

/**
 * 常量的解析器：本文件 → 导入来源 → 全仓唯一。
 * @returns {(file: string, name: string) => string | null}
 */
const constantResolver = (root, files) => {
    const texts = new Map(files.map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
    const own = new Map([...texts].map(([file, text]) => [file, ownConstants(text)]));
    const imports = new Map([...texts].map(([file, text]) => [file, importedNames(root, file, text)]));
    const unique = new Map();
    const conflicted = new Set();
    for (const values of own.values()) {
        for (const [name, value] of values) {
            if (unique.has(name) && unique.get(name) !== value) conflicted.add(name);
            unique.set(name, value);
        }
    }
    for (const name of conflicted) unique.delete(name);
    const resolve = (file, name, seen = new Set()) => {
        if (seen.has(`${file}#${name}`)) return null;
        seen.add(`${file}#${name}`);
        const local = own.get(file)?.get(name);
        if (local !== undefined) return local;
        const imported = imports.get(file)?.get(name);
        if (imported && own.has(imported.from)) return resolve(imported.from, imported.name, seen);
        return unique.get(name) ?? null;
    };
    return { texts, resolve };
};

/** 一个键参数的写法 → 键（或 `前缀*`）；认不出返回 null。 */
const keyOf = (raw, file, resolve) => {
    const text = raw.trim();
    const literal = /^(['"])([^'"]*)\1$/.exec(text);
    if (literal) return literal[2];
    const template = /^`([^`$]*)(\$\{)?/.exec(text);
    if (template) return template[2] ? `${template[1]}*` : template[1];
    if (/^[A-Za-z_$][\w$]*$/.test(text)) return resolve(file, text);
    const prefixed = /^([A-Za-z_$][\w$]*)\s*\+/.exec(text);
    if (prefixed) {
        const prefix = resolve(file, prefixed[1]);
        return prefix === null ? null : `${prefix}*`;
    }
    return null;
};

const RENDERER_CALLS = [
    // 键在第一个参数。`storage()?.getItem`、`storage.getItem` 是各文件对 localStorage 的本地包装。
    /\b(?:localStorage|sessionStorage|storage(?:\(\))?)\??\.(?:getItem|setItem|removeItem)\(\s*([^,)]+)/g,
    /\b(?:getStoredBoolean|setStoredBoolean|getStoredString|setStoredString|removeStoredKey|useOneTimeHint)\(\s*([^,)]+)/g,
];
/** providerStorage：键是“平台:键”。 */
const PROVIDER_CALL = /\b(?:readProviderSessionValue|writeProviderSessionValue|removeProviderSessionValue)\(\s*([^,)]+),\s*([^,)]+)/g;
const MAIN_CALL = /\bstore\.(?:get|set|delete|has)\(\s*([^,)]+)/g;
/** 键的读写本身就在这些文件里（参数是变量），不当成键的出处。 */
const HELPER_FILES = new Set(['src/stores/storagePrimitives.ts', 'src/services/onlineMusic/providerStorage.ts', 'src/hooks/useOneTimeHint.ts']);

/**
 * @returns {string[]} 排好序的键，写成 `web:键`、`provider:平台:键`、`main:键`
 */
export function scanStorageKeys(root) {
    const rendererFiles = ['src', 'shared'].flatMap(dir => listFiles(root, dir));
    const mainFiles = listFiles(root, 'electron');
    const { texts, resolve } = constantResolver(root, [...rendererFiles, ...mainFiles]);
    const keys = new Set();
    for (const file of rendererFiles) {
        if (HELPER_FILES.has(file)) continue;
        const text = texts.get(file);
        for (const pattern of RENDERER_CALLS) {
            for (const match of text.matchAll(pattern)) {
                const key = keyOf(match[1], file, resolve);
                if (key) keys.add(`web:${key}`);
            }
        }
        for (const match of text.matchAll(PROVIDER_CALL)) {
            const provider = keyOf(match[1], file, resolve);
            const key = keyOf(match[2], file, resolve);
            if (provider && key) keys.add(`provider:${provider}:${key}`);
        }
    }
    for (const file of mainFiles) {
        for (const match of texts.get(file).matchAll(MAIN_CALL)) {
            const key = keyOf(match[1], file, resolve);
            if (key) keys.add(`main:${key}`);
        }
    }
    return [...keys].sort();
}

/** store 里常见的本地包装：`readStored(KEY)`、`writeStored(KEY, …)`、`readStoredFlag(KEY)`。 */
const STORE_HELPER_CALL = /\b(?:readStored\w*|writeStored\w*)\(\s*([^,)]+)/g;

/**
 * 几个文件各自读写的 localStorage 键（D511 用：外观 store 的持久化字段）。除了 scanStorageKeys 认的写法，
 * 还认 store 文件里的本地包装（readStored / writeStored），以及文件里定义的 `const …KEY… = '字面量'`。
 * @returns {Map<string, string[]>} 文件 → 排好序的键
 */
export function storageKeysInFiles(root, files) {
    const all = [...['src', 'shared'].flatMap(dir => listFiles(root, dir)), ...listFiles(root, 'electron')];
    const { texts, resolve } = constantResolver(root, all);
    return new Map(files.map(file => {
        const text = texts.get(file) ?? '';
        const keys = new Set();
        for (const pattern of [...RENDERER_CALLS, STORE_HELPER_CALL]) {
            for (const match of text.matchAll(pattern)) {
                const key = keyOf(match[1], file, resolve);
                if (key) keys.add(key);
            }
        }
        for (const match of text.matchAll(/\bconst\s+[A-Z0-9_]*KEY[A-Z0-9_]*\s*=\s*(['"])([^'"]+)\1/g)) keys.add(match[2]);
        return [file, [...keys].sort()];
    }));
}
