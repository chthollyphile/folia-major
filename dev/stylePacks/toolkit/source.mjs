import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { zipSync } from 'fflate';

// Export the corresponding working-tree source and a reviewable patch without changing the real index.
export async function exportSource(root = fileURLToPath(new URL('../../../', import.meta.url))) {
    const output = path.join(root, 'release/style-tools');
    await mkdir(output, { recursive: true });
    const git = (args, options = {}) => {
        const result = spawnSync('git', args, { cwd: root, windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...options });
        if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr.toString());
        return result.stdout;
    };
    const list = args => git([...args, '-z']).toString().split('\0').filter(Boolean);
    const tracked = list(['ls-files', '--cached']);
    const untracked = list(['ls-files', '--others', '--exclude-standard']);
    const allowed = file => /^(dev\/stylePacks\/|docs\/style-|skills\/folia-style-art-direction\/|src\/stylePacks\/|src\/components\/visualizer\/stylePack\/|style-packs\/|test\/unit\/stylePacks\/)/.test(file)
        || ['style-studio.html', 'src/components/command-palette/commands/stylePackCommands.ts', 'src/components/modal/settings/kit/GroupedPictureGrid.tsx', 'test/component/stylePackRuntime.spec.ts', '.github/workflows/style-tools.yml'].includes(file);
    const newFiles = untracked.filter(allowed);
    const ignored = untracked.filter(file => !allowed(file));
    const files = [...new Set([...tracked, ...newFiles])].sort();
    const archive = {};
    for (const file of files) {
        try { archive[`folia-major/${file}`] = new Uint8Array(await readFile(path.join(root, file))); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const release = JSON.parse(await readFile(new URL('./release.json', import.meta.url), 'utf8'));
    const filename = `Folia-Style-Tools-${release.version}-Source.zip`;
    const bytes = zipSync(archive, { level: 6 });
    await writeFile(path.join(output, filename), bytes);
    await writeFile(path.join(output, `${filename}.sha256`), `${createHash('sha256').update(bytes).digest('hex')}  ${filename}\n`);
    const index = path.join(output, `source-index-${Date.now()}`);
    const env = { ...process.env, GIT_INDEX_FILE: index };
    try {
        git(['read-tree', 'HEAD'], { env });
        const changed = list(['diff', 'HEAD', '--name-only']);
        const scope = [...new Set([...changed, ...newFiles])];
        if (scope.length) git(['add', '--all', '--pathspec-from-file=-', '--pathspec-file-nul'], { env, input: scope.join('\0') + '\0' });
        await writeFile(path.join(output, 'folia-style-tools.patch'), git(['diff', '--cached', '--binary', 'HEAD'], { env }));
        await writeFile(path.join(output, 'contribution.json'), JSON.stringify({ base: git(['rev-parse', 'HEAD']).toString().trim(), files: scope, excludedUntrackedFiles: ignored,
            source: filename, excludes: 'Ignored local wallpaper assets, generated packs, credentials, node_modules, output and recordings.' }, null, 2));
    } finally { await unlink(index).catch(() => {}); }
    console.info(`[StylePacks] Corresponding source and contribution patch: ${output}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await exportSource();
