import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildModuleGraph } from '../../../dev/mcp/ts-code-map/graph/modules.mjs';
import { checkBoundaries } from '../../../dev/dedicatus/checks/boundaries.mjs';
import { checkCycles } from '../../../dev/dedicatus/checks/cycles.mjs';
import { BOUNDARY_RULES } from '../../../dev/dedicatus/rules.mjs';
import { codeInfo } from '../../../dev/dedicatus/codes.mjs';

// test/unit/dedicatus/graphChecks.test.ts
// Dedicatus 的模块图检查：分层边界按规则的代码报，目标不含 UI 的报 D190，`import type` 不算；
// 循环依赖（D301）只看加载时会执行的边，`import type` 和动态 `import()` 不构成环。

const { fixtureFiles } = vi.hoisted(() => ({ fixtureFiles: [] as string[] }));
// 图的文件清单平时来自 git ls-files；临时目录不是仓库，直接给定。
vi.mock('../../../dev/mcp/ts-code-map/files.mjs', () => ({ listFiles: () => fixtureFiles }));

const files: Record<string, string> = {
    'src/components/Panel.tsx': "import { useState } from 'react';\nexport const Panel = () => useState(0);\n",
    'src/components/pureMath.ts': 'export const mix = (a: number, b: number) => (a + b) / 2;\n',
    // store 夹具用 .tsx：storeContract 会把测试里写成 src/stores/*.ts 的路径当作对 store 的引用去核对
    // D101：store 值导入了一个真的含 UI 的组件
    'src/stores/usePanelStore.tsx': "import { Panel } from '../components/Panel';\nexport const panel = Panel;\n",
    // D190：store 值导入的东西住在 components 下，但运行时不含 UI
    'src/stores/useMixStore.tsx': "import { mix } from '../components/pureMath';\nexport const half = mix(1, 2);\n",
    // 只有 import type：不算违规
    'src/stores/useTypedStore.tsx': "import type { Panel } from '../components/Panel';\nexport type P = typeof Panel;\n",
    // 两个文件互相值导入：环
    'src/utils/ping.ts': "import { pong } from './pong';\nexport const ping = () => pong;\n",
    'src/utils/pong.ts': "import { ping } from './ping';\nexport const pong = () => ping;\n",
    // 一边是动态 import()：不构成加载时的环
    'src/utils/lazyA.ts': "export const loadB = () => import('./lazyB');\n",
    'src/utils/lazyB.ts': "import { loadB } from './lazyA';\nexport const again = loadB;\n",
    // 一边是 import type：同样不构成环
    'src/utils/typeA.ts': "import type { B } from './typeB';\nexport type A = B;\nexport const a = 1;\n",
    'src/utils/typeB.ts': "import { a } from './typeA';\nexport type B = number;\nexport const b = a;\n",
    // 同一个模块既动态 import() 又静态导入：那条静态边照样在加载期执行，环要报
    'src/utils/mixedA.ts': "import { b } from './mixedB';\nexport const later = () => import('./mixedB');\nexport const a = b;\n",
    'src/utils/mixedB.ts': "import { a } from './mixedA';\nexport const b = 1;\nexport const again = () => a;\n",
};

describe('dedicatus graph checks', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'dedicatus-graph-'));

    beforeAll(() => {
        for (const [file, text] of Object.entries(files)) {
            mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
            writeFileSync(path.join(root, file), text);
        }
        fixtureFiles.push(...Object.keys(files));
    });
    afterAll(() => rmSync(root, { recursive: true, force: true }));

    it('reports boundary violations with the rule code and misplaced targets as D190', () => {
        const findings = checkBoundaries(buildModuleGraph(root));
        expect(findings.map(finding => finding.key).sort()).toEqual([
            'D101:src/stores/usePanelStore.tsx->src/components/Panel.tsx',
            'D190:src/stores/useMixStore.tsx->src/components/pureMath.ts',
        ]);
        expect(findings.find(finding => finding.code === 'D190')?.message).toContain('D101');
    });

    it('reports every file of a load-time cycle, ignoring type-only and dynamic-only edges', () => {
        const findings = checkCycles(buildModuleGraph(root));
        expect(findings.map(finding => finding.key).sort()).toEqual([
            'D301:src/utils/mixedA.ts',
            'D301:src/utils/mixedB.ts',
            'D301:src/utils/ping.ts',
            'D301:src/utils/pong.ts',
        ]);
    });

    it('gives every boundary rule a registered code', () => {
        for (const rule of BOUNDARY_RULES) expect(codeInfo(rule.code), rule.why).not.toBeNull();
        expect(new Set(BOUNDARY_RULES.map(rule => rule.code)).size).toBe(BOUNDARY_RULES.length);
    });
});
