import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    CREDENTIAL_KEYS,
    CREDENTIAL_OBJECT_FACTORIES,
    CREDENTIAL_OBJECTS,
    CREDENTIAL_STORAGE_KEY_CALLS,
    CREDENTIAL_WRITE_CALLS,
    CREDENTIAL_WRITERS,
} from '../../../dev/dedicatus/credentialWriters.mjs';
import plugin from '../../../dev/dedicatus/eslint/plugin.mjs';
import { codeForMessage, toFindings } from '../../../dev/dedicatus/eslint/run.mjs';

// test/unit/dedicatus/eslintRules.test.ts
// Dedicatus 的 ESLint 部分：规则 id 和消息换成代码（不依赖 ESLint，单测任务里照常跑）；
// 项目约定规则（D412 图标库、D413 日志前缀、D414 只交 message、D604 凭据写入点）用 ESLint 的 RuleTester 跑，
// 需要隔离的 lint 环境（npm run lint:install），没装时跳过——CI 的 Lint 任务装了它，在那里跑。

const RUNTIME = path.resolve(__dirname, '../../../dev/dedicatus/lint/package.json');
type RuleTesterClass = {
    new (config: object): { run: (name: string, rule: unknown, tests: object) => void };
    describe: unknown;
    it: unknown;
    itOnly: unknown;
};

const hasRuntime = existsSync(path.resolve(__dirname, '../../../dev/dedicatus/lint/node_modules/eslint'));
/**
 * 装了 ESLint 隔离环境才注册这一组。不能用 describe.skipIf：vitest 跳过一组时仍会执行它的回调（为了收集里面的测试），
 * 回调开头解析 eslint 就会抛错。单测任务没装这个环境，这些用例在 CI 的 Lint 任务里跑。
 */
const describeWithLintRuntime = (name: string, body: () => Promise<void>) => {
    if (hasRuntime) describe(name, body);
    else describe.skip(name, () => { it.skip('需要先 npm run lint:install', () => undefined); });
};

describe('dedicatus eslint code mapping', () => {
    it('maps rule ids, code-prefixed messages and directive problems to codes', () => {
        expect(codeForMessage({ ruleId: '@typescript-eslint/no-floating-promises', message: 'x' })).toBe('D401');
        expect(codeForMessage({ ruleId: 'no-restricted-syntax', message: 'D410：不用系统 <select>' })).toBe('D410');
        expect(codeForMessage({ ruleId: '@typescript-eslint/no-unnecessary-condition', message: 'x' })).toBe('D490');
        expect(codeForMessage({ ruleId: null, message: "Unused eslint-disable directive (no problems were reported from 'x')." })).toBe('D420');
        expect(codeForMessage({ ruleId: 'foo/bar', message: "Definition for rule 'foo/bar' was not found." })).toBe('D420');
        expect(codeForMessage({ ruleId: null, fatal: true, message: 'Parsing error' })).toBe('D004');
    });

    it('turns ESLint results into findings with repo-relative paths and stripped code prefixes', () => {
        const root = path.resolve('/repo');
        const findings = toFindings(root, [{
            filePath: path.join(root, 'src', 'a.tsx'),
            messages: [{ ruleId: 'no-restricted-syntax', message: 'D410：不用系统 <select>', line: 3, column: 5 }],
        }]);
        expect(findings).toEqual([{
            code: 'D410', file: 'src/a.tsx', line: 3, column: 5, rule: 'no-restricted-syntax',
            message: '不用系统 <select>', key: 'D410:src/a.tsx:3:5:no-restricted-syntax',
        }]);
    });
});

describe('dedicatus credential writers registry', () => {
    it('names only functions that still exist in the registered files', () => {
        const root = path.resolve(__dirname, '../../..');
        for (const [file, functions] of Object.entries(CREDENTIAL_WRITERS)) {
            const text = readFileSync(path.join(root, file), 'utf8');
            for (const name of Object.keys(functions)) {
                const defined = new RegExp(`(?:function\\s+|(?:const|let|var)\\s+)${name}\\b|^\\s*(?:async\\s+)?${name}\\s*\\(`, 'm');
                expect(defined.test(text), `${file} 里找不到登记的 ${name}`).toBe(true);
            }
        }
    });
});

