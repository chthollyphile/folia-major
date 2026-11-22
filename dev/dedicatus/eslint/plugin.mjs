import path from 'node:path';
import { FORBIDDEN_ICON_LIBRARIES } from '../codes.mjs';
// dev/dedicatus/eslint/plugin.mjs
// Dedicatus 的项目约定规则（ESLint 本地插件，零依赖）。消息以代码开头，格式化时按消息里的代码归类。
// - no-icon-libraries（D412）：图标只用 lucide-react；
// - log-module-prefix（D413）：console 的第一个参数是字面量时以 `[模块名]` 开头；
// - log-error-object（D414）：catch 到的错误整个交给 console，不要只交 `.message`（会丢调用栈）；
// - credential-write-sites（D604）：账号凭据只在 dev/dedicatus/credentialWriters.mjs 登记过的函数里写；
// - restricted-apis（D312、D445、D508、D606、D607、D608、D609）：某些 API 只在 dev/dedicatus/restrictedApis.mjs 登记过的地方用；
// - registered-sites（D120、D121、D442）：某些写法只在 dev/dedicatus/registeredSites.mjs 登记过的函数里出现；
// - window-rebuild-handoff（D610）、stale-after-await（D311）、error-text-in-ui（D444）、hot-callback-state（D440）、
//   effect-cleanup（D441）、ui-literal-text（D443）：各自的说明见规则定义处。

/** 本文件在仓库里的相对路径（正斜杠）。 */
const repoPath = context => path.relative(context.cwd, context.filename).split(path.sep).join('/');

const CONSOLE_METHODS = new Set(['log', 'info', 'warn', 'error', 'debug']);

/** 名单按前缀匹配：`@tabler/icons` 同时挡住 `@tabler/icons-react`。 */
const isForbiddenIcon = source => typeof source === 'string' && FORBIDDEN_ICON_LIBRARIES.some(prefix => source.startsWith(prefix));

/** `console.xxx(...)` 的调用；不是返回 null。 */
const consoleMethodOf = node => {
    const callee = node.callee;
    if (callee?.type !== 'MemberExpression' || callee.computed) return null;
    if (callee.object?.type !== 'Identifier' || callee.object.name !== 'console') return null;
    const name = callee.property?.name;
    return CONSOLE_METHODS.has(name) ? name : null;
};

/** 字面量或模板字符串的开头文字；不是这两种返回 null。 */
const leadingText = node => {
    if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
    if (node?.type === 'TemplateLiteral') return node.quasis[0]?.value.cooked ?? '';
    return null;
};

const noIconLibraries = {
    meta: {
        type: 'problem',
        docs: { description: '图标只用 lucide-react（D412）' },
        schema: [],
        messages: { forbidden: 'D412：图标只用 lucide-react，不要从 {{source}} 引入。' },
    },
    create(context) {
        const check = (node, source) => {
            if (isForbiddenIcon(source)) context.report({ node, messageId: 'forbidden', data: { source } });
        };
        return {
            ImportDeclaration: node => check(node, node.source.value),
            ExportNamedDeclaration: node => node.source && check(node, node.source.value),
            ExportAllDeclaration: node => check(node, node.source.value),
            ImportExpression: node => check(node, node.source?.value),
            CallExpression(node) {
                if (node.callee.type === 'Identifier' && node.callee.name === 'require') check(node, node.arguments[0]?.value);
            },
        };
    },
};

const logModulePrefix = {
    meta: {
        type: 'suggestion',
        docs: { description: '日志行首写 [模块名]（D413）' },
        schema: [],
        messages: { missing: 'D413：日志行首写 [模块名]，例如 console.{{method}}(\'[Playback] ...\')。' },
    },
    create(context) {
        return {
            CallExpression(node) {
                const method = consoleMethodOf(node);
                if (!method || node.arguments.length === 0) return;
                const text = leadingText(node.arguments[0]);
                // GitHub Actions 的工作流命令（::error ...）必须顶格，不算日志。
                if (text === null || text.startsWith('::')) return;
                if (/^\[[^\]\s][^\]]*\]/.test(text)) return;
                context.report({ node: node.arguments[0], messageId: 'missing', data: { method } });
            },
        };
    },
};

const logErrorObject = {
    meta: {
        type: 'suggestion',
        docs: { description: '把错误本身交给 console，不要只交 .message（D414）' },
        schema: [],
        messages: { messageOnly: 'D414：把错误 {{name}} 整个交给 console，只交 {{name}}.message 会丢掉调用栈。' },
    },
    create(context) {
        const caught = [];
        return {
            CatchClause(node) {
                caught.push(node.param?.type === 'Identifier' ? node.param.name : null);
            },
            'CatchClause:exit'() {
                caught.pop();
            },
            CallExpression(node) {
                if (caught.length === 0 || !consoleMethodOf(node)) return;
                const names = new Set(caught.filter(Boolean));
                for (const arg of node.arguments) {
                    const target = arg.type === 'TemplateLiteral' ? arg.expressions : [arg];
                    for (const expression of target) {
                        if (expression.type === 'MemberExpression' && !expression.computed
                            && expression.object.type === 'Identifier' && names.has(expression.object.name)
                            && expression.property.name === 'message') {
                            context.report({ node: expression, messageId: 'messageOnly', data: { name: expression.object.name } });
                        }
                    }
                }
            },
        };
    },
};

/**
 * 一个节点所在的、有名字的函数：`function f`、`const f = () => …`、`{ f() {} }`、`{ f: () => … }`、`obj.f = …`、类字段 `f = () => …`。
 * 匿名回调（forEach 里的箭头函数）往外找，算进外层有名字的函数；不在任何函数里是 `(module)`。
 */
const enclosingFunctionName = (sourceCode, node) => {
    const ancestors = sourceCode.getAncestors(node);
    for (let i = ancestors.length - 1; i >= 0; i--) {
        const current = ancestors[i];
        if (!/Function/.test(current.type)) continue;
        if (current.id?.name) return current.id.name;
        const parent = ancestors[i - 1];
        if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name;
        // `const playSong = useCallback(async () => …)`：算 playSong，不算外面整个 hook
        const grandparent = ancestors[i - 2];
        if (parent?.type === 'CallExpression' && parent.arguments[0] === current
            && ['useCallback', 'useMemo'].includes(parent.callee.type === 'MemberExpression' ? parent.callee.property.name : parent.callee.name)
            && grandparent?.type === 'VariableDeclarator' && grandparent.id.type === 'Identifier') return grandparent.id.name;
        if (['Property', 'MethodDefinition', 'PropertyDefinition'].includes(parent?.type) && !parent.computed && parent.key.type === 'Identifier') return parent.key.name;
        if (parent?.type === 'AssignmentExpression' && parent.left.type === 'MemberExpression' && !parent.left.computed) return parent.left.property.name;
    }
    return '(module)';
};

/** 编译期就能确定的字符串：字面量，或者没有插值的模板字符串。 */
const literalString = node => {
    if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
    if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0]?.value.cooked ?? null;
    return null;
};

