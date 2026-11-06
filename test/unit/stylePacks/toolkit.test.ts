import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { copyDependencies } from '../../../dev/stylePacks/toolkit/dependencies.mjs';
import { resolveCodex } from '../../../dev/stylePacks/toolkit/codex.mjs';
import { exportSource } from '../../../dev/stylePacks/toolkit/source.mjs';

// Catch dependency staging failures that only surface when the install has no source checkout nearby.
describe('standalone toolkit dependencies', () => {
    it('preserves nested resolution, required peers and licenses from a trailing-slash root', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'folia-dependencies-'));
        const root = path.join(directory, 'source'), out = path.join(directory, 'out');
        const create = async (relative: string, pkg: object) => {
            const target = path.join(root, relative);
            await mkdir(target, { recursive: true });
            await writeFile(path.join(target, 'package.json'), JSON.stringify(pkg));
            await writeFile(path.join(target, 'LICENSE'), 'license fixture');
        };
        try {
            await create('node_modules/a', { name: 'a', version: '1', dependencies: { b: '*' }, peerDependencies: { peer: '*', absent: '*' },
                peerDependenciesMeta: { absent: { optional: true } }, optionalDependencies: { missing: '*' } });
            await create('node_modules/a/node_modules/b', { name: 'b', version: '2' });
            await create('node_modules/b', { name: 'b', version: '1' });
            await create('node_modules/peer', { name: 'peer', version: '1', dependencies: { b: '*' } });
            const manifest = await copyDependencies(root + path.sep, out, ['a']);
            expect(manifest).toHaveLength(4);
            expect(JSON.parse(await readFile(path.join(out, 'node_modules/a/node_modules/b/package.json'), 'utf8')).version).toBe('2');
            expect(JSON.parse(await readFile(path.join(out, 'node_modules/b/package.json'), 'utf8')).version).toBe('1');
            expect(await readFile(path.join(out, 'node_modules/peer/LICENSE'), 'utf8')).toBe('license fixture');
            await expect(copyDependencies(root, out, ['required-missing'])).rejects.toThrow('Missing runtime dependency');
        } finally { await rm(directory, { recursive: true, force: true }); }
    });
});

describe('standalone contribution and host compatibility', () => {
    it('exports source from a clean repository without changing its index', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'folia-clean-source-'));
        const git = (args: string[]) => {
            const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8', windowsHide: true });
            if (result.status !== 0) throw new Error(result.stderr);
            return result.stdout;
        };
        try {
            git(['init']);
            await writeFile(path.join(directory, '.gitignore'), 'release/\n');
            await writeFile(path.join(directory, 'README.md'), 'Source fixture\n');
            git(['add', '.']);
            // A commit only inside this disposable fixture, never the user's repository.
            git(['-c', 'user.name=Folia Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture']);
            const before = await readFile(path.join(directory, '.git/index'));
            await exportSource(directory);
            expect(await readFile(path.join(directory, 'release/style-tools/folia-style-tools.patch'), 'utf8')).toBe('');
            expect(JSON.parse(await readFile(path.join(directory, 'release/style-tools/contribution.json'), 'utf8')).files).toEqual([]);
            expect((await readFile(path.join(directory, '.git/index'))).equals(before)).toBe(true);
        } finally { await rm(directory, { recursive: true, force: true }); }
    });
    it('resolves native and npm-global/local Codex paths without invoking cmd or PowerShell', () => {
        const directory = path.resolve('fixture path with spaces');
        const native = path.join(directory, 'codex.exe');
        expect(resolveCodex({ env: { PATH: directory }, platform: 'win32', exists: file => file === native })).toEqual({ command: native, prefix: [] });
        for (const entry of [path.join(directory, 'node_modules/@openai/codex/bin/codex.js'), path.resolve(directory, '../@openai/codex/bin/codex.js')]) {
            const files = new Set([path.join(directory, 'codex.cmd'), entry]);
            expect(resolveCodex({ env: { PATH: directory }, platform: 'win32', exists: file => files.has(String(file)) })).toEqual({ command: process.execPath, prefix: [entry] });
        }
        expect(() => resolveCodex({ env: { PATH: directory }, platform: 'win32', exists: () => false })).toThrow('Codex CLI not found');
    });
});
