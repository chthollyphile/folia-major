// dev/mcp/ts-code-map/graph/specifiers.mjs

/**
 * 读出一个文件里 import / export 的模块说明符：静态 import（含 `import type` 和只为副作用的
 * `import 'x'`）、`export ... from` / `export type ... from`、动态 `import('x')`，
 * 以及类型位置的 `typeof import('x')`、`import('x').T`。
 *
 * 以前是逐行正则（`[^;\n]*?`），写成多行的 `import {\n  a,\n} from '...'` 整条进不了模块图，
 * 分层检查也就看不见经由它的依赖。现在先切词再按词读语句：换行只是空白，
 * 注释、字符串、模板串里长得像 import 的文字也不会再被当成依赖。
 *
 * 切词是自己写的，没用 TypeScript：codemap-sync workflow 不装依赖，生成器只能用 Node 内置模块；
 * 而且 TS 7 的 npm 包里 parser 在 Go 二进制那边，JS 端只有标着 unstable 的 scanner
 * （碰到 `#000` 这种 `#` 还会原地死循环）。import / export 的形状固定，切出词就够读了。
 */

/** 词的种类。模板串按 `${` 切段：OPEN 段后面跟表达式，CLOSE 段和完整的模板串一样收尾一个表达式。 */
const EOF = 0;
const NAME = 1; // 标识符和关键字
const STRING = 2;
const TEMPLATE = 3; // 没有 `${}` 的完整模板串
const TEMPLATE_OPEN = 4; // 以 `${` 结尾的一段
const TEMPLATE_CLOSE = 5; // `}` 之后、以反引号结尾的最后一段
const NUMBER = 6;
const REGEX = 7;
const PUNCT = 8;

/** 花括号栈里的两种开口：普通的 `{`，和模板串里的 `${`（它的 `}` 之后接着读模板）。 */
const BRACE = 0;
const SUBSTITUTION = 1;

/** 关键字里只有这些后面跟的是表达式；别的（`this`、`null`，以及常被当名字用的 `type`、`from`……）按名字算。 */
const KEYWORDS_BEFORE_EXPRESSION = new Set([
    'await', 'case', 'delete', 'do', 'else', 'in', 'instanceof', 'new', 'return', 'throw', 'typeof', 'void', 'yield',
]);

/** 收尾一个表达式的符号，后面的 `/` 是除号。 */
const PUNCT_ENDS_EXPRESSION = new Set([')', ']', '}', '++', '--']);

const JSX_FILE = /\.[jt]sx$/;

const isLineBreak = ch => ch === 10 || ch === 13 || ch === 0x2028 || ch === 0x2029;
const isSpace = ch => ch === 32 || (ch >= 9 && ch <= 13) || ch === 0xa0 || ch === 0xfeff || ch === 0x1680
    || (ch >= 0x2000 && ch <= 0x200a) || ch === 0x2028 || ch === 0x2029 || ch === 0x202f || ch === 0x205f
    || ch === 0x3000;
const isDigit = ch => ch >= 48 && ch <= 57;
/** 名字里的字符，放得很宽：ASCII 字母数字、`_`、`$`、转义用的 `\`，以及所有非 ASCII 字符（JSX 里的中文也就切成名字）。 */
const isNamePart = ch => (ch >= 97 && ch <= 122) || (ch >= 65 && ch <= 90) || isDigit(ch)
    || ch === 95 || ch === 36 || ch === 92 || (ch >= 0x80 && !isSpace(ch));

/**
 * 一个文件里的全部模块说明符，按出现顺序。
 * `typeOnly`：语句级的 `import type` / `export type` 和类型位置的 `import('x')`，运行时不存在；
 * `{ type A }` 这种逐个标的不算。
 * `dynamic`：真的动态 `import('x')`，bundler 会切成独立 chunk。
 *
 * @param {string} text 源码
 * @param {string} [file] 文件路径，只用来判断 `</` 是不是 JSX 的闭合标签
 * @returns {{ specifier: string, typeOnly: boolean, dynamic: boolean }[]}
 */
