import { defineAdapter } from '../../src/adapter.mjs';
// packages/coven/test/fixtures/adapter.mjs
// harness 测试用的假适配层：和任何真实项目无关，证明 harness 不依赖 Folia。
// 条目来自一个 TODO 列表；账本是一个 JSON 数组，只减不增；验收种类 typecheck、unit、baseline 是确定性的（结果由测试给），
// review、preview 交给 evaluator。

/** 风险路径表（宿主仓库配置里的 risk）。 */
export const riskRules = {
    r4: [
        { prefix: '.github/workflows/', why: 'CI' },
        { prefix: 'dev/coven/', why: '编排本身' },
    ],
    r3: [
        { prefix: 'src/utils/appearanceCodec.ts', why: '配置码的持久化格式' },
        { prefix: 'src/app/registry.ts', why: '启动顺序' },
    ],
};

export const LEDGER_FILE = 'ledger.json';

/** 测试改这里决定确定性验收项的结果。 */
export const outcomes = { typecheck: true, unit: true, baseline: true };

export const checks = {
    typecheck: { deterministic: true, run: () => ({ ok: outcomes.typecheck, summary: outcomes.typecheck ? '通过' : '失败' }) },
    unit: {
        deterministic: true,
        validate: verify => ([].concat(verify.target ?? []).length === 0 ? 'unit 要写 target（测试文件的相对路径）' : null),
        run: () => ({ ok: outcomes.unit, summary: outcomes.unit ? '通过' : '失败' }),
    },
    baseline: { deterministic: true, order: 10, run: () => ({ ok: outcomes.baseline, summary: outcomes.baseline ? '已消掉' : '没消掉', ...(outcomes.baseline ? {} : { code: 'D806' }) }) },
    review: { deterministic: false },
    preview: { deterministic: false, runsApp: true },
};

export const requiredKinds = { refactor: ['baseline'] };

const readList = text => (text === null ? [] : JSON.parse(text));

export default defineAdapter({
    id: 'fixture',
    sources: {
        todo: {
            describe: '假的待办列表',
            options: ['tags'],
            list: ({ options }) => [
                { key: 'todo:src/a.ts', kind: 'todo', code: 'T1', paths: ['src/a.ts'], tags: ['x'] },
                { key: 'todo:src/app/registry.ts', kind: 'todo', code: 'T2', paths: ['src/app/registry.ts'], tags: ['y'], note: '碰启动顺序' },
                { key: 'todo:style', kind: 'todo', code: 'S1', paths: ['src/b.ts'], riskPaths: ['src/b.ts', 'src/c.ts'], tags: ['x'] },
            ].filter(item => (options.tags ?? []).length === 0 || item.tags.some(tag => options.tags.includes(tag))),
            hints: () => ({ tags: [{ value: 'x', count: 2 }, { value: 'y', count: 1 }] }),
        },
    },
    itemKeyPattern: /todo:[^\s`·]+/,
    baseRisk: item => (item.code.startsWith('S') ? 'R0' : 'R2'),
    ledger: {
        files: [LEDGER_FILE],
        growth: ({ readBase, readHead }) => {
            const base = new Set(readList(readBase(LEDGER_FILE)));
            return readList(readHead(LEDGER_FILE)).filter(entry => !base.has(entry)).map(entry => `账本多了 ${entry}`);
        },
    },
    checks,
    requiredKinds,
    prompts: {
        planner: () => ({ itemsIntro: '假的待办', reading: '- README', escalateWhen: '   - 要挪按路径被找到的文件', scopeNote: '账本不用写。', criteria: '   - 一项 baseline', extraRules: '' }),
        generator: () => ({ setup: '先 coven setup。', steps: '- 改。', commitExample: 'fix(a): 改好', forbidden: '- 改 tools/。', selfChecks: 'unit' }),
        evaluator: () => ({ reviewChecks: '   - review：只看 diff。', severity: '项目的严重度标准' }),
    },
});
