import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// test/unit/sources/depsArchiveSamples.test.ts
// 依赖归档样例（test/fixtures/folium-sources/deps-archive/）钉的上游版本要和根 package.json 的一致：构建按样例钉的版本核对
// 装着的包，升级上游时只改了根 package.json 的话，样例构建会报版本不符，而它的 CI 冒烟不一定在那个 PR 上跑。这里先报出来。

const ROOT = path.resolve(__dirname, '../../..');
const SAMPLES = path.join(ROOT, 'test/fixtures/folium-sources/deps-archive');
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as {
    dependencies?: Record<string, string>;
    folia?: { dependencies?: Record<string, string> };
};

const rootDependencies = readJson(path.join(ROOT, 'package.json')).dependencies ?? {};
const samples = fs.readdirSync(SAMPLES).filter((name) => fs.existsSync(path.join(SAMPLES, name, 'mod.json')));

describe('deps archive samples', () => {
    it('are the three upstream libraries the plan names', () => {
        expect(samples.sort()).toEqual(['kugou', 'netease', 'qq']);
    });

    it.each(samples)('%s pins its upstream as the root package.json does, and takes it from a deps archive', (name) => {
        const pkg = readJson(path.join(SAMPLES, name, 'package.json'));
        const dependencies = Object.entries(pkg.dependencies ?? {});
        expect(dependencies).toHaveLength(1);
        for (const [dependency, spec] of dependencies) {
            expect(spec, `${dependency}: 样例钉的版本和根 package.json 不同，升级上游时一起改`).toBe(rootDependencies[dependency]);
            expect(pkg.folia?.dependencies?.[dependency]).toBe('asar');
        }
    });
});
