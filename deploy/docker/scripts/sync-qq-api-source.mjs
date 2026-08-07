import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 当前文件：把 qq-music-api 仓库的可构建源码同步进 deploy/docker/qq-api/source，并支持漂移检查。
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..', '..');
const vendorDir = path.join(repoRoot, 'deploy', 'docker', 'qq-api', 'source');
const manifestPath = path.join(vendorDir, 'VENDOR.json');

// 镜像构建只需要这些路径；tests、docs、biome/jest 配置不进 vendor 副本。
const VENDORED_FILES = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.build.json',
  'scripts/prepare-runtime-assets.js',
];
const VENDORED_DIRS = ['src', 'public'];
// packaging/build-qq-api-bundle.mjs 会在 vendor 副本里装运行时依赖来打 Electron bundle。
// 这份 node_modules 已被 .gitignore 和镜像的 .dockerignore 排除，漂移检查也必须无视它，
// 否则「打完 bundle 再跑 --check」必然失败。
const UNTRACKED_IN_VENDOR = ['node_modules/'];

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const positional = args.filter((value) => !value.startsWith('--'));
const sourceDir = path.resolve(
  positional[0] || process.env.QQ_MUSIC_API_DIR || path.join(repoRoot, '..', 'qq-music-api'),
);

// 相对路径统一用 `/`，避免 Windows 与 CI 的分隔符差异让漂移检查误报。
const listFiles = (root, relative = '') => {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) {
    return [];
  }
  if (fs.statSync(absolute).isFile()) {
    return [relative];
  }
  return fs
    .readdirSync(absolute, { withFileTypes: true })
    .flatMap((entry) => listFiles(root, relative ? `${relative}/${entry.name}` : entry.name));
};

// Windows 上 core.autocrlf=true 会在检出时把 vendor 副本换成 CRLF，而 qq-music-api 工作树是 LF，
// 逐字节比较会让每个文本文件都误报漂移。索引里存的是 LF，所以按 LF 归一化后再比才是真实差异。
// 二进制文件（含 NUL 字节）不归一化，仍走逐字节比较。
const isProbablyBinary = (buffer) => buffer.includes(0);
const normalizeEol = (buffer) => buffer.toString('utf8').replaceAll('\r\n', '\n');

const contentMatches = (sourcePath, vendoredPath) => {
  const source = fs.readFileSync(sourcePath);
  const vendored = fs.readFileSync(vendoredPath);
  if (source.equals(vendored)) {
    return true;
  }
  if (isProbablyBinary(source) || isProbablyBinary(vendored)) {
    return false;
  }
  return normalizeEol(source) === normalizeEol(vendored);
};

const collectSourceFiles = () => [
  ...VENDORED_FILES,
  ...VENDORED_DIRS.flatMap((directory) => listFiles(sourceDir, directory)),
];

const readSourceProvenance = () => {
  const run = (...gitArgs) =>
    execFileSync('git', ['-C', sourceDir, ...gitArgs], { encoding: 'utf8' }).trim();
  try {
    return { commit: run('rev-parse', 'HEAD'), branch: run('rev-parse', '--abbrev-ref', 'HEAD') };
  } catch {
    return { commit: 'unknown', branch: 'unknown' };
  }
};

const missingSourceMessage = `qq-music-api source not found at ${sourceDir}. Pass the path as the first argument or set QQ_MUSIC_API_DIR.`;

if (checkOnly) {
  if (!fs.existsSync(sourceDir)) {
    console.log(`Skipped drift check: ${missingSourceMessage}`);
    process.exit(0);
  }

  const sourceFiles = collectSourceFiles();
  const vendoredFiles = listFiles(vendorDir).filter(
    (file) =>
      file !== 'VENDOR.json' && !UNTRACKED_IN_VENDOR.some((prefix) => file.startsWith(prefix)),
  );
  const drifted = [];

  for (const relative of sourceFiles) {
    const vendored = path.join(vendorDir, relative);
    if (!fs.existsSync(vendored)) {
      drifted.push(`missing in vendor: ${relative}`);
      continue;
    }
    if (!contentMatches(path.join(sourceDir, relative), vendored)) {
      drifted.push(`content differs: ${relative}`);
    }
  }

  for (const relative of vendoredFiles) {
    if (!sourceFiles.includes(relative)) {
      drifted.push(`stale in vendor: ${relative}`);
    }
  }

  if (drifted.length) {
    console.error(`deploy/docker/qq-api/source is out of sync with ${sourceDir}:`);
    for (const entry of drifted) {
      console.error(`  ${entry}`);
    }
    console.error('Run: node deploy/docker/scripts/sync-qq-api-source.mjs');
    process.exit(1);
  }

  console.log(`deploy/docker/qq-api/source matches ${sourceDir} (${sourceFiles.length} files)`);
  process.exit(0);
}

if (!fs.existsSync(sourceDir)) {
  throw new Error(missingSourceMessage);
}

fs.rmSync(vendorDir, { recursive: true, force: true });
fs.mkdirSync(vendorDir, { recursive: true });

for (const relative of VENDORED_FILES) {
  const from = path.join(sourceDir, relative);
  if (!fs.existsSync(from)) {
    throw new Error(`Required qq-music-api file is missing: ${relative}`);
  }
  const to = path.join(vendorDir, relative);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

for (const directory of VENDORED_DIRS) {
  fs.cpSync(path.join(sourceDir, directory), path.join(vendorDir, directory), { recursive: true });
}

const provenance = readSourceProvenance();
fs.writeFileSync(
  manifestPath,
  `${JSON.stringify(
    {
      source: 'qq-music-api',
      branch: provenance.branch,
      commit: provenance.commit,
      files: VENDORED_FILES,
      directories: VENDORED_DIRS,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

console.log(
  `Vendored ${collectSourceFiles().length} files from ${sourceDir} (${provenance.branch} @ ${provenance.commit.slice(0, 7)})`,
);
