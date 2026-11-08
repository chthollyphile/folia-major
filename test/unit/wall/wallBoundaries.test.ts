import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// test/unit/wall/wallBoundaries.test.ts
// 共享 wall 引擎（src/components/wall）与内容无关：Lattice 和资料库 suite 都 import 它，它不能反过来依赖
// 任何一方——不碰 components/app（Lattice 在 components/app/lattice）和 src/library。与 Dedicatus 的
// BOUNDARY_RULES（dev/dedicatus/rules.mjs）同一条规则；这里连 `import type` 一起查，类型依赖同样会把两边绑死。

const ROOT = path.resolve(__dirname, '../../..');
const WALL = 'src/components/wall';

const listSources = (dir: string): string[] => readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    .flatMap(entry => {
        const relative = path.posix.join(dir, entry.name);
        if (entry.isDirectory()) return listSources(relative);
        return /\.tsx?$/.test(entry.name) ? [relative] : [];
    });

/** 值导入、`import type`、re-export 和动态 import() 的全部模块说明符。 */
const specifiersOf = (file: string) => {
    const source = readFileSync(path.join(ROOT, file), 'utf8');
    return [
        ...[...source.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+'([^']+)';/gms)].map(match => match[1]),
        ...[...source.matchAll(/^\s*import\s+'([^']+)';/gm)].map(match => match[1]),
        ...[...source.matchAll(/\bimport\(\s*'([^']+)'\s*\)/g)].map(match => match[1]),
    ];
};

const resolveSpecifier = (file: string, specifier: string) => {
    if (specifier.startsWith('@/')) return `src/${specifier.slice(2)}`;
    if (!specifier.startsWith('.')) return specifier;
    return path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
};

describe('shared wall engine boundaries', () => {
    const files = listSources(WALL);

    it('finds the wall engine where the rule expects it', () => {
        expect(files.length).toBeGreaterThan(0);
    });

    it('does not depend on Lattice, the app layer or the library', () => {
        const offenders = files.flatMap(file => specifiersOf(file)
            .filter(specifier => /^src\/(components\/app|library)\//.test(resolveSpecifier(file, specifier)))
            .map(specifier => `${file} -> ${specifier}`));
        expect(offenders).toEqual([]);
    });
});
