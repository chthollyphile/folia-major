import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { BUILTIN_STYLE_CATALOG } from './catalog.mjs';

// Guides point to the existing Folium contract and tools; this service defines no player extension API.
export const root = fileURLToPath(new URL('../../../', import.meta.url));
const skill = 'skills/folium-art-direction/';
export const documents = {
    quickstart: { path: 'docs/folium/quickstart.md', description: 'Start with the existing Folium mod workflow' },
    contributing: { path: 'docs/folium/contributing.md', description: 'Author, debug and submit a standard Folium mod' },
    api: { path: 'docs/folium/api.md', description: 'Generated public Folium API reference' },
    types: { path: 'mods/folium.d.ts', description: 'Generated standalone Folium types; do not edit generated files' },
    specification: { path: 'mods/README.md', description: 'Folium manifest, permissions, lifecycle and trust model' },
    skill: { path: `${skill}SKILL.md`, description: 'Art direction for Folium lyric visualizers' },
    taxonomy: { path: `${skill}references/taxonomy.md`, description: 'Complete personalities and reusable lyric templates' },
    builtins: { path: `${skill}references/builtins.md`, description: 'Visual principles derived from actual built-in sources' },
    'lyric-release': { path: `${skill}references/lyric-release.md`, description: 'Glyph, line and assembly release; frozen anchors and N+2 retirement' },
    reconstruction: { path: `${skill}references/reconstruction.md`, description: 'Wallpaper/video observations and reconstruction lessons' },
    motion: { path: `${skill}references/motion-and-acceptance.md`, description: 'Motion planning and separate runtime/visual acceptance' },
};
const base = 'src/components/visualizer/';
export const sources = {
    ...Object.fromEntries(BUILTIN_STYLE_CATALOG.map(item => [item.id, item.files.map(file => base + file)])),
    'folium-aurora': ['mods/sample-aurora-visualizer/mod.json', 'mods/sample-aurora-visualizer/client.mjs'],
    'folium-52hz': ['mods/visualizer52hz/mod.json', 'mods/visualizer52hz/client.mjs', 'mods/visualizer52hz/stage.mjs'],
};
export function catalog({ kind } = {}) {
    return { categories: { personality: '个性：完整视觉设计', 'lyric-template': '样式：可复用歌词呈现模板' },
        entries: BUILTIN_STYLE_CATALOG.filter(item => !kind || item.kind === kind).map(item => ({ ...item, files: sources[item.id] })),
        modExamples: ['folium-aurora', 'folium-52hz'],
        scope: 'Authoring labels only: not Folium manifest fields, not a change to the player picker. Port principles to public Folium APIs; never import private player modules.' };
}
export const readDocument = key => readFile(path.join(root, documents[key].path), 'utf8');
export function pageText(text, startLine = 1, lineCount = 160) {
    const lines = text.split('\n');
    if (startLine > lines.length) throw new Error(`startLine exceeds ${lines.length}`);
    const selected = []; let size = 0;
    for (const line of lines.slice(startLine - 1, startLine - 1 + lineCount)) {
        if (selected.length && size + line.length > 48000) break;
        if (line.length > 48000) throw new Error('This source line exceeds the tool page limit; inspect the local source file.');
        selected.push(line); size += line.length + 1;
    }
    return { startLine, totalLines: lines.length, nextLine: startLine + selected.length <= lines.length ? startLine + selected.length : null,
        text: selected.join('\n') };
}
export async function guide({ topic, startLine, lineCount }) {
    return { topic, path: documents[topic].path, uri: `folium-authoring://${topic}`, ...pageText(await readDocument(topic), startLine, lineCount) };
}
export const resources = Object.entries(documents).map(([name, info]) => ({ uri: `folium-authoring://${name}`, name, description: info.description, mimeType: 'text/plain' }));
export async function readResource(uri) {
    const resource = resources.find(item => item.uri === uri);
    if (!resource) throw new Error('Unknown resource URI; use resources/list.');
    return { contents: [{ uri, mimeType: 'text/plain', text: await readDocument(resource.name) }] };
}
export async function reference({ style, file = 0, startLine, lineCount }) {
    const files = sources[style];
    if (file >= files.length) throw new Error(`file must be 0..${files.length - 1}`);
    return { style, files, path: files[file], ...pageText(await readFile(path.join(root, files[file]), 'utf8'), startLine, lineCount) };
}
export async function brief({ task, source = 'original', kind = 'personality', lyricTemplate }) {
    const keys = ['skill', 'taxonomy', 'lyric-release', ...(source === 'original' ? [] : ['reconstruction'])];
    return { task, source, kind, lyricTemplate: lyricTemplate ?? null, projectRoot: root,
        guidance: await Promise.all(keys.map(async topic => ({ topic, text: await readDocument(topic) }))),
        contract: 'folium-authoring://types', api: 'folium-authoring://api', firstRead: ['quickstart', 'contributing', 'specification'],
        commands: { create: 'npm run folium:new -- <folder>', check: 'npm run folium:check -- <folder>' },
        runtime: 'Desktop Folia > Settings > Mods: reload, enable after the user trust confirmation, then select the registered visualizer. Use ctx lifecycle helpers and public Folium APIs.',
        next: 'Read the relevant official contract pages and folium-aurora/folium-52hz references. Keep standard mod.json and relative modules. Write a motion plan, implement, then inspect continuous output in the desktop host. Format checks never imply runtime or aesthetic acceptance.' };
}