/** 对象字面量里写到的键；有展开或计算出来的键时多算一个 `*`。 */
const objectLiteralKeys = (node, isSameObject = () => false) => {
    if (node?.type !== 'ObjectExpression') return ['*'];
    return node.properties.flatMap(property => {
        // 展开会话对象自己（`{ ...cookies, token }`）不带进新键
        if (property.type === 'SpreadElement') return isSameObject(property.argument) ? [] : ['*'];
        if (property.type !== 'Property') return ['*'];
        if (!property.computed && property.key.type === 'Identifier') return [property.key.name];
        return [literalString(property.key) ?? '*'];
    });
};

const credentialWriteSites = {
    meta: {
        type: 'problem',
        docs: { description: '账号凭据只在登记过的入口写（D604）' },
        schema: [{
            type: 'object',
            properties: {
                keys: { type: 'array', items: { type: 'string' } },
                calls: { type: 'array', items: { type: 'string' } },
                // 文件 → 会话对象的名字 / 返回它的函数名：只在登记的文件里认，别处同名的变量和会话无关
                objects: { type: 'object' },
                objectFactories: { type: 'object' },
                storageKeyCalls: { type: 'array', items: { type: 'string' } },
                // 返回同步页面存储的调用（folium.sources.pageStore(id)）：它的 `.set(键, 值)` 也是写会话值
                pageStoreCalls: { type: 'array', items: { type: 'string' } },
                writers: { type: 'object' },
            },
            additionalProperties: false,
        }],
        messages: {
            unregistered: 'D604：账号凭据（{{key}}）只能在登记过的入口写，{{fn}} 不能写它。确实要在这里写的话，在 dev/dedicatus/credentialWriters.mjs 登记并说明为什么只会写入确认的登录。',
        },
    },
    create(context) {
        const { keys = [], calls = [], objects = {}, objectFactories = {}, storageKeyCalls = [], pageStoreCalls = [], writers = {} } = context.options[0] ?? {};
        const credentialKeys = new Set(keys.map(key => key.toLowerCase()));
        const relative = repoPath(context);
        const allowed = writers[relative] ?? {};
        // 写凭据的函数和会话对象可能被改名：`import { writeProviderSessionValue as w }`、`const jar = ensureCookies()`。
        const callNames = new Set(calls);
        const objectNames = new Set(objects[relative] ?? []);
        const factories = objectFactories[relative] ?? [];

        const check = (node, key) => {
            if (key !== '*' && !credentialKeys.has(key.toLowerCase())) return;
            const fn = enclosingFunctionName(context.sourceCode, node);
            const keysHere = (allowed[fn] ?? []).map(item => item.toLowerCase());
            // `*` 只放行运行时才知道的键（`obj[key] = …`）：登记了 `*` 的函数照样不能直接写 token、userid。
            if (keysHere.includes(key.toLowerCase())) return;
            context.report({ node, messageId: 'unregistered', data: { key: key === '*' ? '运行时才知道的键' : key, fn } });
        };

        const calleeName = callee => (callee.type === 'Identifier' ? callee.name
            : callee.type === 'MemberExpression' && !callee.computed ? callee.property.name : null);
        /** 是不是会话对象：登记的名字、它的别名，或者直接是 `ensureCookies()` 的返回值。 */
        const isCredentialObject = node => (node.type === 'Identifier' && objectNames.has(node.name))
            || (node.type === 'CallExpression' && factories.includes(calleeName(node.callee) ?? ''));
        // 同步页面存储：`folium.sources.pageStore(id)` 的返回值，和存着它的变量（`const store = …pageStore(id)`）。
        const pageStoreNames = new Set();
        const isPageStore = node => (node.type === 'Identifier' && pageStoreNames.has(node.name))
            || (node.type === 'CallExpression' && pageStoreCalls.includes(calleeName(node.callee) ?? ''));

        return {
            ImportSpecifier(node) {
                const imported = node.imported.type === 'Identifier' ? node.imported.name : node.imported.value;
                if (calls.includes(imported)) callNames.add(node.local.name);
            },
            VariableDeclarator(node) {
                if (node.id.type === 'Identifier' && node.init && isCredentialObject(node.init)) objectNames.add(node.id.name);
                if (node.id.type === 'Identifier' && node.init && isPageStore(node.init)) pageStoreNames.add(node.id.name);
            },
            CallExpression(node) {
                const name = calleeName(node.callee);
                if (!name) return;
                if (callNames.has(name)) {
                    check(node, literalString(node.arguments[1]) ?? '*');
                    return;
                }
                // 音源模组的会话值：`folium.sources.pageStore(id).set(键, 值)`、`store.set(键, 值)`（Folium 2.0 S5）
                if (name === 'set' && node.callee.type === 'MemberExpression' && isPageStore(node.callee.object)) {
                    check(node, literalString(node.arguments[0]) ?? '*');
                    return;
                }
                // `localStorage.setItem(getProviderSessionKey(平台, 键), 值)`：绕过 writeProviderSessionValue 直接写
                const target = node.arguments[0];
                if (name === 'setItem' && target?.type === 'CallExpression' && storageKeyCalls.includes(calleeName(target.callee) ?? '')) {
                    check(node, literalString(target.arguments[1]) ?? '*');
                    return;
                }
                // `Object.assign(会话对象, { token, … })`
                if (name === 'assign' && node.callee.type === 'MemberExpression' && node.callee.object.type === 'Identifier'
                    && node.callee.object.name === 'Object' && target && isCredentialObject(target)) {
                    for (const source of node.arguments.slice(1)) for (const key of objectLiteralKeys(source)) check(node, key);
                }
            },
            AssignmentExpression(node) {
                const target = node.left;
                // 整个换掉会话对象：`cookies = { ...cookies, token }`、`jar = ensureCookies()`（后者只是取别名）
                if (target.type === 'Identifier' && objectNames.has(target.name)) {
                    if (isCredentialObject(node.right)) return;
                    for (const key of objectLiteralKeys(node.right, isCredentialObject)) check(node, key);
                    return;
                }
                if (target.type === 'Identifier' && isCredentialObject(node.right)) {
                    objectNames.add(target.name);
                    return;
                }
                if (target.type !== 'MemberExpression' || !isCredentialObject(target.object)) return;
                const key = !target.computed && target.property.type === 'Identifier' ? target.property.name : literalString(target.property) ?? '*';
                check(node, key);
            },
        };
    },
};

