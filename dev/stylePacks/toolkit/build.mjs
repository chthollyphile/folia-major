import { cp, readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMakeNsisPath } from 'app-builder-lib/out/toolsets/windows.js';
import { copyDependencies } from './dependencies.mjs';
import { stageNode } from './runtime.mjs';
import { documents, sources } from '../mcp/content.mjs';

// Build a per-user Windows installer, with a private Node runtime and no dependency on this checkout.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const release = JSON.parse(await readFile(new URL('./release.json', import.meta.url), 'utf8'));
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build this Windows x64 toolkit on Windows x64.');
const output = path.join(root, 'release/style-tools');
await mkdir(output, { recursive: true });
// A fresh staging directory avoids mixing stale code or user files into subsequent installers.
const stage = path.join(output, `stage-${Date.now()}`);
const app = path.join(stage, 'app');
await mkdir(app, { recursive: true });
const run = (command, args, options = {}) => {
    const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status})`);
};
run(process.execPath, ['dev/stylePacks/build.mjs']);
for (const directory of ['dev/stylePacks', 'src/stylePacks', 'skills/folia-style-art-direction']) {
    await cp(path.join(root, directory), path.join(app, directory), { recursive: true });
}
for (const name of new Set([...Object.values(documents).map(info => info.path),
    ...Object.values(sources).flat().map(file => `src/components/visualizer/${file}`),
    'docs/style-pack-mcp.md', 'docs/style-tools-installation.md', 'LICENSE'])) {
    await mkdir(path.dirname(path.join(app, name)), { recursive: true });
    await cp(path.join(root, name), path.join(app, name));
}
await cp(path.join(root, 'dist-style-studio'), path.join(app, 'studio'), { recursive: true,
    filter: source => !path.relative(path.join(root, 'dist-style-studio'), source).split(path.sep).includes('mcp-clients') });
await writeFile(path.join(app, 'package.json'), JSON.stringify({ name: 'folia-style-tools', version: release.version, type: 'module', license: 'AGPL-3.0-only', private: true }, null, 2));
const dependencies = await copyDependencies(root, app, ['@modelcontextprotocol/sdk', 'vite']);
const node = await stageNode(release.nodeVersion, path.join(root, 'build/style-tools-cache'), path.join(stage, 'runtime'));
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).stdout.trim();
await writeFile(path.join(stage, 'release.json'), JSON.stringify({ ...release, baseRevision: revision, workingTree: true, node, dependencies }, null, 2));
await cp(path.join(root, 'docs/style-tools-installation.md'), path.join(stage, 'README.md'));
await cp(path.join(root, 'LICENSE'), path.join(stage, 'LICENSE.txt'));
await writeFile(path.join(stage, 'folia-style.cmd'), '@echo off\r\n"%~dp0runtime\\node.exe" "%~dp0app\\dev\\stylePacks\\toolkit\\cli.mjs" %*\r\nexit /b %errorlevel%\r\n');
const files = [];
async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(file);
        else files.push(path.relative(stage, file));
    }
}
await walk(stage);
const hashes = [];
for (const file of files) hashes.push(`${createHash('sha256').update(await readFile(path.join(stage, file))).digest('hex')}  ${file.replaceAll('\\', '/')}`);
await writeFile(path.join(stage, 'SHA256SUMS.txt'), hashes.join('\n') + '\n');
files.push('SHA256SUMS.txt');
// Exact-file uninstall preserves projects, logs and any other files the user added to the directory.
const nsisQuote = value => value.replaceAll('$', '$$').replaceAll('"', '$\\"');
const directories = new Set();
for (const file of files) {
    for (let directory = path.dirname(file); directory !== '.'; directory = path.dirname(directory)) directories.add(directory);
}
const removal = files.map(file => `Delete "$INSTDIR\\${nsisQuote(file)}"`).concat([...directories].sort((a, b) => b.length - a.length).map(directory => `RMDir "$INSTDIR\\${nsisQuote(directory)}"`));
await writeFile(path.join(output, 'uninstallFiles.nsh'), removal.join('\n') + '\n');
const installer = path.join(output, `Folia-Style-Tools-${release.version}-win-x64-Setup.exe`);
const compiler = await getMakeNsisPath('0.0.0');
run(compiler.path, ['/V2', '/INPUTCHARSET', 'UTF8', `/DSTAGE=${stage}`, `/DOUTPUT=${installer}`, `/DVERSION=${release.version}`, `/DWIN_VERSION=${release.windowsVersion}`,
    `/DREMOVE_FILES=${path.join(output, 'uninstallFiles.nsh')}`, path.join(root, 'dev/stylePacks/toolkit/installer.nsi')], { env: { ...process.env, ...compiler.env } });
const sha256 = createHash('sha256').update(await readFile(installer)).digest('hex');
await writeFile(`${installer}.sha256`, `${sha256}  ${path.basename(installer)}\n`);
await writeFile(path.join(output, 'latest.json'), JSON.stringify({ installer, stage, sha256, bytes: (await stat(installer)).size }, null, 2));
console.info(JSON.stringify({ installer, sha256, dependencies: dependencies.length }));
