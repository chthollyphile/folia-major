import fs from 'node:fs';
import path from 'node:path';
import { checkFoliumMod } from '../check.mjs';

// Bound static analysis in a separate process; no submitted module is imported or executed.
const directory = path.resolve(process.argv[2]);
let count = 0, bytes = 0;
function inspect(file, depth = 0) {
    if (++count > 600 || depth > 24) throw new Error('MCP analysis limit: at most 600 entries and 24 directory levels.');
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error('MCP analysis rejects symbolic links.');
    if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(file)) inspect(path.join(file, entry), depth + 1);
    } else if (stat.isFile()) {
        bytes += stat.size;
        if (bytes > 16 * 1024 * 1024) throw new Error('MCP analysis limit: 16 MiB total. Use the existing CLI for larger mods.');
    } else throw new Error('MCP analysis accepts regular files and directories only.');
}
try {
    if (!fs.lstatSync(directory).isDirectory()) throw new Error('Expected a mod directory containing mod.json.');
    inspect(directory);
    const result = checkFoliumMod(directory);
    console.log(JSON.stringify({ valid: result.ok, accepted: false, execution: 'not run', checker: 'dev/folium/check.mjs',
        issues: result.problems, notes: result.notes, warnings: result.warnings,
        manifest: result.manifest && { id: result.manifest.id, version: result.manifest.version, permissions: result.manifest.permissions },
        next: 'Validate runtime and continuous visuals in desktop Folia. Trust confirmation, dependencies and signature acceptance belong to the existing mod host.' }));
} catch (error) { console.log(JSON.stringify({ valid: false, accepted: false, execution: 'not run', issues: [error.message] })); }