/** 极简的路径 glob：`**` 跨目录，`*` 不跨目录。 */
export const globToRegExp = glob => {
    let out = '';
    for (let i = 0; i < glob.length; i++) {
        const char = glob[i];
        if (char === '*' && glob[i + 1] === '*') {
            const crossesDirectory = glob[i + 2] === '/';
            out += crossesDirectory ? '(?:.*/)?' : '.*';
            i += crossesDirectory ? 2 : 1;
        } else if (char === '*') {
            out += '[^/]*';
        } else {
            out += /[.+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
        }
    }
    return new RegExp(`^${out}$`);
};

const matchesAny = (file, globs) => globs.some(glob => globToRegExp(glob).test(file));

const restrictedApis = {
    meta: {
        type: 'problem',
        docs: { description: '某些 API 只能在登记过的地方用（dev/dedicatus/restrictedApis.mjs）' },
        schema: [{ type: 'object', properties: { entries: { type: 'array' } }, additionalProperties: false }],
        messages: { restricted: '{{code}}：{{message}}' },
    },
    create(context) {
        const file = repoPath(context);
        const visitors = {};
        for (const entry of context.options[0]?.entries ?? []) {
            if (!matchesAny(file, entry.include ?? ['**'])) continue;
            if (matchesAny(file, (entry.exclude ?? []).map(item => item.path))) continue;
            for (const selector of entry.selectors) {
                const previous = visitors[selector];
                visitors[selector] = node => {
                    previous?.(node);
                    context.report({ node, messageId: 'restricted', data: { code: entry.code, message: entry.message } });
                };
            }
        }
        return visitors;
    },
};

const isDevFlag = node => node?.type === 'MemberExpression' && !node.computed && node.property.name === 'DEV'
    && node.object.type === 'MemberExpression' && node.object.property.name === 'env'
    && node.object.object.type === 'MetaProperty';

/** 条件成立时一定是开发环境：`DEV`、`DEV && x`、`!(!DEV)`；`DEV || x`、`!DEV` 不算。 */
const truthyMeansDev = test => {
    if (isDevFlag(test)) return true;
    if (test?.type === 'UnaryExpression' && test.operator === '!') return falsyMeansDev(test.argument);
    if (test?.type === 'LogicalExpression' && test.operator === '&&') return truthyMeansDev(test.left) || truthyMeansDev(test.right);
    if (test?.type === 'LogicalExpression' && test.operator === '||') return truthyMeansDev(test.left) && truthyMeansDev(test.right);
    return false;
};

/** 条件不成立时一定是开发环境：`!DEV`、`!DEV || x`。 */
const falsyMeansDev = test => {
    if (test?.type === 'UnaryExpression' && test.operator === '!') return truthyMeansDev(test.argument);
    if (test?.type === 'LogicalExpression' && test.operator === '||') return falsyMeansDev(test.left) || falsyMeansDev(test.right);
    if (test?.type === 'LogicalExpression' && test.operator === '&&') return falsyMeansDev(test.left) && falsyMeansDev(test.right);
    return false;
};

/** 一条语句执行完一定离开当前块：return、throw，或者最后一句是它们的块。 */
const alwaysExits = statement => {
    if (!statement) return false;
    if (statement.type === 'ReturnStatement' || statement.type === 'ThrowStatement') return true;
    return statement.type === 'BlockStatement' && alwaysExits(statement.body.at(-1));
};

/**
 * 一个节点是不是只在开发环境下执行：在 `if (import.meta.env.DEV)` 的成立分支、`if (!import.meta.env.DEV)` 的 else 分支、
 * 三元和 `&&`/`||` 对应的那一支里，或者同一个块前面有 `if (!import.meta.env.DEV) return;`。
 */
const insideDevGuard = (sourceCode, node) => {
    const ancestors = sourceCode.getAncestors(node);
    return ancestors.some((ancestor, index) => {
        const child = ancestors[index + 1] ?? node;
        if (ancestor.type === 'IfStatement' || ancestor.type === 'ConditionalExpression') {
            if (ancestor.consequent === child) return truthyMeansDev(ancestor.test);
            if (ancestor.alternate === child) return falsyMeansDev(ancestor.test);
            return false;
        }
        if (ancestor.type === 'LogicalExpression' && ancestor.right === child) {
            return ancestor.operator === '&&' ? truthyMeansDev(ancestor.left) : ancestor.operator === '||' && falsyMeansDev(ancestor.left);
        }
        if (ancestor.type === 'BlockStatement' || ancestor.type === 'Program') {
            const before = ancestor.body.slice(0, ancestor.body.indexOf(child));
            return before.some(statement => statement.type === 'IfStatement' && !statement.alternate
                && alwaysExits(statement.consequent) && falsyMeansDev(statement.test));
        }
        return false;
    });
};

/**
 * 登记过的写入点：某种写法（选择器）只能出现在登记过的文件，或登记过的“文件 → 函数”里（D121、D120、D442 等）。
 * 和 D604 一样按所在的有名字的函数放行；登记表在 dev/dedicatus/registeredSites.mjs。
 */
const registeredSites = {
    meta: {
        type: 'problem',
        docs: { description: '某种写法只能出现在登记过的地方（dev/dedicatus/registeredSites.mjs）' },
        schema: [{ type: 'object', properties: { entries: { type: 'array' } }, additionalProperties: false }],
        messages: { unregistered: '{{code}}：{{message}}（{{fn}} 没有登记）' },
    },
    create(context) {
        const file = repoPath(context);
        const visitors = {};
        // 同一函数同一行只报一次：`{ state: 'unavailable', reason: 'taken-down' }` 会被两个选择器各命中一次（#891 演习）
        const reported = new Set();
        for (const entry of context.options[0]?.entries ?? []) {
            if (!matchesAny(file, entry.include ?? ['**'])) continue;
            if (matchesAny(file, (entry.allowFiles ?? []).map(item => item.path))) continue;
            const sitesHere = entry.sites?.[file] ?? {};
            for (const selector of entry.selectors) {
                const previous = visitors[selector];
                visitors[selector] = node => {
                    previous?.(node);
                    const fn = enclosingFunctionName(context.sourceCode, node);
                    if (Object.hasOwn(sitesHere, fn)) return;
                    if (entry.allowInsideDevGuard && insideDevGuard(context.sourceCode, node)) return;
                    const key = `${entry.code}\u0000${fn}\u0000${node.loc.start.line}`;
                    if (reported.has(key)) return;
                    reported.add(key);
                    context.report({ node, messageId: 'unregistered', data: { code: entry.code, message: entry.message, fn } });
                };
            }
        }
        return visitors;
    },
};

/** 从一个节点所在的作用域往外找一个名字的定义。 */
const findVariable = (sourceCode, node, name) => {
    for (let scope = sourceCode.getScope(node); scope; scope = scope.upper) {
        const variable = scope.set.get(name);
        if (variable) return variable;
    }
    return null;
};

/**
 * D610：主进程重建主窗口一律带上播放交接快照（#1115 → #1122 → #1128 修了三次）。快照必须是同一函数（或外层函数）里
 * `await <交接函数>()` 得到的变量；原样往下传快照的函数登记在 dev/dedicatus/windowRebuild.mjs。刚建好、还没放歌的
 * 窗口（启动时那一处在匿名回调里，按函数名登记只能登记整个模块）在调用处写带原因的 eslint-disable-next-line。
 */
const windowRebuildHandoff = {
    meta: {
        type: 'problem',
        docs: { description: '重建主窗口要带播放交接快照（D610）' },
        schema: [{ type: 'object', additionalProperties: true }],
        messages: { missing: 'D610：重建主窗口要带上 await {{factory}}() 得到的交接快照，否则外部播放器和队列会没人接手（#1128）。{{fn}}：{{why}}' },
    },
    create(context) {
        const options = context.options[0] ?? {};
        if (repoPath(context) !== options.file) return {};
        const report = (node, fn, why) => context.report({ node, messageId: 'missing', data: { factory: options.handoffFactory, fn, why } });
        return {
            CallExpression(node) {
                if (node.callee.type !== 'Identifier' || node.callee.name !== options.call) return;
                const fn = enclosingFunctionName(context.sourceCode, node);
                const handoff = node.arguments[1];
                if (!handoff || (handoff.type === 'Literal' && handoff.value === null)) {
                    if (!Object.hasOwn(options.withoutHandoff ?? {}, fn)) report(node, fn, '没有带快照，也没有登记成“窗口里还没在放歌”');
                    return;
                }
                if (handoff.type !== 'Identifier') {
                    report(node, fn, '快照要先存进一个变量');
                    return;
                }
                const definition = findVariable(context.sourceCode, node, handoff.name)?.defs[0];
                const init = definition?.type === 'Variable' ? definition.node.init : null;
                if (init?.type === 'AwaitExpression' && init.argument.type === 'CallExpression'
                    && init.argument.callee.type === 'Identifier' && init.argument.callee.name === options.handoffFactory) return;
                if (definition?.type === 'Parameter' && Object.hasOwn(options.passthrough ?? {}, fn)) return;
                report(node, fn, `${handoff.name} 不是 await ${options.handoffFactory}() 的结果`);
            },
        };
    },
};

/** 一个函数节点的第一个参数名（`.catch(error => …)` 的 error）。 */
const firstParamName = fn => (fn && /Function/.test(fn.type) && fn.params[0]?.type === 'Identifier' ? fn.params[0].name : null);

/** 把错误原样变成字符串的函数：`errorMessage(error)`（src/utils/errorText.ts，返回的就是原文）、`String(error)`。 */
const RAW_TEXT_FUNCTIONS = new Set(['errorMessage', 'String']);

/**
 * D444：catch 到的错误的原文不直接交给界面的提示函数（登记的名字）或 JSX：界面按错误码显示翻译后的提示，
 * 原文只进日志（#353）。认 `try/catch` 的参数和 `.catch(error => …)` 回调的参数；原文指 `error.message`、
 * `errorMessage(error)`、`String(error)`、`error.toString()`，以及装着它们的模板字符串、三元、`||`/`??`、
 * 对象字面量的值（`setStatusMessage({ type: 'error', text: error.message })`）和先存进去的 const 变量。
 * 交给 `t('键', { error: … })` 插进翻译文案的不算。
 */
const errorTextInUi = {
    meta: {
        type: 'suggestion',
        docs: { description: '界面不直接显示错误原文（D444）' },
        schema: [{ type: 'object', properties: { notifiers: { type: 'array', items: { type: 'string' } } }, additionalProperties: false }],
        messages: { raw: 'D444：界面不直接显示错误 {{name}} 的原文：按错误种类显示翻译后的提示（t(…)），原文交给 console.warn(\'[模块] …\', {{name}}) 写日志。' },
    },
    create(context) {
        const notifiers = new Set(context.options[0]?.notifiers ?? []);
        const caught = [];
        const isCaught = node => node?.type === 'Identifier' && caught.includes(node.name);
        /** 一个表达式里直接装着的错误原文：返回那个错误变量的名字，没有返回 null。 */
        const rawErrorIn = (node, depth = 0) => {
            if (!node || depth > 4) return null;
            switch (node.type) {
                case 'MemberExpression': {
                    // `error.message`、`(error as Error).message`、`error!.message`
                    const object = node.object.type === 'TSAsExpression' || node.object.type === 'TSNonNullExpression' ? node.object.expression : node.object;
                    return !node.computed && node.property.name === 'message' && isCaught(object) ? object.name : null;
                }
                case 'ChainExpression':
                    return rawErrorIn(node.expression, depth + 1);
                case 'CallExpression': {
                    const name = calledName(node);
                    if (RAW_TEXT_FUNCTIONS.has(name) && isCaught(node.arguments[0])) return node.arguments[0].name;
                    const callee = node.callee;
                    if (callee.type !== 'MemberExpression' || callee.computed) return null;
                    if (callee.property.name === 'toString' && isCaught(callee.object)) return callee.object.name;
                    // 原文上再调字符串方法：`error.message.trim()`、`.slice(0, 80)`
                    return rawErrorIn(callee.object, depth + 1);
                }
                case 'TemplateLiteral':
                    for (const part of node.expressions) {
                        const found = isCaught(part) ? part.name : rawErrorIn(part, depth + 1);
                        if (found) return found;
                    }
                    return null;
                case 'ConditionalExpression':
                    return rawErrorIn(node.consequent, depth + 1) ?? rawErrorIn(node.alternate, depth + 1);
                case 'LogicalExpression':
                    return node.operator === '&&' ? rawErrorIn(node.right, depth + 1) : rawErrorIn(node.left, depth + 1) ?? rawErrorIn(node.right, depth + 1);
                case 'ObjectExpression':
                    for (const property of node.properties) {
                        const found = property.type === 'Property' ? rawErrorIn(property.value, depth + 1) : null;
                        if (found) return found;
                    }
                    return null;
                case 'Identifier': {
                    const definition = findVariable(context.sourceCode, node, node.name)?.defs[0];
                    const declared = definition?.type === 'Variable' && definition.parent?.kind === 'const' ? definition.node.init : null;
                    return declared ? rawErrorIn(declared, depth + 1) : null;
                }
                case 'TSAsExpression':
                case 'TSNonNullExpression':
                    return rawErrorIn(node.expression, depth + 1);
                default:
                    return null;
            }
        };
        const reportIn = expression => {
            const name = rawErrorIn(expression);
            if (name) context.report({ node: expression, messageId: 'raw', data: { name } });
        };
        const catchCallback = node => node.parent?.type === 'CallExpression' && node.parent.arguments[0] === node
            && node.parent.callee.type === 'MemberExpression' && !node.parent.callee.computed && node.parent.callee.property.name === 'catch';
        return {
            CatchClause(node) { caught.push(node.param?.type === 'Identifier' ? node.param.name : null); },
            'CatchClause:exit'() { caught.pop(); },
            ':function'(node) { if (catchCallback(node)) caught.push(firstParamName(node)); },
            ':function:exit'(node) { if (catchCallback(node)) caught.pop(); },
            CallExpression(node) {
                const callee = node.callee;
                const name = callee.type === 'Identifier' ? callee.name
                    : callee.type === 'MemberExpression' && !callee.computed ? callee.property.name : null;
                if (!name || !notifiers.has(name) || caught.length === 0) return;
                for (const argument of node.arguments) reportIn(argument);
            },
            JSXExpressionContainer(node) {
                if (caught.length > 0 && node.expression.type !== 'JSXEmptyExpression') reportIn(node.expression);
            },
        };
    },
};

/** 调用的名字：`f()` 或 `obj.f()`。 */
const calledName = node => (node.callee.type === 'Identifier' ? node.callee.name
    : node.callee.type === 'MemberExpression' && !node.callee.computed ? node.callee.property.name : null);

/**
 * D311：播放路径里，async 函数每次 await 之后、调用登记的写状态函数之前，必须先问一次本次起播的令牌
 * （在条件里读令牌变量、调用发令牌的函数、或引用了它们的小函数），不新鲜就不写。按源码顺序近似判断：
 * - 互斥分支、以 return / throw 结束的分支里的 await 不算在写入之前；
 * - try 里的复核护不住 catch / finally 里的写入（等待抛错时复核根本没执行）；
 * - 循环里写入排在 await 前面的，经过回边也算在 await 之后；
 * - 只有在条件里（if、三元、&&、||、!、循环条件）读令牌才算复核，`stillWanted.abandon()`、`log(t)` 不算；
 *   写入函数自己收了令牌（`showSong(song, { stillWanted })`）的，由它自己复核；
 *   令牌交给被等待的函数、它过期时回空值，再用 `if (!结果) return;` 判这个结果的，算那一次 await 之后的复核。
 * 查的函数：自己拿了令牌（发令牌、读令牌、参数收令牌）的 async 函数；外层函数拿了令牌的 async 闭包；
 * 外层函数拿了令牌的 `.then` / `.catch` / `.finally` 回调（回调本身就在等待之后）。认不出属于哪一次起播的不查。
 */
const staleAfterAwait = {
    meta: {
        type: 'problem',
        docs: { description: '播放路径等待之后要先复核令牌再写状态（D311）' },
        schema: [{ type: 'object', additionalProperties: true }],
        messages: { stale: 'D311：等待之后直接 {{writer}}()：先问一次本次起播的令牌（{{tokens}}），不新鲜就不写，否则晚到的结果会盖掉新的播放（#619、#796、#1016）。' },
    },
    create(context) {
        const options = context.options[0] ?? {};
        if (!matchesAny(repoPath(context), options.files ?? [])) return {};
        const factories = new Set(options.factories ?? []);
        const writers = new Set(options.writers ?? []);
        // 别的复核写法（问“还是不是刚才要的那首”）：算复核，但不算“拿了令牌”，免得范围又变宽
        const readers = new Set(options.readers ?? []);
        const namePattern = options.namePattern ? new RegExp(options.namePattern) : null;
        const sourceCode = context.sourceCode;
        const visitorKeys = sourceCode.visitorKeys;
        const tokens = new Set();
        const isFunction = node => /Function/.test(node.type);
        const isLoop = node => /^(For|ForIn|ForOf|While|DoWhile)Statement$/.test(node.type);
        const within = (node, outer) => outer && node.range[0] >= outer.range[0] && node.range[1] <= outer.range[1];

        /** 文件里的令牌：发令牌函数的返回值、按名字认的变量、引用了令牌的小函数。 */
        const collectTokens = program => {
            const helpers = [];
            const walk = node => {
                if (!node || typeof node.type !== 'string') return;
                if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init) {
                    if (node.init.type === 'CallExpression' && factories.has(calledName(node.init) ?? '')) tokens.add(node.id.name);
                    else if (isFunction(node.init)) helpers.push(node);
                }
                if ((node.type === 'Identifier') && namePattern?.test(node.name)) tokens.add(node.name);
                for (const key of visitorKeys[node.type] ?? []) {
                    const child = node[key];
                    if (Array.isArray(child)) child.forEach(walk);
                    else walk(child);
                }
            };
            walk(program);
            // 引用了令牌（或发令牌函数）的小函数也算令牌：`const rewritten = () => wholeQueueWritesSoFar() !== atStart`；
            // 只引用了别的复核写法的小函数算复核写法：`const overtaken = () => askedSongKeyRef.current !== key`
            let grew = true;
            const mentions = (text, names) => [...names].some(name => new RegExp(`\\b${name}\\b`).test(text));
            while (grew) {
                grew = false;
                for (const helper of helpers) {
                    const name = helper.id.name;
                    if (tokens.has(name)) continue;
                    const text = sourceCode.getText(helper.init);
                    if (mentions(text, tokens) || mentions(text, factories)) {
                        tokens.add(name);
                        readers.delete(name);
                        grew = true;
                    } else if (!readers.has(name) && mentions(text, readers)) {
                        readers.add(name);
                        grew = true;
                    }
                }
            }
        };

        /** 一处读是不是在条件里：往上到语句为止，经过 if / 三元 / 循环的条件、switch 的判断值、&& || ?? 的左边。 */
        const inCondition = node => {
            let child = node;
            for (const ancestor of sourceCode.getAncestors(node).reverse()) {
                if (isFunction(ancestor)) return false;
                if ('test' in ancestor && ancestor.test === child) return true;
                if (ancestor.type === 'SwitchStatement' && ancestor.discriminant === child) return true;
                if (ancestor.type === 'LogicalExpression' && ancestor.left === child) return true;
                if (/Statement$|Declaration$/.test(ancestor.type)) return false;
                child = ancestor;
            }
            return false;
        };

        /** 令牌本身，或者令牌上的成员（`stillWanted.onceShown`）。 */
        const isTokenValue = node => (node?.type === 'Identifier' && tokens.has(node.name))
            || (node?.type === 'MemberExpression' && isTokenValue(node.object));

        /** 令牌直接交给了写入函数（实参本身，或者对象字面量第一层的值：`showSong(song, { stillWanted })`）：它自己复核。 */
        const delegates = call => call.arguments.some(argument => isTokenValue(argument)
            || (argument.type === 'ObjectExpression' && argument.properties.some(property => property.type === 'Property' && isTokenValue(property.value))));

        /** 只是名字、不是读：声明处、对象的键、`x.名字`。 */
        const isNameOnly = node => (node.parent?.type === 'VariableDeclarator' && node.parent.id === node)
            || (node.parent?.type === 'Property' && node.parent.key === node && !node.parent.computed && !node.parent.shorthand)
            || (node.parent?.type === 'MemberExpression' && node.parent.property === node && !node.parent.computed);

        /** 令牌或别的复核写法本身（`stillWanted`、`askedSongKeyRef.current`、`stillWanted.onceShown`）。 */
        const isCheckValue = node => (node?.type === 'Identifier' && (tokens.has(node.name) || readers.has(node.name)))
            || (node?.type === 'MemberExpression' && isCheckValue(node.object));

        /** 内联的判断函数：函数体就是对令牌的判断（`() => stillWanted()`、`() => !overtaken()`、`() => askedSongKeyRef.current === key`）。 */
        const isCheckPredicate = node => {
            if (!node || (node.type !== 'ArrowFunctionExpression' && node.type !== 'FunctionExpression')) return false;
            let body = node.body;
            if (body.type === 'BlockStatement') {
                if (body.body.length !== 1 || body.body[0].type !== 'ReturnStatement') return false;
                body = body.body[0].argument;
            }
            const strip = expression => (expression?.type === 'UnaryExpression' && expression.operator === '!' ? strip(expression.argument) : expression);
            const asks = expression => isCheckValue(expression) || (expression?.type === 'CallExpression' && isCheckValue(expression.callee));
            const core = strip(body);
            return core?.type === 'BinaryExpression' ? asks(strip(core.left)) || asks(strip(core.right)) : asks(core);
        };

        /** 令牌直接交给了被等待的函数：实参本身是令牌或内联的判断函数，或者对象字面量第一层的值是它们。 */
        const passesCheck = argument => isCheckValue(argument) || isCheckPredicate(argument)
            || (argument.type === 'ObjectExpression' && argument.properties.some(property => property.type === 'Property'
                && (isCheckValue(property.value) || isCheckPredicate(property.value))));

        /**
         * `const track = await resolve(…, () => !overtaken())`：被等待的函数收了令牌，过期时回空值。
         * @returns {string | null} 结果的变量名
         */
        const delegatedResultOf = awaitNode => {
            const call = awaitNode.argument;
            if (call?.type !== 'CallExpression' || !call.arguments.some(passesCheck)) return null;
            const parent = awaitNode.parent;
            return parent?.type === 'VariableDeclarator' && parent.init === awaitNode && parent.id.type === 'Identifier' ? parent.id.name : null;
        };

        /**
         * 一处读所在的 if（读在它的条件里）；不在任何 if 的条件里返回 null。写入实参里的三元、`&&`、`??` 不算：
         * 过期时写进去的是空值。
         */
        const ifTestOf = node => {
            let child = node;
            for (const ancestor of sourceCode.getAncestors(node).reverse()) {
                if (isFunction(ancestor)) return null;
                if (ancestor.type === 'IfStatement' && ancestor.test === child) return ancestor;
                if (/Statement$|Declaration$/.test(ancestor.type)) return null;
                child = ancestor;
            }
            return null;
        };

        /** 一个函数体里的事件：await 结束、读令牌（token：是不是令牌；check：算不算复核）、写状态。不进嵌套函数。 */
        const eventsOf = fn => {
            const events = [];
            /** 被等待的函数交回来的结果 → 产生它的那次 await。判这个结果只算那一次 await 之后的复核。 */
            const delegatedResults = new Map();
            const walk = (node, root) => {
                if (!node || typeof node.type !== 'string') return;
                if (!root && isFunction(node)) return;
                if (node.type === 'Identifier' && (tokens.has(node.name) || readers.has(node.name)) && !isNameOnly(node)) {
                    events.push({ kind: 'read', at: node.range[0], node, token: tokens.has(node.name), check: inCondition(node) });
                }
                const guardIf = node.type === 'Identifier' && delegatedResults.has(node.name) && !isNameOnly(node) ? ifTestOf(node) : null;
                if (guardIf) {
                    // `if (!结果) return;` 护住后面所有写入；`if (结果) 写入` 只护住成立分支里的写入
                    events.push({ kind: 'read', at: node.range[0], node, token: false, check: true, forAwait: delegatedResults.get(node.name), guardIf, exits: alwaysExits(guardIf.consequent) });
                }
                if (node.type === 'CallExpression') {
                    const name = calledName(node);
                    // 发令牌、取快照本身就是一次新的起点
                    if (name && factories.has(name)) events.push({ kind: 'read', at: node.range[0], node, token: true, check: true });
                    // 写入发生在实参算完之后：`setLyrics(await load())` 的 await 在写入之前
                    if (name && writers.has(name)) events.push({ kind: 'write', at: node.range[1], node, name });
                }
                for (const key of visitorKeys[node.type] ?? []) {
                    const child = node[key];
                    if (Array.isArray(child)) child.forEach(item => walk(item, false));
                    else walk(child, false);
                }
                if (node.type === 'AwaitExpression') {
                    events.push({ kind: 'await', at: node.range[1], node });
                    const result = delegatedResultOf(node);
                    if (result) delegatedResults.set(result, node);
                }
            };
            walk(fn.body, true);
            return events.sort((a, b) => a.at - b.at);
        };

        const holdsToken = fn => fn.params.some(param => param.type === 'Identifier' && tokens.has(param.name))
            || eventsOf(fn).some(event => event.kind === 'read' && event.token);

        /** `.then(cb)`、`.catch(cb)`、`.finally(cb)` 的回调：整个回调都在等待之后。 */
        const isPromiseCallback = fn => fn.parent?.type === 'CallExpression' && fn.parent.arguments.includes(fn)
            && fn.parent.callee.type === 'MemberExpression' && !fn.parent.callee.computed
            && ['then', 'catch', 'finally'].includes(fn.parent.callee.property.name);

        /** 复核 r 护不住写入 w：r 在某个 try 的块里，w 在它的 catch / finally 里。 */
        const skippedByThrow = (r, w) => sourceCode.getAncestors(r).some(ancestor => ancestor.type === 'TryStatement'
            && within(r, ancestor.block) && (within(w, ancestor.handler) || within(w, ancestor.finalizer)));

        const check = fn => {
            const promiseCallback = !fn.async && isPromiseCallback(fn);
            if (!fn.async && !promiseCallback) return;
            const events = eventsOf(fn);
            const awaits = events.filter(event => event.kind === 'await');
            if (promiseCallback) awaits.unshift({ kind: 'await', at: fn.body.range[0], node: fn.body });
            if (awaits.length === 0) return;
            const outerHolds = sourceCode.getAncestors(fn).some(ancestor => isFunction(ancestor) && holdsToken(ancestor));
            if (!holdsToken(fn) && !outerHolds) return;
            const checks = events.filter(event => event.kind === 'read' && event.check);
            for (const write of events.filter(event => event.kind === 'write')) {
                if (delegates(write.node)) continue;
                const protects = read => !skippedByThrow(read.node, write.node)
                    && (!read.guardIf || read.exits || within(write.node, read.guardIf.consequent));
                // 判被等待函数的结果只复核产生它的那一次 await
                const answers = (read, wait) => !read.forAwait || read.forAwait === wait.node;
                const stale = awaits.some(wait => {
                    if (inExclusiveBranches(wait.node, write.node) || exitsBefore(wait.node, write.node)) return false;
                    if (wait.at <= write.at) return !checks.some(read => read.at > wait.at && read.at < write.at && protects(read) && answers(read, wait));
                    // 写入排在 await 前面：只有同一个循环（在这个函数里）的回边能让它在 await 之后执行
                    const loop = sourceCode.getAncestors(write.node).reverse()
                        .find(ancestor => isLoop(ancestor) && within(ancestor, fn.body) && within(wait.node, ancestor));
                    if (!loop) return false;
                    return !checks.some(read => within(read.node, loop) && (read.at < write.at || read.at > wait.at) && protects(read) && answers(read, wait));
                });
                if (stale) context.report({ node: write.node, messageId: 'stale', data: { writer: write.name, tokens: [...factories].join('、') } });
            }
        };

        /** await 所在的 if 分支以 return / throw 结束，而写入不在这个分支里：执行流走不到写入。 */
        const exitsBefore = (awaitNode, writeNode) => {
            const ancestors = sourceCode.getAncestors(awaitNode);
            for (let i = ancestors.length - 1; i > 0; i--) {
                const branch = ancestors[i];
                const parent = ancestors[i - 1];
                if (parent.type !== 'IfStatement' || (parent.consequent !== branch && parent.alternate !== branch)) continue;
                if (!alwaysExits(branch)) continue;
                if (!within(writeNode, branch)) return true;
            }
            return false;
        };

        /** 两个节点是不是分处同一个 if 或三元的两支。 */
        const inExclusiveBranches = (a, b) => {
            const chainA = [...sourceCode.getAncestors(a), a];
            const chainB = [...sourceCode.getAncestors(b), b];
            let index = 0;
            while (index < chainA.length && index < chainB.length && chainA[index] === chainB[index]) index += 1;
            const common = chainA[index - 1];
            if (common?.type !== 'IfStatement' && common?.type !== 'ConditionalExpression') return false;
            const branchA = chainA[index];
            const branchB = chainB[index];
            return branchA !== branchB && branchA !== common.test && branchB !== common.test;
        };

        return {
            Program: collectTokens,
            'FunctionDeclaration:exit': check,
            'FunctionExpression:exit': check,
            'ArrowFunctionExpression:exit': check,
        };
    },
};