export function scanModuleSpecifiers(text, file = '') {
    const jsx = JSX_FILE.test(file);
    const end = text.length;
    const braces = [];
    const found = [];
    let pos = 0;
    let kind = EOF;
    let value = '';
    let previousKind = EOF;
    let previousValue = '';

    const lineEndFrom = from => {
        let at = from;
        while (at < end && !isLineBreak(text.charCodeAt(at))) at++;
        return at;
    };

    /**
     * `/` 是除号还是正则的开头，看前一个词：名字、字面量、`)`、`]`、`}` 后面是除号，其余位置是正则。
     * 分不清的话，`/\/*$/` 里的 `/*` 会被当成块注释的开头，把后面的代码连同 import 一起吞掉。
     */
    const regexMayStart = () => {
        if (previousKind === NAME) return KEYWORDS_BEFORE_EXPRESSION.has(previousValue);
        if (previousKind === PUNCT) return !PUNCT_ENDS_EXPRESSION.has(previousValue);
        return previousKind === EOF || previousKind === TEMPLATE_OPEN;
    };

    const readQuoted = quote => {
        const start = ++pos;
        while (pos < end) {
            const ch = text.charCodeAt(pos);
            if (ch === quote || isLineBreak(ch)) break; // 没收尾的字符串只到行尾
            if (ch !== 92) pos++;
            else pos += text.charCodeAt(pos + 1) === 13 && text.charCodeAt(pos + 2) === 10 ? 3 : 2; // `\` 转义；`\` 加 CRLF 是续行
        }
        value = text.slice(start, Math.min(pos, end));
        if (text.charCodeAt(pos) === quote) pos++;
        kind = STRING;
    };

    /** 从反引号或 `${...}` 的 `}` 之后读模板串，读到反引号或下一个 `${` 为止。 */
    const readTemplate = first => {
        const start = pos;
        while (pos < end) {
            const ch = text.charCodeAt(pos);
            if (ch === 96) {
                value = text.slice(start, pos++);
                kind = first ? TEMPLATE : TEMPLATE_CLOSE;
                return;
            }
            if (ch === 36 && text.charCodeAt(pos + 1) === 123) {
                pos += 2;
                braces.push(SUBSTITUTION);
                kind = TEMPLATE_OPEN;
                value = '';
                return;
            }
            pos += ch === 92 ? 2 : 1;
        }
        value = text.slice(start, end);
        pos = end;
        kind = first ? TEMPLATE : TEMPLATE_CLOSE;
    };

    const readRegex = () => {
        let inClass = false;
        pos++;
        while (pos < end) {
            const ch = text.charCodeAt(pos);
            if (isLineBreak(ch)) break; // 正则不跨行，没收尾的只到行尾
            pos++;
            if (ch === 92) {
                if (pos < end && !isLineBreak(text.charCodeAt(pos))) pos++;
            } else if (ch === 91) {
                inClass = true;
            } else if (ch === 93) {
                inClass = false;
            } else if (ch === 47 && !inClass) {
                break;
            }
        }
        while (pos < end && isNamePart(text.charCodeAt(pos))) pos++; // 标志位
        kind = REGEX;
        value = '';
    };

    const readPunct = ch => {
        if (ch === 125 && braces.pop() === SUBSTITUTION) {
            pos++;
            readTemplate(false);
            return;
        }
        if (ch === 123) braces.push(BRACE);
        const after = text.charCodeAt(pos + 1);
        let length = 1;
        if (ch === 46 && after === 46 && text.charCodeAt(pos + 2) === 46) length = 3; // ...
        else if (ch === 63 && after === 46 && !isDigit(text.charCodeAt(pos + 2))) length = 2; // `?.`；`a?.5:b` 是三元
        else if ((ch === 43 || ch === 45) && after === ch) length = 2; // ++ --
        else if (ch === 60 && after === 47 && jsx && text.charCodeAt(pos + 2) !== 42) length = 2; // JSX 的 `</`，`/` 不开正则
        value = length === 1 ? text[pos] : text.slice(pos, pos + length);
        pos += length;
        kind = PUNCT;
    };

    /** 读下一个词，跳过空白和注释。 */
    const next = () => {
        previousKind = kind;
        previousValue = value;
        while (pos < end) {
            const ch = text.charCodeAt(pos);
            if (isSpace(ch)) {
                pos++;
                continue;
            }
            const after = text.charCodeAt(pos + 1);
            if (ch === 47) {
                if (after === 47) {
                    pos = lineEndFrom(pos + 2);
                    continue;
                }
                if (after === 42) {
                    const close = text.indexOf('*/', pos + 2);
                    pos = close < 0 ? end : close + 2;
                    continue;
                }
                if (regexMayStart()) {
                    readRegex();
                    return;
                }
                pos += after === 61 ? 2 : 1; // `/=` 和 `/` 一样是除法
                kind = PUNCT;
                value = '/';
                return;
            }
            if (ch === 39 || ch === 34) {
                readQuoted(ch);
            } else if (ch === 96) {
                pos++;
                readTemplate(true);
            } else if (isDigit(ch) || (ch === 46 && isDigit(after))) {
                // 1.5、0xff、1_000、10n 都只是一个数，宽松地连着读
                pos++;
                while (pos < end && (isNamePart(text.charCodeAt(pos)) || text.charCodeAt(pos) === 46)) pos++;
                kind = NUMBER;
                value = '';
            } else if (isNamePart(ch) || (ch === 35 && isNamePart(after) && !isDigit(after))) {
                // `#x` 私有名连着 `#` 一起读，`this.#import` 就不会被当成 import 语句
                const start = pos++;
                while (pos < end && isNamePart(text.charCodeAt(pos))) pos++;
                value = text.slice(start, pos);
                kind = NAME;
            } else {
                readPunct(ch);
            }
            return;
        }
        kind = EOF;
        value = '';
    };

    /** 往后读几个词做判断，读完退回原处。 */
    const lookAhead = read => {
        const saved = { pos, kind, value, previousKind, previousValue, braces: [...braces] };
        const result = read();
        ({ pos, kind, value, previousKind, previousValue } = saved);
        braces.splice(0, braces.length, ...saved.braces);
        return result;
    };

    const isWord = word => kind === NAME && value === word;
    const isPunct = mark => kind === PUNCT && value === mark;
    const record = (typeOnly, dynamic) => found.push({ specifier: value, typeOnly, dynamic });

    /** 跳过从当前 `<` 开始的一段类型参数；`=>` 里的 `>` 不算收尾。 */
    const skipTypeArguments = () => {
        let depth = 0;
        do {
            if (isPunct('<')) depth++;
            else if (isPunct('>') && !(previousKind === PUNCT && previousValue === '=')) depth--;
            next();
        } while (depth > 0 && kind !== EOF);
    };

    /**
     * 当前词是 `import(` 后面的字符串，看它怎么用：
     * - `'type'`：后面接 `.名字` 而不是调用（`import('./x').T`、`import('./x').A.B<C>[]`），这是 TS 的类型写法，
     *   只在编译期存在；运行时对 import() 返回的 Promise 取属性没有意义。
     * - `'dynamic'`：真的动态 import，包括 `.then(...)`、`.then?.(...)`、`.then<T>(...)` 这些调用，和带 options 的写法。
     * - `null`：拼出来的路径（`'./x/' + name`），不是确定的模块。
     */
    const importUsage = () => lookAhead(() => {
        next();
        if (isPunct(',')) return 'dynamic';
        if (!isPunct(')')) return null;
        next();
        if (!isPunct('.')) return 'dynamic';
        while (isPunct('.')) {
            next();
            if (kind !== NAME) return 'dynamic';
            next();
        }
        if (isPunct('<')) skipTypeArguments();
        if (isPunct('?.')) next();
        return isPunct('(') ? 'dynamic' : 'type';
    });

    /**
     * 读 `from` 前面的子句，读到 `from '...'` 就记一条。子句只由名字、`{ ... }`、`,`、`*`、`as` 组成，
     * 碰到别的词就说明这不是 import / export 声明（比如对象字面量里的 `import:` 键），放弃。
     */
    const readClause = typeOnly => {
        while (kind !== EOF) {
            if (isWord('from')) {
                next();
                if (kind === STRING) {
                    record(typeOnly, false);
                    next();
                    return;
                }
                continue; // `import from from './x'`：前一个 `from` 是绑定的名字
            }
            if (isPunct('{')) {
                // 花括号里是名字、`as`、`type`、`,`，以及 ES2022 的字符串名 `{ 'a-b' as ab }`
                next();
                while (!isPunct('}')) {
                    if (kind !== NAME && kind !== STRING && !isPunct(',')) return;
                    next();
                }
                next();
                // `}` 后面只能是 `from`；不写分号时 `export { a }` 的下一行可能就是另一条 import，不能接着读
                if (!isWord('from')) return;
                continue;
            }
            const isName = kind === NAME && value !== 'import' && value !== 'export';
            const isStringName = kind === STRING && previousKind === NAME && previousValue === 'as'; // `export * as 'a-b' from`
            if (!isName && !isStringName && !isPunct(',') && !isPunct('*')) return;
            next();
        }
    };

    /** `type` 是修饰词还是默认导入的名字：`import type { A }`、`import type A from` 是前者，`import type from './x'` 是后者。 */
    const typeIsModifier = () => lookAhead(() => {
        next();
        if (kind === PUNCT) return value === '{' || value === '*';
        if (kind !== NAME) return false;
        if (value !== 'from') return true;
        next();
        return kind !== STRING; // `import type from from './x'`
    });

    const readImport = () => {
        const typeQuery = previousKind === NAME && previousValue === 'typeof'; // `typeof import('./x')` 也是类型写法
        next();
        if (isPunct('(')) {
            next();
            if (kind !== STRING && kind !== TEMPLATE) return;
            const usage = importUsage();
            if (usage) record(typeQuery || usage === 'type', !typeQuery && usage === 'dynamic');
            next();
            return;
        }
        if (isPunct('.')) return; // import.meta
        if (kind === STRING) { // import './x'
            record(false, false);
            next();
            return;
        }
        let typeOnly = false;
        if (isWord('type') && typeIsModifier()) {
            typeOnly = true;
            next();
        }
        readClause(typeOnly);
    };

    const readExport = () => {
        next();
        let typeOnly = false;
        if (isWord('type')) {
            const reExports = lookAhead(() => {
                next();
                return isPunct('{') || isPunct('*');
            });
            if (!reExports) return; // `export type X = ...`
            typeOnly = true;
            next();
        }
        if (isPunct('{') || isPunct('*')) readClause(typeOnly);
    };

    if (text.startsWith('#!')) pos = lineEndFrom(2);
    next();
    while (kind !== EOF) {
        // `obj.import(...)`、`x?.export` 是属性，不是语句
        const isMember = previousKind === PUNCT && (previousValue === '.' || previousValue === '?.');
        if (isWord('import') && !isMember) readImport();
        else if (isWord('export') && !isMember) readExport();
        else next();
    }
    return found;
}
