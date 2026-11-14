import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildModuleGraph } from '../../../dev/mcp/ts-code-map/graph/modules.mjs';
import { checkBoundaries } from '../../../dev/dedicatus/checks/boundaries.mjs';

// test/unit/dedicatus/sourceBoundaries.test.ts
// Folium 2.0 方案 §6.1 的边界规则（dev/dedicatus/rules.mjs）：音源模组（sources/<id>/）不 import 宿主（D130，连 import type），
// 宿主只有 src/services/onlineMusic/web/* 能 import sources/*/core（D131），音源之间不互相 import（D132，连 import type），
// 界面与状态层不直连 sources/（D110 加了 sources/**，旧位置的 Provider / Transport 照旧查）。每条都故意违反一次，
// 允许的写法一条不报；kit 经别名进图。

const { fixtureFiles } = vi.hoisted(() => ({ fixtureFiles: [] as string[] }));
// 图的文件清单平时来自 git ls-files；临时目录不是仓库，直接给定。
vi.mock('../../../dev/mcp/ts-code-map/files.mjs', () => ({ listFiles: () => fixtureFiles }));

const files: Record<string, string> = {
    'src/types/onlineMusic.ts': 'export type Song = { id: string };\nexport const KIND = 1;\n',
    'src/services/onlineMusic/omni.ts': 'export const omni = {};\n',
    'src/services/onlineMusic/kugou/kugouTransport.ts': 'export const transport = {};\n',
    'electron/modSystem/sourceApi.cjs': 'module.exports = {};\n',
    'packages/folium-source-kit/src/index.ts': 'export const errorMessage = (value: unknown) => String(value);\n',
    'sources/netease/core/index.ts': "import { errorMessage } from '@folia/folium-source-kit';\nexport const createSource = () => errorMessage(1);\n",
    'sources/netease/core/transport.ts': 'export const request = 1;\n',
    'sources/netease/client/index.ts': "import { createSource } from '../core/index';\nexport default () => createSource();\n",
    // D130：音源 import 宿主，值导入和只有类型的都算
    'sources/bodian/client/index.ts': "import { omni } from '../../../src/services/onlineMusic/omni';\nexport default () => omni;\n",
    'sources/bodian/core/types.ts': "import type { Song } from '../../../src/types/onlineMusic';\nexport type S = Song;\n",
    'sources/bodian/main/index.ts': "import api from '../../../electron/modSystem/sourceApi.cjs';\nexport default api;\n",
    // D132：音源之间，值导入和只有类型的都算
    'sources/qq/client/index.ts': "import { request } from '../../netease/core/transport';\nexport default () => request;\n",
    'sources/qq/core/types.ts': "import type { createSource } from '../../netease/core/index';\nexport type C = typeof createSource;\n",
    // 允许：网页版的 adapter 用 core
    'src/services/onlineMusic/web/netease.ts': "import { createSource } from '../../../../sources/netease/core/index';\nexport const web = createSource;\n",
    // D131：网页版的 adapter 越过 core 用 client；宿主别处用 core；主进程用音源
    'src/services/onlineMusic/web/qq.ts': "import activate from '../../../../sources/qq/client/index';\nexport const web = activate;\n",
    'src/services/onlineMusic/lyricsGlue.ts': "import { request } from '../../../sources/netease/core/transport';\nexport const glue = request;\n",
    'electron/legacyBridge.cjs': "const core = require('../sources/netease/core/index');\nmodule.exports = core;\n",
    // 宿主只有 import type 指向音源：D131 只看值导入，不报
    'src/services/onlineMusic/typesOnly.ts': "import type { createSource } from '../../../sources/netease/core/index';\nexport type C = typeof createSource;\n",
    // D110：界面直连音源，或者直连旧位置的 Transport
    'src/components/SearchBox.tsx': "import { request } from '../../sources/netease/core/transport';\nexport const SearchBox = () => request;\n",
    'src/hooks/useKugou.ts': "import { transport } from '../services/onlineMusic/kugou/kugouTransport';\nexport const useKugou = () => transport;\n",
    // 宿主用 kit：允许
    'src/utils/errorText.ts': "export { errorMessage } from '@folia/folium-source-kit';\n",
};

let root: string;
let found: { code: string; file: string; to: string }[];

beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'dedicatus-sources-'));
    for (const [file, text] of Object.entries(files)) {
        mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
        writeFileSync(path.join(root, file), text);
    }
    fixtureFiles.splice(0, fixtureFiles.length, ...Object.keys(files));
    found = checkBoundaries(buildModuleGraph(root)).map(({ code, file, to }) => ({ code, file, to }));
});

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

describe('the boundaries of the source mods in sources/', () => {
    it('D130: a source imports the host, by value or by type', () => {
        expect(found.filter((entry) => entry.code === 'D130')).toEqual([
            { code: 'D130', file: 'sources/bodian/client/index.ts', to: 'src/services/onlineMusic/omni.ts' },
            { code: 'D130', file: 'sources/bodian/core/types.ts', to: 'src/types/onlineMusic.ts' },
            { code: 'D130', file: 'sources/bodian/main/index.ts', to: 'electron/modSystem/sourceApi.cjs' },
        ]);
    });

    it('D131: the host uses a source other than through web/* and core (the main process is the text scan below)', () => {
        expect(found.filter((entry) => entry.code === 'D131')).toEqual([
            { code: 'D131', file: 'src/services/onlineMusic/lyricsGlue.ts', to: 'sources/netease/core/transport.ts' },
            { code: 'D131', file: 'src/services/onlineMusic/web/qq.ts', to: 'sources/qq/client/index.ts' },
        ]);
    });

    it('D132: one source imports another, by value or by type', () => {
        expect(found.filter((entry) => entry.code === 'D132')).toEqual([
            { code: 'D132', file: 'sources/qq/client/index.ts', to: 'sources/netease/core/transport.ts' },
            { code: 'D132', file: 'sources/qq/core/types.ts', to: 'sources/netease/core/index.ts' },
        ]);
    });

    it('D110: the interface reaches a source directly, in sources/ or where the platforms are today', () => {
        expect(found.filter((entry) => entry.code === 'D110')).toEqual([
            { code: 'D110', file: 'src/components/SearchBox.tsx', to: 'sources/netease/core/transport.ts' },
            { code: 'D110', file: 'src/hooks/useKugou.ts', to: 'src/services/onlineMusic/kugou/kugouTransport.ts' },
        ]);
    });

    it('lets through a source\'s own files, the kit, the web adapter\'s core, and the host\'s type-only reference', () => {
        const allowed = ['sources/netease/', 'src/services/onlineMusic/web/netease.ts', 'src/services/onlineMusic/typesOnly.ts', 'src/utils/errorText.ts'];
        expect(found.filter((entry) => allowed.some((prefix) => entry.file.startsWith(prefix)))).toEqual([]);
        expect(found.map((entry) => entry.code).sort()).toEqual(['D110', 'D110', 'D130', 'D130', 'D130', 'D131', 'D131', 'D132', 'D132']);
    });

    it('puts the kit in the graph through its alias', () => {
        const graph = buildModuleGraph(root);
        expect([...(graph.forward.get('sources/netease/core/index.ts') ?? [])]).toEqual(['packages/folium-source-kit/src/index.ts']);
        expect([...(graph.forward.get('src/utils/errorText.ts') ?? [])]).toEqual(['packages/folium-source-kit/src/index.ts']);
    });
});

// The module graph does not read `require()`, so the main process (electron/, shared/: CommonJS) is scanned as text.
const SOURCE_REQUIRE = /\brequire\(\s*['"]([^'"]*\bsources\/[^'"]*)['"]\s*\)/g;
const sourceRequires = (text: string) => [...text.matchAll(SOURCE_REQUIRE)].map((match) => match[1]);
const REPO = path.resolve(__dirname, '../../..');
const commonJsFiles = (dir: string): string[] => readdirSync(path.join(REPO, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : commonJsFiles(relative);
    return /\.(cjs|js)$/.test(entry.name) ? [relative] : [];
});

describe('D131 in the main process, where require is read as text', () => {
    it('finds a require of sources/ in a planted file', () => {
        expect(sourceRequires(files['electron/legacyBridge.cjs'])).toEqual(['../sources/netease/core/index']);
        expect(sourceRequires("const a = require('./resources/x');\nconst b = require('electron');\n")).toEqual([]);
    });

    it('finds none in electron/ and shared/: the main process reaches a source only through the mod runtime', () => {
        const found = ['electron', 'shared'].flatMap(commonJsFiles)
            .flatMap((file) => sourceRequires(readFileSync(path.join(REPO, file), 'utf8')).map((target) => `${file} → ${target}`));
        expect(found).toEqual([]);
    });
});