/** 一个调用是不是“注册高频回调”：返回回调参数的节点（内联函数，或者指向函数的名字），不是返回 null。 */
const hotCallbackOf = node => {
    const name = calledName(node);
    const args = node.arguments;
    if (name === 'useMotionValueEvent' && args[1]?.type === 'Literal' && args[1].value === 'change') return args[2];
    if (name === 'requestAnimationFrame' || name === 'useFrame' || name === 'useAnimationFrame') return args[0];
    if (name === 'addEventListener' && args[0]?.type === 'Literal' && args[0].value === 'timeupdate') return args[1];
    // MotionValue 的 `.on('change', …)`
    if (name === 'on' && node.callee.type === 'MemberExpression' && args[0]?.type === 'Literal' && args[0].value === 'change') return args[1];
    return null;
};

/** 回调参数指向的函数节点：内联函数；作用域链上 `function f`、`const f = () => …`、`const f = useCallback(() => …)` 定义的名字。 */
const functionNodeOf = (sourceCode, node) => {
    if (!node) return null;
    if (/Function/.test(node.type)) return node;
    if (node.type !== 'Identifier') return null;
    const definition = findVariable(sourceCode, node, node.name)?.defs[0];
    if (definition?.type === 'FunctionName') return definition.node;
    const init = definition?.type === 'Variable' ? definition.node.init : null;
    if (/Function/.test(init?.type ?? '')) return init;
    if (init?.type === 'CallExpression' && calledName(init) === 'useCallback' && /Function/.test(init.arguments[0]?.type ?? '')) return init.arguments[0];
    return null;
};

