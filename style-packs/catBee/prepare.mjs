import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Encode only the two locally converted source textures; proprietary artwork is not stored in the repository.
const directory = process.argv[2];
if (!directory) throw new Error('Usage: node style-packs/catBee/prepare.mjs <converted-textures-directory>');
const assets = await Promise.all([['cat', 'cat.png'], ['bee', 'cat_bee2.png']].map(async ([id, name]) => ({ id, mime: 'image/png', data: (await readFile(path.join(directory, name))).toString('base64') })));
const manifest = {
    format: 'folia-style', schemaVersion: 2, id: 'local.cat-and-bee', name: '猫与蜜蜂 · 留声', version: '0.4.0',
    author: 'Folia local adaptation / wallpaper: SYKM', description: 'Lyrics remain near their birth positions, float locally and fade when the second following lyric appears. Three distinct release grammars. Local artwork from Workshop 3444535389.',
    palette: { background: '#08090b', primary: '#f5f3e9', secondary: '#888885', accent: '#ffffff' },
    settings: { lyricMode: 'auto', artStyle: 'line-art' }, assets,
};
await writeFile(path.join(fileURLToPath(new URL('.', import.meta.url)), 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.info('[CatBee] Prepared local assets; artStyle=line-art selects glyph release.');
