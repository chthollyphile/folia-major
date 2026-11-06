import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { BUILTIN_STYLE_CATALOG, builtinStyle } from '../../../src/stylePacks/catalog.ts';

// One canonical skill serves local discovery, MCP resources and the offline authoring kit.
export const root = fileURLToPath(new URL('../../../', import.meta.url));
export const installation = existsSync(path.join(root, 'studio/StyleStudio.html'))
    ? { mode: 'standalone', cli: path.resolve(root, '../folia-style.cmd'), studio: path.join(root, 'studio/StyleStudio.html') }
    : { mode: 'checkout', cli: null, studio: 'npm run style:studio' };
const skill = 'skills/folia-style-art-direction/';
export const documents = {
    skill: { path: `${skill}SKILL.md`, description: 'Folia 风格导演：制作和审美复查工作流' },
    taxonomy: { path: `${skill}references/taxonomy.md`, description: '个性与样式：完整设计、可复用歌词模板及兼容规则' },
    builtins: { path: `${skill}references/builtins.md`, description: '雾笺、凝彩、花火、绘光、商籁的源码设计依据' },
    'lyric-release': { path: `${skill}references/lyric-release.md`, description: '区分逐字、整句、独立字词组句；出生锚点、局部浮动与N+2退场；猫蜂/夜莺重制经验' },
    reconstruction: { path: `${skill}references/reconstruction.md`, description: '夜莺壁纸重建案例与固定轨迹失败经验' },
    motion: { path: `${skill}references/motion-and-acceptance.md`, description: '乐句编排、阅读约束和分层视觉验收' },
    'renderer-api': { path: 'dev/stylePacks/renderer-api.d.ts', description: '当前 API 2 渲染器类型契约' },
    specification: { path: 'docs/style-packs.md', description: '风格包规范和 P01–P12 技术验收' },
};
const base = 'src/components/visualizer/';
export const sources = Object.fromEntries(BUILTIN_STYLE_CATALOG.map(item => [item.id, item.files]));
export function catalog({ kind } = {}) {
    return { categories: { personality: '个性：完整场景、主体、运镜、材质与歌词的成熟设计', 'lyric-template': '样式：可复用的歌词呈现模板' },
        entries: BUILTIN_STYLE_CATALOG.filter(item => !kind || item.kind === kind).map(item => ({ ...item, files: item.files.map(file => base + file) })),
        reuse: 'Template source is a design/implementation reference. Adapt it to API 2 and bundle local imports; existing React/Three.js visualizers are not runtime dependencies of a pack. Random is a playback choice, never a template.' };
}
export const readDocument = key => readFile(path.join(root, documents[key].path), 'utf8');
export const resources = Object.entries(documents).map(([name, info]) => ({
    uri: `folia-style://${name}`, name, description: info.description, mimeType: 'text/plain',
}));
export async function readResource(uri) {
    const resource = resources.find(item => item.uri === uri);
    if (!resource) throw new Error('Unknown Folia resource URI; use resources/list.');
    return { contents: [{ uri, mimeType: resource.mimeType, text: await readDocument(resource.name) }] };
}
export async function reference({ style, file = 0, startLine = 1, lineCount = 120 }) {
    const files = sources[style];
    if (file >= files.length) throw new Error(`file must be 0..${files.length - 1}`);
    const relativePath = base + files[file];
    const lines = (await readFile(path.join(root, relativePath), 'utf8')).split('\n');
    if (startLine > lines.length) throw new Error(`startLine exceeds ${lines.length}`);
    return { style, kind: builtinStyle(style).kind, name: builtinStyle(style).name, files: files.map(item => base + item), path: relativePath, totalLines: lines.length,
        startLine, nextLine: startLine + lineCount <= lines.length ? startLine + lineCount : null,
        source: lines.slice(startLine - 1, startLine - 1 + lineCount).map((line, i) => `${startLine + i}: ${line}`).join('\n') };
}
export async function brief({ task, source = 'original', kind = 'personality', lyricTemplate }) {
    const keys = ['skill', 'taxonomy', 'builtins', 'lyric-release', 'motion', ...(source === 'original' ? [] : ['reconstruction'])];
    const guidance = await Promise.all(keys.map(async key => ({ uri: `folia-style://${key}`, text: await readDocument(key) })));
    return { task, source, kind, lyricTemplate: lyricTemplate ?? null, catalog: catalog(), projectRoot: root, guidance,
        lyricDecisions: ['Choose a genuinely distinct glyph / whole-line / independent-word-assembly entrance.',
            'Specify birth placement, post-birth anchoring, local drift bounds and retirement separately.',
            'Cat-and-Bee: freeze birth anchors. Nightingale: freeze departure samples and destination anchors, allow visible transport before holding. Both keep all words until the second following lyric starts; never drag already settled text or truncate retained text.',
            'Nightingale v1.3: each visible glyph must be born near the singer, visibly travel along a continuous path, decelerate into its own fixed anchor, then float locally until N+2. A curved subtitle fading in at its destination and decorative particles standing in for glyph transport are rejected designs. Verify birth, transit, landing and retained positions of the same glyph.'],
        contract: 'folia-style://renderer-api', specification: 'folia-style://specification',
        toolFallback: { name: 'folia_style_read_guide', arguments: { topic: 'renderer-api' } },
        next: 'Write an evidence-based motion plan, inspect relevant built-in source with folia_style_reference, then implement and watch continuous previews. Do not equate schema or diagnostic success with visual acceptance.',
        installation,
        commands: installation.mode === 'standalone'
            ? { usage: 'Run the absolute installation.cli path with these arguments. It contains its own Node runtime.', studio: 'studio', pack: 'pack <source-dir> <output.json>', check: 'check <pack.json>', create: 'new <source-dir> [id]' }
            : { studio: 'npm run style:studio', offline: 'npm run style:build', pack: 'npm run style:pack -- <source-dir> <output.json>', check: 'npm run style:check -- <pack.json>' } };
}