/** 函数式更新里自己比较了新旧值：`setX(prev => prev === next ? prev : next)`、`setX(prev => { if (…) return prev; … })`。 */
const comparingUpdater = argument => {
    if (!argument || !/Function/.test(argument.type)) return false;
    const body = argument.body;
    if (body.type === 'ConditionalExpression' || body.type === 'LogicalExpression') return true;
    return body.type === 'BlockStatement' && body.body.some(statement => statement.type === 'IfStatement'
        || (statement.type === 'ReturnStatement' && ['ConditionalExpression', 'LogicalExpression'].includes(statement.argument?.type)));
};

/**
 * D440：高频回调（useMotionValueEvent 的 change、MotionValue 的 `.on('change')`、requestAnimationFrame、useFrame、
 * useAnimationFrame、ResizeObserver、timeupdate 和 onTimeUpdate）里不无条件写 React 状态（useState 的 setter、
 * 从 store 取出来的 set*、store 的 setState / getState().set*）：要么有判断守卫（值真的变了才写：if、三元、
 * 前面的 `if (未变) return;`、自己比较新旧值的函数式更新），要么改用 ref / MotionValue
 * （frontend-runtime-guardrails；#913、#914 的无限更新）。回调可以内联，也可以是指向函数的名字（具名的帧循环）。
 */
