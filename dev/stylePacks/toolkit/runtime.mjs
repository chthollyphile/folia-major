import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { unzipSync } from 'fflate';

// Fetch the pinned official Node archive, check its published SHA-256, and retain its full license.
export async function stageNode(version, cache, destination) {
    const name = `node-v${version}-win-x64`;
    const filename = `${name}.zip`;
    const base = `https://nodejs.org/dist/v${version}/`;
    const response = await fetch(`${base}SHASUMS256.txt`);
    if (!response.ok) throw new Error(`Node checksum download: ${response.status}`);
    const checksums = await response.text();
    const expected = checksums.split('\n').find(line => line.trim().endsWith(` ${filename}`))?.split(/\s+/)[0];
    if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('Missing official Node checksum');
    await mkdir(cache, { recursive: true });
    let bytes;
    try { bytes = await readFile(path.join(cache, filename)); } catch { /* Download below. */ }
    if (!bytes || createHash('sha256').update(bytes).digest('hex') !== expected) {
        const download = await fetch(`${base}${filename}`);
        if (!download.ok) throw new Error(`Node download: ${download.status}`);
        bytes = Buffer.from(await download.arrayBuffer());
        if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Node archive checksum mismatch');
        await writeFile(path.join(cache, filename), bytes);
    }
    const files = unzipSync(bytes, { filter: entry => [`${name}/node.exe`, `${name}/LICENSE`].includes(entry.name) });
    await mkdir(destination, { recursive: true });
    for (const file of ['node.exe', 'LICENSE']) {
        if (!files[`${name}/${file}`]) throw new Error(`Node archive missing ${file}`);
        await writeFile(path.join(destination, file), files[`${name}/${file}`]);
    }
    return { version, archive: `${base}${filename}`, sha256: expected };
}
