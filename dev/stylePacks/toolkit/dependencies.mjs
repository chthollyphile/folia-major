import { cp, readFile, access } from 'node:fs/promises';
import path from 'node:path';

// Copy the installed runtime dependency closure, preserving npm's nested resolution and licenses.
export async function copyDependencies(root, destination, entries) {
    root = path.resolve(root);
    const modules = path.join(root, 'node_modules');
    const copied = new Map();
    async function locate(name, from) {
        for (let cursor = from; cursor.startsWith(root); cursor = path.dirname(cursor)) {
            const candidate = path.join(cursor, 'node_modules', name);
            try { await access(path.join(candidate, 'package.json')); return candidate; } catch { /* Try parent. */ }
            if (cursor === root) break;
        }
        return null;
    }
    async function visit(name, from, optional = false) {
        const directory = await locate(name, from);
        if (!directory) { if (optional) return; throw new Error(`Missing runtime dependency: ${name}`); }
        if (copied.has(directory)) return;
        const relative = path.relative(modules, directory);
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Dependency escaped node_modules');
        const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
        if ((pkg.os && !pkg.os.includes('win32')) || (pkg.cpu && !pkg.cpu.includes('x64'))) {
            if (optional) return;
            throw new Error(`Unsupported Windows x64 dependency: ${name}`);
        }
        copied.set(directory, { name: pkg.name, version: pkg.version, license: pkg.license, path: relative.replaceAll('\\', '/') });
        await cp(directory, path.join(destination, 'node_modules', relative), { recursive: true,
            filter: source => source === directory || !path.relative(directory, source).split(path.sep).includes('node_modules') });
        const deps = { ...pkg.dependencies, ...pkg.optionalDependencies };
        for (const [peer] of Object.entries(pkg.peerDependencies ?? {})) {
            if (!pkg.peerDependenciesMeta?.[peer]?.optional) deps[peer] ??= '*';
        }
        for (const dep of Object.keys(deps)) await visit(dep, directory, Object.hasOwn(pkg.optionalDependencies ?? {}, dep));
    }
    for (const name of entries) await visit(name, root);
    return [...copied.values()].sort((a, b) => a.path.localeCompare(b.path));
}