const hotCallbackState = {
    meta: {
        type: 'problem',
        docs: { description: '高频回调里不无条件写状态（D440）' },
        schema: [],
        messages: { unguarded: 'D440：高频回调里无条件调用 {{setter}}()：每帧都会让组件重渲染。只在值真的变了时写（加判断），或改用 ref / MotionValue。' },
    },
    create(context) {
        const sourceCode = context.sourceCode;
        const setters = new Set();
        const hot = new Set();
        const calls = [];
        const isSetter = node => {
            const name = calledName(node);
            if (!name) return false;
            if (node.callee.type === 'Identifier') return setters.has(name);
            // store 的写入：useXStore.setState(…)、useXStore.getState().setY(…)
            if (name === 'setState') return true;
            return /^set[A-Z]/.test(name) && node.callee.object.type === 'CallExpression' && calledName(node.callee.object) === 'getState';
        };
        const markHot = callback => {
            const fn = functionNodeOf(sourceCode, callback ?? null);
            if (fn) hot.add(fn);
        };
        const guarded = (node, callback) => {
            if (comparingUpdater(node.arguments[0])) return true;
            const ancestors = sourceCode.getAncestors(node);
            for (let i = ancestors.length - 1; i >= 0; i--) {
                const ancestor = ancestors[i];
                if (ancestor === callback) return false;
                if (['IfStatement', 'ConditionalExpression', 'LogicalExpression', 'SwitchCase'].includes(ancestor.type)) return true;
                if (ancestor.type === 'BlockStatement') {
                    const before = ancestor.body.slice(0, ancestor.body.indexOf(ancestors[i + 1] ?? node));
                    if (before.some(statement => statement.type === 'IfStatement' && alwaysExits(statement.consequent))) return true;
                }
            }
            return false;
        };
        const isStoreHook = init => init?.type === 'CallExpression' && /^use[A-Z]\w*Store$/.test(calledName(init) ?? '');
        return {
            VariableDeclarator(node) {
                const init = node.init;
                if (node.id.type === 'ArrayPattern' && init?.type === 'CallExpression' && calledName(init) === 'useState') {
                    const setter = node.id.elements[1];
                    if (setter?.type === 'Identifier') setters.add(setter.name);
                }
                // 从 store 取出来的写入函数：`const setX = useXStore(s => s.setX)`、`const { setX } = useXStore()`
                if (node.id.type === 'Identifier' && isStoreHook(init) && /^set[A-Z]/.test(node.id.name)) setters.add(node.id.name);
                if (node.id.type === 'ObjectPattern' && isStoreHook(init)) {
                    for (const property of node.id.properties) {
                        if (property.type === 'Property' && property.value.type === 'Identifier' && /^set[A-Z]/.test(property.value.name)) setters.add(property.value.name);
                    }
                }
            },
            CallExpression(node) {
                markHot(hotCallbackOf(node));
                calls.push(node);
            },
            NewExpression(node) {
                if (node.callee.type === 'Identifier' && node.callee.name === 'ResizeObserver') markHot(node.arguments[0]);
            },
            JSXAttribute(node) {
                if (node.name.type === 'JSXIdentifier' && node.name.name === 'onTimeUpdate' && node.value?.type === 'JSXExpressionContainer') {
                    markHot(node.value.expression);
                }
            },
            // 具名的回调可能定义在注册之前：全部看完再判断
            'Program:exit'() {
                for (const node of calls) {
                    if (!isSetter(node)) continue;
                    const callback = sourceCode.getAncestors(node).reverse().find(ancestor => hot.has(ancestor));
                    if (callback && !guarded(node, callback)) {
                        context.report({ node, messageId: 'unguarded', data: { setter: calledName(node) ?? 'set' } });
                    }
                }
            },
        };
    },
};

