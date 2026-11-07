import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import plugin from '../../../dev/dedicatus/eslint/plugin.mjs';
import { codeForMessage, toFindings } from '../../../dev/dedicatus/eslint/run.mjs';

// test/unit/dedicatus/eslintRules.test.ts
// Dedicatus 的 ESLint 部分：规则 id 和消息换成代码（不依赖 ESLint，单测任务里照常跑）；
// 三条项目约定规则（D412 图标库、D413 日志前缀、D414 只交 message）用 ESLint 的 RuleTester 跑，
// 需要隔离的 lint 环境（npm run lint:install），没装时跳过——CI 的 Lint 任务装了它，在那里跑。

const RUNTIME = path.resolve(__dirname, '../../../dev/dedicatus/lint/package.json');
type RuleTesterClass = {
    new (config: object): { run: (name: string, rule: unknown, tests: object) => void };
    describe: unknown;
    it: unknown;
    itOnly: unknown;
};

const hasRuntime = existsSync(path.resolve(__dirname, '../../../dev/dedicatus/lint/node_modules/eslint'));

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

describe.skipIf(!hasRuntime)('dedicatus eslint rules', async () => {
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

});
