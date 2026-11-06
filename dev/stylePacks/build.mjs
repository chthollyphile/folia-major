import { build } from 'vite';
import { mkdir, writeFile, copyFile, readFile, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { STYLE_PACK_SCHEMA } from '../../src/stylePacks/schema.ts';
import { EXAMPLE_PACK } from '../../src/stylePacks/example.ts';
import { CODE_PACK_SCHEMA } from '../../src/stylePacks/code/schema.ts';
import { RENDERER_PACK } from '../../src/stylePacks/code/example.ts';
import { LYRIC_TEMPLATE_PACK } from '../../src/stylePacks/code/lyricTemplate.ts';
import { exportClients } from './mcp/exportClients.mjs';

// Produces one double-clickable offline HTML file plus the agent authoring contract.
const root = fileURLToPath(new URL('../../', import.meta.url));
const out = path.join(root, 'dist-style-studio');
const result = await build({
    configFile: false, root, publicDir: false, logLevel: 'warn',
    // Preserve the reference renderer's source and useful stack names in the authoring tool.
    build: { write: false, minify: false, lib: { entry: path.join(root, 'src/stylePacks/studio.ts'), name: 'FoliaStyleStudio', formats: ['iife'] } },
});
const outputs = (Array.isArray(result) ? result : [result]).flatMap(item => item.output);
const js = outputs.filter(item => item.type === 'chunk').map(item => item.code).join('\n').replace(/<\/script/gi, '<\\/script');
const css = outputs.filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => String(item.source)).join('\n');
await mkdir(out, { recursive: true });
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; frame-src blob:; media-src blob: data:; style-src 'unsafe-inline'; img-src blob: data:; font-src data: blob:; connect-src 'none'"><title>Folia Style Studio</title><style>${css}</style></head><body><div id="studio"></div><script>${js}</script></body></html>`;
await writeFile(path.join(out, 'StyleStudio.html'), html);
await writeFile(path.join(out, 'style-pack.schema.json'), JSON.stringify(STYLE_PACK_SCHEMA, null, 2) + '\n');
await writeFile(path.join(out, 'renderer-pack.schema.json'), JSON.stringify(CODE_PACK_SCHEMA, null, 2) + '\n');
await writeFile(path.join(out, 'nocturne.folia-style.json'), JSON.stringify(EXAMPLE_PACK, null, 2) + '\n');
await writeFile(path.join(out, 'prism.folia-style.json'), JSON.stringify(RENDERER_PACK, null, 2) + '\n');
await writeFile(path.join(out, 'prism.renderer.js'), RENDERER_PACK.renderer.code + '\n');
await writeFile(path.join(out, 'lyric-template.folia-style.json'), JSON.stringify(LYRIC_TEMPLATE_PACK, null, 2) + '\n');
await writeFile(path.join(out, 'lyric-template.renderer.js'), LYRIC_TEMPLATE_PACK.renderer.code + '\n');
await copyFile(path.join(root, 'dev/stylePacks/renderer-api.d.ts'), path.join(out, 'renderer-api.d.ts'));
await copyFile(path.join(root, 'docs/style-pack-design-reference.md'), path.join(out, 'DESIGN.md'));
await copyFile(path.join(root, 'docs/style-pack-verification.md'), path.join(out, 'VERIFICATION.md'));
await copyFile(path.join(root, 'docs/style-packs.md'), path.join(out, 'README.md'));
await copyFile(path.join(root, 'docs/style-packs-v1.md'), path.join(out, 'style-packs-v1.md'));
await copyFile(path.join(root, 'docs/style-pack-agent.md'), path.join(out, 'AGENT.md'));
await cp(path.join(root, 'skills/folia-style-art-direction'), path.join(out, 'skills/folia-style-art-direction'), { recursive: true });
const mcpGuide = (await readFile(path.join(root, 'docs/style-pack-mcp.md'), 'utf8')).replaceAll('../skills/', 'skills/');
await writeFile(path.join(out, 'MCP.md'), mcpGuide);
await writeFile(path.join(out, 'style-pack-mcp.md'), mcpGuide);
await exportClients(path.join(out, 'mcp-clients'));
// Keep repository-relative document links valid inside the downloadable folder too.
for (const name of ['style-packs.md', 'style-pack-agent.md', 'style-pack-design-reference.md']) {
    await copyFile(path.join(root, 'docs', name), path.join(out, name));
}
const dependencies = ['@chenglou/pretext', 'fflate'];
let notices = 'Folia Style Studio — project source: https://github.com/Feist-totoo/folia-major\n\n';
notices += await readFile(path.join(root, 'LICENSE'), 'utf8');
for (const dependency of dependencies) notices += `\n\n${dependency}\n${await readFile(path.join(root, 'node_modules', dependency, 'LICENSE'), 'utf8')}`;
await writeFile(path.join(out, 'LICENSES.txt'), notices);
console.info(`[StylePacks] Built ${path.join(out, 'StyleStudio.html')} (${Buffer.byteLength(html)} bytes)`);