/** effect 里注册、要在 cleanup 里释放的东西。setTimeout 是一次性的，不算。 */
const isRegistration = node => {
    if (node.type === 'NewExpression') return node.callee.type === 'Identifier' && /^(Resize|Intersection|Mutation|Performance)Observer$/.test(node.callee.name);
    if (node.type !== 'CallExpression') return false;
    const name = calledName(node);
    return name === 'requestAnimationFrame' || name === 'setInterval' || name === 'addEventListener' || name === 'subscribe' || name === 'observe';
};

/**
 * D441：useEffect / useLayoutEffect 里注册了帧回调、定时器、监听、观察器、订阅，就要返回 cleanup 释放
 * （frontend-runtime-guardrails；#304、#568、#987）。表达式写法的箭头函数（直接返回注册的结果）算有返回。
 */
const effectCleanup = {
    meta: {
        type: 'problem',
        docs: { description: 'effect 里注册的东西要在 cleanup 里释放（D441）' },
        schema: [],
        messages: { missing: 'D441：effect 里注册了 {{what}}，却没有返回 cleanup：组件卸载后它还在跑。返回一个函数，在里面释放它。' },
    },
    create(context) {
        const visitorKeys = context.sourceCode.visitorKeys;
        return {
            CallExpression(node) {
                const name = calledName(node);
                if (name !== 'useEffect' && name !== 'useLayoutEffect') return;
                const effect = node.arguments[0];
                if (!effect || !/Function/.test(effect.type) || effect.body.type !== 'BlockStatement') return;
                let registration = null;
                const returns = [];
                const walk = (child, top) => {
                    if (!child || typeof child.type !== 'string') return;
                    if (!top && /Function/.test(child.type)) return;
                    if (!registration && isRegistration(child)) registration = child;
                    if (child.type === 'ReturnStatement') returns.push(child);
                    for (const key of visitorKeys[child.type] ?? []) {
                        const value = child[key];
                        if (Array.isArray(value)) value.forEach(item => walk(item, false));
                        else walk(value, false);
                    }
                };
                walk(effect.body, true);
                // 注册之后（或者注册本身就在 return 里：`return store.subscribe(…)`）的某个 return 交回了能释放的东西
                // （函数、变量、调用结果）；`return;`、`return undefined;`、`return null;` 和注册之前的提前返回不算
                const returnsCleanup = registration && returns.some(statement => statement.range[1] > registration.range[0]
                    && statement.argument && statement.argument.type !== 'Literal'
                    && !(statement.argument.type === 'Identifier' && statement.argument.name === 'undefined')
                    && statement.argument.type !== 'UnaryExpression');
                if (registration && !returnsCleanup) {
                    const what = registration.type === 'NewExpression' ? `new ${registration.callee.name}` : `${calledName(registration)}()`;
                    context.report({ node: registration, messageId: 'missing', data: { what } });
                }
            },
        };
    },
};

