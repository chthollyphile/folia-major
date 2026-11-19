import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// dev/stemSplit/run.mjs
// 原型的启动脚本：把 page.ts 打包进临时目录，写好 index.html，再用仓库里的 Electron 打开 main.cjs。
// 参数原样传给 Electron（第一个音频路径会被预先填好）。

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const out = path.join(os.tmpdir(), 'folia-stem-split', 'app');
fs.mkdirSync(out, { recursive: true });

const cli = path.join(root, 'node_modules', 'rolldown', 'bin', 'cli.mjs');
const bundled = spawnSync(process.execPath, [cli, path.join(here, 'page.ts'), '-o', path.join(out, 'page.js'), '-f', 'iife', '-p', 'browser'], { stdio: 'inherit' });
if (bundled.status !== 0) process.exit(bundled.status ?? 1);
fs.copyFileSync(path.join(here, 'index.html'), path.join(out, 'index.html'));

const electron = createRequire(import.meta.url)('electron');
const child = spawn(electron, [path.join(here, 'main.cjs'), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, STEM_OUT_DIR: out },
});
child.on('exit', code => process.exit(code ?? 0));
