import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// Resolve native Codex or npm's known JavaScript entry without executing a shell shim.
export function resolveCodex({ env = process.env, platform = process.platform, exists = existsSync } = {}) {
    const directories = (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean).map(item => item.replace(/^"|"$/g, ''));
    for (const directory of directories) {
        const native = path.join(directory, platform === 'win32' ? 'codex.exe' : 'codex');
        if (exists(native)) return { command: native, prefix: [] };
        if (platform !== 'win32' || !exists(path.join(directory, 'codex.cmd'))) continue;
        for (const entry of [path.join(directory, 'node_modules/@openai/codex/bin/codex.js'), path.resolve(directory, '../@openai/codex/bin/codex.js')]) {
            if (exists(entry)) return { command: process.execPath, prefix: [entry] };
        }
    }
    throw new Error('Codex CLI not found on PATH. Import the exported codex.stdio.toml manually.');
}
export function runCodex(params) {
    const { command, prefix } = resolveCodex();
    const result = spawnSync(command, [...prefix, ...params], { encoding: 'utf8', windowsHide: true, shell: false });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || 'Codex command failed');
    return result.stdout;
}
