import { FORBIDDEN_ICON_LIBRARIES } from '../codes.mjs';
// dev/dedicatus/eslint/plugin.mjs
// Dedicatus 的项目约定规则（ESLint 本地插件，零依赖）。消息以代码开头，格式化时按消息里的代码归类。
// - no-icon-libraries（D412）：图标只用 lucide-react；
// - log-module-prefix（D413）：console 的第一个参数是字面量时以 `[模块名]` 开头；
// - log-error-object（D414）：catch 到的错误整个交给 console，不要只交 `.message`（会丢调用栈）。

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

export default {
    meta: { name: 'dedicatus' },
    rules: {
        'no-icon-libraries': noIconLibraries,
        'log-module-prefix': logModulePrefix,
        'log-error-object': logErrorObject,
    },
};
