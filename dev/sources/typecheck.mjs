#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// dev/sources/typecheck.mjs
// `npm run typecheck` 的后半段：音源模组和它们的共用包各按自己的 tsconfig 编译，不用根 tsconfig 的 `@/` 别名，
// 所以它们 import 宿主（src/、electron/）在这里就过不了类型检查（方案 §6.1：sources/ 只对着 mods/folium.d.ts 和 kit 编译）。
//   packages/folium-source-kit       只有 ES2022 与 DOM 的类型
//   sources/                         每个音源目录的 core/、client/、main/（还没有音源时跳过：tsc 没有输入会报错）
//   test/fixtures/folium-sources/    构建与测试夹具，规则同 sources/

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// typescript 的 exports 不开放 bin/，按它自己 package.json 的 bin 找。
const TYPESCRIPT = path.join(ROOT, 'node_modules', 'typescript');
const tsc = path.join(TYPESCRIPT, JSON.parse(fs.readFileSync(path.join(TYPESCRIPT, 'package.json'), 'utf8')).bin.tsc);

/** 一个目录下有没有音源目录（带 mod.json 的子目录）。 */
const hasSourceDirs = (dir) => fs.existsSync(dir) && fs.readdirSync(dir, { withFileTypes: true })
    .some((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'mod.json')));

const projects = [
    'packages/folium-source-kit/tsconfig.json',
    ...(hasSourceDirs(path.join(ROOT, 'sources')) ? ['sources/tsconfig.json'] : []),
    'test/fixtures/folium-sources/tsconfig.json',
];

let failed = false;
for (const project of projects) {
    const result = spawnSync(process.execPath, [tsc, '-p', project], { cwd: ROOT, stdio: 'inherit' });
    if (result.status !== 0) {
        console.error(`[typecheck] ${project} 没有通过`);
        failed = true;
    }
}
if (failed) process.exitCode = 1;
