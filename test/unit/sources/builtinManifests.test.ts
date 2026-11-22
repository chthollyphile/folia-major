import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkBuiltinSourceDir, checkBuiltinSources } from '../../../dev/sources/manifestCheck.mjs';

// test/unit/sources/builtinManifests.test.ts
// 内置音源的清单校验（Folium 2.0 方案 §10「另加一个内置清单校验测试」）：sampleMods.test.ts 只扫 mods/ 的签名，
// sources/ 不签名，这里扫 sources/*/mod.json。还没有音源时 sources/ 是空集，所以下面用构建夹具证明每一条都会报。

const ROOT = path.resolve(__dirname, '../../..');
const FIXTURE = path.join(ROOT, 'test/fixtures/folium-sources/fixture-source');
/** 把夹具当成受信表里的一行：模组 fixture-source 认领短 id probe。 */
const TABLE = { 'fixture-source': { sources: ['probe'] } };

let work: string;
beforeAll(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-builtin-manifests-'));
});
afterAll(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

/** 夹具拷到 `<临时>/<目录名>`，`edit` 改它。 */
const copy = (dirName: string, edit: (dir: string) => void = () => {}) => {
    const dir = path.join(fs.mkdtempSync(path.join(work, 'case-')), dirName);
    fs.cpSync(FIXTURE, dir, { recursive: true });
    edit(dir);
    return dir;
};
const editJson = (file: string, change: (value: Record<string, unknown>) => void) => {
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    change(value);
    fs.writeFileSync(file, JSON.stringify(value));
};

describe('the manifests of the built-in sources in sources/', () => {
    it('all pass', () => {
        expect(Object.fromEntries(checkBuiltinSources(path.join(ROOT, 'sources')))).toEqual({});
    });
});

describe('the built-in manifest check catches', () => {
    it('nothing in a source the trusted table names, in the folder of its short id', () => {
        const dir = copy('probe');
        expect(checkBuiltinSourceDir(dir, { table: TABLE })).toEqual([]);
    });

    it('a mod the trusted table does not know', () => {
        expect(checkBuiltinSourceDir(FIXTURE)).toEqual([expect.stringContaining('模组 id "fixture-source" 不在受信表里')]);
    });

    it('a folder that is not named after its short id', () => {
        expect(checkBuiltinSourceDir(FIXTURE, { table: TABLE })).toEqual([expect.stringContaining('目录名 "fixture-source" 不是受信表里 fixture-source 那一行的短音源 id')]);
    });

    it('sources that differ from the row of the table', () => {
        const dir = copy('probe', (target) => editJson(path.join(target, 'mod.json'), (manifest) => {
            (manifest.sources as Record<string, unknown>[])[0].id = 'other';
        }));
        expect(checkBuiltinSourceDir(dir, { table: TABLE })).toEqual(['sources 少了受信表里的 probe', 'sources 多了受信表里没有的 other']);
    });

    it('a name not given in every language, a locale file missing, a hand-written zh-TW, a signature file', () => {
        const dir = copy('probe', (target) => {
            editJson(path.join(target, 'mod.json'), (manifest) => {
                (manifest.sources as Record<string, unknown>[])[0].name = { 'zh-CN': '夹具', en: 'Fixture' };
            });
            fs.rmSync(path.join(target, 'locales/vi.json'));
            fs.writeFileSync(path.join(target, 'locales/zh-TW.json'), '{}');
            fs.writeFileSync(path.join(target, 'folium.sig.json'), '{}');
        });
        expect(checkBuiltinSourceDir(dir, { table: TABLE })).toEqual([
            '音源 probe 的名字缺 in、vi',
            'locales/ 缺 vi.json',
            'locales/zh-TW.json 由构建从 zh-CN.json 生成，不手写',
            '内置副本不带签名文件（folium.sig.json）',
        ]);
    });

    it('a manifest the loader would refuse, or one that is not Folium 2', () => {
        const dir = copy('probe', (target) => editJson(path.join(target, 'mod.json'), (manifest) => {
            manifest.folium = 1;
        }));
        const problems = checkBuiltinSourceDir(dir, { table: TABLE });
        expect(problems).toContain('mod.json：folium 要是 2');
        expect(problems).toContain('mod.json："sources" needs "folium": 2');
    });

    it('a folder in sources/ without a mod.json', () => {
        const root = fs.mkdtempSync(path.join(work, 'root-'));
        fs.mkdirSync(path.join(root, 'half-moved', 'client'), { recursive: true });
        fs.mkdirSync(path.join(root, '.cache'));
        expect(Object.fromEntries(checkBuiltinSources(root))).toEqual({ 'half-moved': ['没有 mod.json'] });
    });
});