describeWithLintRuntime('dedicatus eslint rules', async () => {
    const eslintEntry = createRequire(RUNTIME).resolve('eslint');
    // eslint 只装在隔离环境里，根目录的 tsc 解析不到它的类型：这里只描述用到的那一点。
    const { RuleTester } = await import(pathToFileURL(eslintEntry).href) as { RuleTester: RuleTesterClass };
    RuleTester.describe = describe;
    RuleTester.it = it;
    RuleTester.itOnly = it.only;
    const tester = new RuleTester({ languageOptions: { ecmaVersion: 'latest', sourceType: 'module' } });

    tester.run('dedicatus/no-icon-libraries', plugin.rules['no-icon-libraries'], {
        valid: ["import { Play } from 'lucide-react';", "import x from 'react';"],
        invalid: [
            { code: "import { FaPlay } from 'react-icons/fa';", errors: [{ messageId: 'forbidden' }] },
            { code: "import { IconPlayerPlay } from '@tabler/icons-react';", errors: [{ messageId: 'forbidden' }] },
            { code: "const icons = await import('@heroicons/react/24/solid');", errors: [{ messageId: 'forbidden' }] },
        ],
    });

    tester.run('dedicatus/log-module-prefix', plugin.rules['log-module-prefix'], {
        valid: [
            "console.warn('[Playback] 切歌失败', error);",
            'console.info(`[Omni] ${count} 首`);',
            'console.log(value);',
            'console.table(rows);',
            'console.log(`::error title=D102::${message}`);',
        ],
        invalid: [
            { code: "console.warn('切歌失败', error);", errors: [{ messageId: 'missing' }] },
            { code: 'console.error(`failed: ${x}`);', errors: [{ messageId: 'missing' }] },
            { code: "console.log('[ ] not a module');", errors: [{ messageId: 'missing' }] },
        ],
    });

    tester.run('dedicatus/log-error-object', plugin.rules['log-error-object'], {
        valid: [
            "try { run(); } catch (error) { console.warn('[A] failed', error); }",
            'try { run(); } catch (error) { const message = error.message; show(message); }',
            "console.warn('[A]', result.message);",
        ],
        invalid: [
            { code: "try { run(); } catch (error) { console.warn('[A] failed', error.message); }", errors: [{ messageId: 'messageOnly' }] },
            { code: 'try { run(); } catch (e) { console.error(`[A] failed: ${e.message}`); }', errors: [{ messageId: 'messageOnly' }] },
        ],
    });

    // D604 用真实的登记表跑：#1104 修复前的两段写法（处理每个响应的函数直接改写登录账号）都要被挡住。
    const credentialOptions = [{
        keys: CREDENTIAL_KEYS,
        calls: CREDENTIAL_WRITE_CALLS,
        objects: CREDENTIAL_OBJECTS,
        objectFactories: CREDENTIAL_OBJECT_FACTORIES,
        storageKeyCalls: CREDENTIAL_STORAGE_KEY_CALLS,
        writers: CREDENTIAL_WRITERS,
    }];
    const inRepo = (file: string) => path.join(process.cwd(), file);
    const transport = inRepo('src/services/onlineMusic/kugou/kugouTransport.ts');
    const bridge = inRepo('electron/kugou/kugouApiBridge.cjs');
    tester.run('dedicatus/credential-write-sites', plugin.rules['credential-write-sites'], {
        valid: [
            {
                filename: transport,
                options: credentialOptions,
                code: [
                    'const rememberConfirmedSignIn = (signIn) => {',
                    "    writeProviderSessionValue('kugou', 'token', signIn.token);",
                    "    writeProviderSessionValue('kugou', 'userid', signIn.userId);",
                    '};',
                    "const rememberSessionCookies = (entries) => writeProviderSessionValue('kugou', 'cookie', entries.join('; '));",
                    "const persistWebSession = (operation, response) => { rememberSessionCookies(entries); writeProviderSessionValue('kugou', 'dfid', dfid); };",
                ].join('\n'),
            },
            {
                filename: bridge,
                options: credentialOptions,
                code: [
                    'const adoptConfirmedSignIn = (sessionCookies, data) => { sessionCookies.token = String(data.token); sessionCookies.userid = String(data.userid); };',
                    'const rememberDeviceCookie = (sessionCookies, name, value) => { sessionCookies[name] = value; };',
                    'const mergeResponseSession = (operation, result) => {',
                    '    result.cookie.forEach(entry => { const parsed = parse(entry); rememberDeviceCookie(sessionCookies, parsed[0], parsed[1]); });',
                    '    if (data?.dfid) sessionCookies.dfid = String(data.dfid);',
                    '};',
                ].join('\n'),
            },
            // 会话对象的名字只在登记的文件里认：别处叫 cookies 的变量和登录会话无关
            { filename: inRepo('src/utils/cookieParse.ts'), options: credentialOptions, code: 'const parse = (k, v) => { const cookies = {}; cookies[k] = v; cookies.token = v; return cookies; };' },
            // 不算凭据的键（匿名会话、设备 id）哪里都能写
            { filename: inRepo('src/services/onlineMusic/netease/netease.ts'), options: credentialOptions, code: "const f = () => writeProviderSessionValue('netease', 'anonymous_cookie', c);" },
        ],
        invalid: [
            {
                // 整个换掉会话对象，以及先声明后赋值的别名
                filename: bridge,
                options: credentialOptions,
                code: [
                    'const mergeResponseSession = (data) => {',
                    '    cookies = { ...cookies, token: String(data.token) };',
                    '    sessionCookies = { ...sessionCookies, userid: data.userid };',
                    '    let jar;',
                    '    jar = ensureCookies();',
                    '    jar.token = data.token;',
                    '    cookies = data.cookies;',
                    '};',
                ].join('\n'),
                errors: Array.from({ length: 4 }, () => ({ messageId: 'unregistered' })),
            },
            {
                // #1104 修复前的 kugouTransport：每个响应都把 cookie、token、userid 写进会话（三处都要报）
                filename: transport,
                options: credentialOptions,
                code: [
                    'const persistWebSession = (response) => {',
                    "    if (cookies) writeProviderSessionValue('kugou', 'cookie', cookies);",
                    '    const payload = response?.data || response;',
                    "    if (payload?.token) writeProviderSessionValue('kugou', 'token', String(payload.token));",
                    "    if (payload?.userid) writeProviderSessionValue('kugou', 'userid', String(payload.userid));",
                    '};',
                ].join('\n'),
                errors: [{ messageId: 'unregistered' }, { messageId: 'unregistered' }, { messageId: 'unregistered' }],
            },
            {
                // #1104 修复前的桥接层：mergeResponseSession 处理每一个响应，也直接改写账号
                filename: bridge,
                options: credentialOptions,
                code: [
                    'const mergeResponseSession = (result) => {',
                    '    if (data?.token) sessionCookies.token = String(data.token);',
                    '    if (data?.userid ?? data?.user_id) sessionCookies.userid = String(data.userid ?? data.user_id);',
                    '};',
                ].join('\n'),
                errors: [{ messageId: 'unregistered' }, { messageId: 'unregistered' }],
            },
            {
                // #1104 修复前的桥接层还有一条路：cookie 循环把响应里的 token、userid cookie 原样写进会话
                filename: bridge,
                options: credentialOptions,
                code: 'const mergeResponseSession = (result) => { result.cookie.forEach(entry => { const parsed = parse(entry); sessionCookies[parsed[0]] = parsed[1]; }); };',
                errors: [{ messageId: 'unregistered' }],
            },
            {
                // #1104 修复前的桌面版账号提示：任何响应里的 userid 都写进去
                filename: transport,
                options: credentialOptions,
                code: "const persistElectronAccountHint = (operation, response) => { const userId = response?.data?.userid; if (userId) writeProviderSessionValue('kugou', 'userid', String(userId)); };",
                errors: [{ messageId: 'unregistered' }],
            },
            {
                // 登记了 * 的函数照样不能直接写 token
                filename: bridge,
                options: credentialOptions,
                code: 'const rememberDeviceCookie = (sessionCookies, name, value) => { sessionCookies[name] = value; sessionCookies.token = value; };',
                errors: [{ messageId: 'unregistered' }],
            },
            {
                // 会话对象的别名、工厂函数的返回值、Object.assign、没有插值的模板字符串键
                filename: bridge,
                options: credentialOptions,
                code: [
                    'const mergeResponseSession = (data) => {',
                    '    const jar = ensureCookies();',
                    '    jar.userid = data.userid;',
                    '    ensureCookies().token = data.token;',
                    '    cookies.user_id = data.user_id;',
                    '    Object.assign(sessionCookies, { token: data.token, dfid: data.dfid });',
                    '    sessionCookies[`userid`] = data.userid;',
                    '};',
                ].join('\n'),
                errors: Array.from({ length: 5 }, () => ({ messageId: 'unregistered' })),
            },
            {
                // 改名导入、直接写 localStorage、类字段
                filename: transport,
                options: credentialOptions,
                code: [
                    "import { writeProviderSessionValue as remember } from '../providerStorage';",
                    "const everyAnswer = (r) => remember('kugou', 'token', r.token);",
                    "const direct = (r) => localStorage.setItem(getProviderSessionKey('kugou', 'userid'), r.userid);",
                    "class Session { keep = (r) => writeProviderSessionValue('kugou', 'cookie', r.cookie); }",
                ].join('\n'),
                errors: Array.from({ length: 3 }, () => ({ messageId: 'unregistered' })),
            },
            {
                // 没登记的文件、键在运行时才知道
                filename: inRepo('src/services/onlineMusic/qq/qqLists.ts'),
                options: credentialOptions,
                code: "const keep = (key, value) => writeProviderSessionValue('qq', key, value);",
                errors: [{ messageId: 'unregistered' }],
            },
        ],
    });
});
