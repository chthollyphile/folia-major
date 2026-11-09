import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// test/unit/dedicatus/contracts/packageIndependence.test.ts
// D308：packages/ 下的包（现在只有 Coven harness，packages/coven/）以后要原样拆成独立仓库，
// 所以只能 import 包内的文件和 Node 内置模块（`node:` 开头），运行时也不能有依赖。项目的东西走适配层，
// 由宿主仓库在配置里指过去，包自己不知道。包的 test/ 目录例外：测试可以用 vitest。
// 动态 import 只在两处出现：host.mjs 按配置加载适配层，bin/coven.mjs 按命令加载模块。

const ROOT = path.resolve(__dirname, '../../../..');
const PACKAGES = path.join(ROOT, 'packages');
const SOURCE = /\.(mjs|js|cjs|ts|mts|cts)$/;
/** 静态的 import / export from / 字面量的 import() / require()。 */
const SPECIFIERS = [
    /(?<![\w.'"`])import\s*(?:[^'"`;()]*?\bfrom\s*)?['"]([^'"]+)['"]/g,
    /(?<![\w.'"`])export\s*[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
];
/** 读文件时用 new URL('…', import.meta.url) 拼出的路径也不能出包。 */
const URL_PATHS = /\bnew\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g;
/** 绕过上面这些检查的写法：一律不许。 */
const FORBIDDEN = [
    { pattern: /\bcreateRequire\b/, why: 'createRequire（能 require 任何东西）' },
    { pattern: /\bimport\.meta\.resolve\b/, why: 'import.meta.resolve' },
    { pattern: /\bimport\s*\(\s*`/, why: '模板字符串的 import()' },
];
/** 动态的 import(变量) 只允许出现在这两个文件里。 */
const DYNAMIC_IMPORT_ALLOWED = ['src/host.mjs', 'bin/coven.mjs'];

function filesUnder(dir: string, packageDir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const full = path.join(dir, name);
        if (name === 'node_modules' || full === path.join(packageDir, 'test')) return [];
        return statSync(full).isDirectory() ? filesUnder(full, packageDir) : SOURCE.test(name) ? [full] : [];
    });
}

/** 一个源文件里引用了包外东西的地方。 */
function escapes(file: string, packageDir: string, text: string): string[] {
    const found: string[] = [];
    const outside = (specifier: string) => !path.resolve(path.dirname(file), specifier).startsWith(packageDir + path.sep);
    for (const pattern of SPECIFIERS) {
        for (const match of text.matchAll(pattern)) {
            const specifier = match[1];
            if (specifier.startsWith('node:')) continue;
            if (specifier.startsWith('.')) {
                if (outside(specifier)) found.push(`${specifier}（出了包）`);
                continue;
            }
            found.push(`${specifier}（包外的依赖）`);
        }
    }
    for (const match of text.matchAll(URL_PATHS)) {
        if (!match[1].startsWith('.') || outside(match[1])) found.push(`new URL('${match[1]}')（出了包）`);
    }
    for (const { pattern, why } of FORBIDDEN) if (pattern.test(text)) found.push(why);
    const relative = path.relative(packageDir, file).replace(/\\/g, '/');
    if (/\bimport\s*\(\s*[^'"`\s)]/.test(text) && !DYNAMIC_IMPORT_ALLOWED.includes(relative)) found.push('import(变量)（只有 host.mjs、bin/coven.mjs 能动态加载）');
    return found;
}

describe('D308 packages only import their own files and node built-ins', () => {
    const packages = readdirSync(PACKAGES).filter(name => statSync(path.join(PACKAGES, name)).isDirectory());

    it('has the Coven harness under packages/', () => {
        expect(packages).toContain('coven');
    });

    it.each(packages)('packages/%s stays self-contained', name => {
        const packageDir = path.join(PACKAGES, name);
        const problems = filesUnder(packageDir, packageDir).flatMap(file => escapes(file, packageDir, readFileSync(file, 'utf8')).map(problem => `${path.relative(ROOT, file)}：${problem}`));
        expect(problems, 'D308：包里只能 import 包内的文件和 node: 内置模块，项目的东西走适配层').toEqual([]);
    });

    it.each(packages)('packages/%s has no runtime dependencies', name => {
        const pkg = JSON.parse(readFileSync(path.join(PACKAGES, name, 'package.json'), 'utf8'));
        expect(Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies }), 'D308：运行时零依赖，开发依赖写 devDependencies').toEqual([]);
    });

    it('catches the ways a package could reach into the host repository', () => {
        const packageDir = path.join(PACKAGES, 'coven');
        const file = path.join(packageDir, 'src', 'x.mjs');
        const sample = [
            "import { a } from '../../../dev/dedicatus/baseline.mjs';",
            "import b from 'lodash';",
            "import c from 'node:fs';",
            "import d from './y.mjs';",
            "import{e}from'../../../src/e.ts';",
            "export{f}from'../../../src/f.ts';",
            'const g = await import(`../../../dev/${name}.mjs`);',
            'const h = await import(somePath);',
            'const req = createRequire(import.meta.url);',
            "const i = import.meta.resolve('lodash');",
            "const j = readFileSync(new URL('../../../dev/coven/config.json', import.meta.url));",
            "const k = readFileSync(new URL('../roles/planner.md', import.meta.url));",
            "const l = await import ('../../../dev/x.mjs');",
            "const m = readFileSync(new URL('/etc/passwd', import.meta.url));",
        ].join('\n');
        expect(escapes(file, packageDir, sample)).toEqual([
            '../../../dev/dedicatus/baseline.mjs（出了包）',
            'lodash（包外的依赖）',
            '../../../src/e.ts（出了包）',
            '../../../src/f.ts（出了包）',
            '../../../dev/x.mjs（出了包）',
            "new URL('../../../dev/coven/config.json')（出了包）",
            "new URL('/etc/passwd')（出了包）",
            'createRequire（能 require 任何东西）',
            'import.meta.resolve',
            '模板字符串的 import()',
            'import(变量)（只有 host.mjs、bin/coven.mjs 能动态加载）',
        ]);
    });
});