/** 界面文字：含两个以上字母或汉字。纯符号、数字、单个字母不算。 */
const HUMAN_TEXT = /[A-Za-z぀-ヿ一-鿿]{2,}/;
const TEXT_ATTRIBUTES = new Set(['title', 'aria-label', 'placeholder', 'alt', 'aria-description']);
/** 网址、主机名、IP、主机:端口（地址栏的示例值，#689 演习的 `localhost:8765`）：不翻译。 */
const ADDRESS = /^(?:[a-z][\w+.-]*:\/\/\S+|(?:localhost|\d{1,3}(?:\.\d{1,3}){3}|[\w-]+(?:\.[\w-]+)+)(?::\d+)?(?:\/\S*)?)$/i;
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * D443：JSX 文本和 title、aria-label、placeholder、alt 里的字面文字尽量走 i18n（t()），三份语言文件一起加（AGENTS.md）。
 * warning，不阻断。品牌名、产品名、单位写进 allow：文字里去掉它们以后不剩别的字才算没问题（`OpenSubsonic (` 也认）。
 */
const uiLiteralText = {
    meta: {
        type: 'suggestion',
        docs: { description: '界面文字走 i18n（D443）' },
        schema: [{ type: 'object', properties: { allow: { type: 'array', items: { type: 'string' } } }, additionalProperties: false }],
        messages: { literal: 'D443：界面文字“{{text}}”写死在代码里：最好走 t()，en、zh-CN、in 三份语言文件一起加。' },
    },
    create(context) {
        const allowed = [...(context.options[0]?.allow ?? [])].sort((a, b) => b.length - a.length);
        const names = allowed.length > 0 ? new RegExp(`(?<![A-Za-z])(?:${allowed.map(escapeRegExp).join('|')})(?![A-Za-z])`, 'g') : null;
        const check = (node, raw) => {
            const text = raw.replace(/\s+/g, ' ').trim();
            if (!text || ADDRESS.test(text)) return;
            if (!HUMAN_TEXT.test(names ? text.replace(names, ' ') : text)) return;
            context.report({ node, messageId: 'literal', data: { text: text.length > 30 ? `${text.slice(0, 30)}…` : text } });
        };
        return {
            JSXText(node) { check(node, node.value); },
            JSXAttribute(node) {
                const name = node.name.type === 'JSXIdentifier' ? node.name.name : null;
                if (!name || !TEXT_ATTRIBUTES.has(name)) return;
                if (node.value?.type === 'Literal' && typeof node.value.value === 'string') check(node.value, node.value.value);
            },
        };
    },
};

export default {
    meta: { name: 'dedicatus' },
    rules: {
        'no-icon-libraries': noIconLibraries,
        'log-module-prefix': logModulePrefix,
        'log-error-object': logErrorObject,
        'credential-write-sites': credentialWriteSites,
        'restricted-apis': restrictedApis,
        'registered-sites': registeredSites,
        'window-rebuild-handoff': windowRebuildHandoff,
        'error-text-in-ui': errorTextInUi,
        'stale-after-await': staleAfterAwait,
        'hot-callback-state': hotCallbackState,
        'effect-cleanup': effectCleanup,
        'ui-literal-text': uiLiteralText,
    },
};
