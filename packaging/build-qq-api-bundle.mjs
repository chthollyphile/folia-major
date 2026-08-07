import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

// 当前文件：把 vendored 的 qq-music-api 打包成 Electron 主进程可 require 的单一 CJS 文件。
// 打成一个自带依赖的 bundle，folia-major 的 package.json 因此不需要新增 koa/zod/moment 等运行时依赖，
// 也避开 qq-music-api 需要 ws@7、folia-major 用 ws@8 的版本冲突。
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const sourceDir = path.join(repoRoot, 'deploy', 'docker', 'qq-api', 'source');
const entryPoint = path.join(sourceDir, 'src', 'app.ts');
const outFile = path.join(repoRoot, 'electron', 'vendor', 'qqMusicApi.cjs');
const licenseFile = path.join(repoRoot, 'deploy', 'docker', 'qq-api', 'LICENSE');
const outLicenseFile = path.join(repoRoot, 'electron', 'vendor', 'qqMusicApi.LICENSE');

if (!fs.existsSync(entryPoint)) {
  throw new Error(
    `Vendored qq-music-api source is missing at ${sourceDir}. Run: node deploy/docker/scripts/sync-qq-api-source.mjs`,
  );
}

// 只装运行时依赖：bundle 不需要 typescript/jest，esbuild 自己转译 TS。
if (!fs.existsSync(path.join(sourceDir, 'node_modules'))) {
  console.log('Installing qq-music-api runtime dependencies for bundling...');
  // 固定命令字符串走 shell：Node 20+ 的 Windows 不允许直接 spawn npm.cmd。
  execSync('npm ci --omit=dev --no-audit --no-fund', { cwd: sourceDir, stdio: 'inherit' });
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });

// bundle 会随 Electron 安装包分发，MIT 要求分发时附上版权声明与许可证全文。
// 许可证既写进 bundle 顶部（跟着代码走，产物本身自带声明），也落一份同名 sidecar 文件；
// 两者都在 electron/ 下，被 package.json 的 `electron/**/*` 打包规则覆盖。
if (!fs.existsSync(licenseFile)) {
  throw new Error(`Third-party license is missing at ${licenseFile}; refusing to build an unlicensed bundle.`);
}

const licenseText = fs.readFileSync(licenseFile, 'utf8').trimEnd();
const attribution = [
  'Bundled third-party software: qq-music-api (modified copy)',
  'Upstream: https://github.com/Rain120/qq-music-api',
  'Vendored from: deploy/docker/qq-api/source (see deploy/docker/qq-api/README.md)',
  'Licensed under the MIT License, reproduced in full below.',
].join('\n');

fs.writeFileSync(outLicenseFile, `${attribution}\n\n${licenseText}\n`, 'utf8');

const result = await esbuild.build({
  entryPoints: [entryPoint],
  outfile: outFile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  // ws 的可选原生加速模块用 try/catch require，缺席是正常的。
  external: ['bufferutil', 'utf-8-validate'],
  banner: {
    js: `/*\n${attribution}\n\n${licenseText}\n*/`,
  },
  // 注释掉的许可证 banner 不能被压缩掉，这里本来就不 minify，显式保留以防以后开启。
  legalComments: 'inline',
  logLevel: 'warning',
  metafile: true,
});

const bytes = fs.statSync(outFile).size;
const inputCount = Object.keys(result.metafile.outputs[
  path.relative(process.cwd(), outFile).split(path.sep).join('/')
]?.inputs ?? {}).length;
console.log(
  `Bundled qq-music-api -> ${path.relative(repoRoot, outFile)} (${(bytes / 1024 / 1024).toFixed(2)} MB, ${inputCount} modules)`,
);
console.log(`Third-party MIT notice -> ${path.relative(repoRoot, outLicenseFile)}`);
