import { readFile, writeFile, mkdir, cp, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseStylePack } from '../../src/stylePacks/validate.ts';

// Provide the chosen art direction plus two explicit comparison modes in the offline authoring kit.
const root = fileURLToPath(new URL('../../', import.meta.url)), here = fileURLToPath(new URL('.', import.meta.url));
const [input, destination] = process.argv.slice(2);
if (!input || !destination) throw new Error('Usage: node bundle.mjs <pack.json> <delivery-directory>');
const pack = parseStylePack(await readFile(input, 'utf8'));
const studio = await readFile(path.join(root, 'dist-style-studio/StyleStudio.html'), 'utf8');
const offset = studio.lastIndexOf('</body>');
if (offset < 0) throw new Error('Studio body missing');
await mkdir(path.join(destination, 'source'), { recursive: true });
for (const mode of ['auto', 'line', 'assemble']) {
    const suffix = mode === 'auto' ? '' : `-${mode}`;
    const configured = { ...pack, settings: { ...pack.settings, lyricMode: mode } };
    const text = JSON.stringify(configured, null, 2);
    const payload = JSON.stringify(text).replace(/</g, '\\u003c');
    const script = `<script>{const input=document.getElementById('import'),transfer=new DataTransfer();transfer.items.add(new File([${payload}],'cat-and-bee.folia-style.json',{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change'));}</script>`;
    await writeFile(path.join(destination, `Cat-and-Bee${suffix}-StyleStudio.html`), studio.slice(0, offset) + script + studio.slice(offset));
    await writeFile(path.join(destination, `cat-and-bee${suffix}.folia-style.json`), text);
}
for (const name of ['renderer.js', 'phrases.mjs', 'flight.mjs', 'trail.mjs', 'layout.mjs', 'release.mjs', 'manifest.json', 'prepare.mjs']) {
    const source = await readFile(path.join(here, name), 'utf8');
    await writeFile(path.join(destination, 'source', name), source.replaceAll('../lyricImprint/', './lyricImprint/'));
}
await cp(path.join(root, 'style-packs/lyricImprint'), path.join(destination, 'source/lyricImprint'), { recursive: true });
await cp(path.join(root, 'skills/folia-style-art-direction'), path.join(destination, 'skills/folia-style-art-direction'), { recursive: true });
await copyFile(path.join(here, 'README.md'), path.join(destination, 'SOURCE.md'));
console.info(`[CatBee] Wrote selected glyph direction and line/assemble comparisons to ${destination}`);
