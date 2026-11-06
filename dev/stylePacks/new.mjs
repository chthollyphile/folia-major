import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { RENDERER_PACK } from '../../src/stylePacks/code/example.ts';
import { parseStylePack } from '../../src/stylePacks/validate.ts';
import { LYRIC_TEMPLATE_PACK } from '../../src/stylePacks/code/lyricTemplate.ts';
import { STYLE_KINDS } from '../../src/stylePacks/catalog.ts';

// A renderer source project; never overwrite an agent's or user's existing work.
try {
    const directory = process.argv[2], id = process.argv[3] ?? 'my.first-style', kind = process.argv[4] ?? 'personality';
    if (!directory || process.argv.length > 5 || !STYLE_KINDS.includes(kind)) throw new Error('Usage: style:new <new-directory> [unique.id] [personality|lyric-template]');
    const pack = parseStylePack(JSON.stringify({ ...(kind === 'lyric-template' ? LYRIC_TEMPLATE_PACK : RENDERER_PACK), kind, id,
        name: kind === 'lyric-template' ? 'My lyric template' : 'My personality', author: 'Your name' }));
    await mkdir(directory);
    const { renderer, ...manifest } = pack;
    await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    await writeFile(path.join(directory, 'renderer.js'), renderer.code + '\n', { flag: 'wx' });
    console.info(`[StylePacks] Created ${directory}; build with style:pack`);
} catch (error) { console.error('[StylePacks]', error); process.exitCode = 1; }
