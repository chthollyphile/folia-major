import { readFile, stat } from 'node:fs/promises';
import { MAX_PACK_BYTES, parseStylePack } from '../../src/stylePacks/validate.ts';

// Machine-readable validation for an agent's edit/check loop; no package code is executed.
try {
    const file = process.argv[2];
    if (!file) throw new Error('Usage: npm run style:check -- <pack.folia-style.json>');
    if ((await stat(file)).size > MAX_PACK_BYTES) throw new Error(`Pack exceeds ${MAX_PACK_BYTES} bytes`);
    const pack = parseStylePack(await readFile(file, 'utf8'));
    console.info(JSON.stringify({ valid: true, id: pack.id, version: pack.version, schemaVersion: pack.schemaVersion, execution: 'not run' }));
} catch (error) {
    console.error(JSON.stringify({ valid: false, issues: error.issues ?? [{ path: '$', code: error.message }] }));
    process.exitCode = 1;
}
