import { readFile, writeFile, mkdir, copyFile, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseStylePack } from '../../src/stylePacks/validate.ts';

// Package the existing offline Studio with this local artwork pack selected on startup.
const here = fileURLToPath(new URL('.', import.meta.url));
const root = path.resolve(here, '../..');
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node bundle.mjs <pack.json> <delivery-directory>');
const packText = await readFile(input, 'utf8');
const pack = parseStylePack(packText);
if (pack.id !== 'local.nightingale') throw new Error('Expected the Nightingale pack');
const studio = await readFile(path.join(root, 'dist-style-studio/StyleStudio.html'), 'utf8');
const payload = JSON.stringify(packText).replace(/</g, '\\u003c');
const bootstrap = `<script>{const input=document.getElementById('import');const transfer=new DataTransfer();transfer.items.add(new File([${payload}],'nightingale.folia-style.json',{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change'));}</script>`;
const destination = path.resolve(output);
// The bundled runtime itself contains a literal </body> in its sandbox HTML template.
const closingBody = studio.lastIndexOf('</body>');
if (closingBody < 0) throw new Error('Studio document has no closing body');
await mkdir(path.join(destination, 'source'), { recursive: true });
await writeFile(path.join(destination, 'Nightingale-StyleStudio.html'), studio.slice(0, closingBody) + bootstrap + studio.slice(closingBody));
await writeFile(path.join(destination, 'nightingale.folia-style.json'), packText);
for (const name of ['renderer.js', 'scenery.js', 'coordinates.mjs', 'puppet.js', 'puppetData.js', 'lyrics.js', 'flow.mjs', 'journey.mjs', 'timeline.js', 'manifest.json', 'prepare.py']) {
    const source = await readFile(path.join(here, name), 'utf8');
    await writeFile(path.join(destination, 'source', name), source.replaceAll('../lyricImprint/', './lyricImprint/'));
}
await cp(path.join(root, 'style-packs/lyricImprint'), path.join(destination, 'source/lyricImprint'), { recursive: true });
await cp(path.join(root, 'skills/folia-style-art-direction'), path.join(destination, 'skills/folia-style-art-direction'), { recursive: true });
await copyFile(path.join(here, 'README.md'), path.join(destination, 'README.md'));
await copyFile(path.join(here, 'VERIFICATION.md'), path.join(destination, 'VERIFICATION.md'));
await copyFile(path.join(root, 'dev/stylePacks/renderer-api.d.ts'), path.join(destination, 'source/renderer-api.d.ts'));
await copyFile(path.join(root, 'dist-style-studio/LICENSES.txt'), path.join(destination, 'LICENSES.txt'));
console.info(`[Nightingale] Created ${destination}`);
