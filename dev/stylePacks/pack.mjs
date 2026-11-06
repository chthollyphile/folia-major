import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';
import { parseStylePack, formatStylePack } from '../../src/stylePacks/validate.ts';

// Compile local imports into one worker script. No runtime CDN or privileged host imports.
try {
    const directory = process.argv[2], output = process.argv[3];
    if (!directory || !output) throw new Error('Usage: npm run style:pack -- <source-directory> <output.folia-style.json>');
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
    const result = await build({ configFile: false, root: path.resolve(directory), publicDir: false, logLevel: 'warn', build: {
        write: false, minify: false, target: 'es2022',
        lib: { entry: path.resolve(directory, 'renderer.js'), name: 'FoliaCustomRenderer', formats: ['iife'] },
    } });
    const outputFiles = (Array.isArray(result) ? result : [result]).flatMap(item => item.output);
    if (outputFiles.length !== 1 || outputFiles[0].type !== 'chunk') throw new Error('Renderer must bundle into one JavaScript file without external CSS/assets');
    const pack = parseStylePack(JSON.stringify({ ...manifest, renderer: { apiVersion: 2, code: outputFiles[0].code } }));
    await writeFile(output, formatStylePack(pack));
    console.info(JSON.stringify({ valid: true, id: pack.id, output }));
} catch (error) { console.error('[StylePacks]', error); process.exitCode = 1; }
