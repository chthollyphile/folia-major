import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { packageEntry } from '../../../dev/sources/dependencies.mjs';

// test/unit/sources/packageEntry.test.ts
// dev/sources/dependencies.mjs 的 packageEntry：vendor 文件的入口和 file: 包按它找文件。子路径写在 exports 里的包
// （googlevideo/sabr-stream、bgutils-js/botguard，YouTube Music 的 main 入口用到）按 exports 找，exports 里没有的子路径
// 仍是包目录下的那个文件。

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-package-entry-'));
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const write = (pkg: Record<string, unknown>) => {
    const at = fs.mkdtempSync(path.join(dir, 'pkg-'));
    fs.writeFileSync(path.join(at, 'package.json'), JSON.stringify(pkg));
    return at;
};

const NODE = ['node', 'import', 'module'];

describe('packageEntry', () => {
    it('finds a subpath the exports map names, by the conditions given', () => {
        const at = write({ name: 'p', exports: {
            '.': { import: './dist/index.js' },
            './sabr-stream': { types: './dist/sabr-stream.d.ts', import: './dist/exports/sabr-stream.js', default: './dist/exports/sabr-stream.cjs' },
        } });
        expect(packageEntry(at, 'sabr-stream', NODE)).toBe(path.join(at, 'dist/exports/sabr-stream.js'));
        expect(packageEntry(at, 'sabr-stream', ['require'])).toBe(path.join(at, 'dist/exports/sabr-stream.cjs'));
        expect(packageEntry(at, '', NODE)).toBe(path.join(at, 'dist/index.js'));
    });

    it('joins a subpath the exports map does not name, and one of a package without exports', () => {
        const named = write({ name: 'p', exports: { '.': './index.js' } });
        expect(packageEntry(named, 'lib/x.js', NODE)).toBe(path.join(named, 'lib/x.js'));
        const plain = write({ name: 'p', main: 'main.js' });
        expect(packageEntry(plain, 'lib/x.js', NODE)).toBe(path.join(plain, 'lib/x.js'));
        expect(packageEntry(plain, '', NODE)).toBe(path.join(plain, 'main.js'));
    });

    it('reads a conditions object as the package’s own entry, as before', () => {
        const at = write({ name: 'p', exports: { node: './node.js', default: './browser.js' }, main: 'main.js' });
        expect(packageEntry(at, '', NODE)).toBe(path.join(at, 'node.js'));
        expect(packageEntry(at, '', ['browser'])).toBe(path.join(at, 'browser.js'));
    });
});
