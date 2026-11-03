#!/usr/bin/env node
// dev/ponder/copy-doc.mjs
// Rewrites the parts of docs/ponder-copy.md that are copies of the code: the text column of
// section 1, the table of section 2 (lessons, their files, stand-in files, scenes), the dump of
// section 3 (the ponder block of zh-CN.ts, verbatim) and the table of section 6 (every caption a
// lesson script uses, with the area it points at). The header, the key and file columns of
// section 1, and sections 4 and 5 are written by hand and are left as they are.
//
//   node dev/ponder/copy-doc.mjs           write docs/ponder-copy.md
//   node dev/ponder/copy-doc.mjs --check   write nothing; exit 1 when the file is out of date
//
// The lessons are TypeScript modules found by a glob, so they are loaded through Vite (no dev
// server is started, nothing listens). Run it after a change to a lesson text or a lesson script.
// It also prints the scene and caption keys no script uses. Stops by itself after 100 s.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOC_PATH = path.join(ROOT, 'docs', 'ponder-copy.md');
const LOCALE_PATH = path.join(ROOT, 'src', 'i18n', 'locales', 'zh-CN.ts');

const check = process.argv.includes('--check');
const killer = setTimeout(() => { console.log('ponder copy-doc: stopped after 100 s'); process.exit(1); }, 100000);

const server = await createServer({
    root: ROOT,
    configFile: false,
    // A cache of its own: a running dev server keeps the default one.
    cacheDir: path.join(ROOT, 'node_modules', '.vite-ponder-copy'),
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    resolve: { alias: { '@': path.join(ROOT, 'src') } },
});

const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => (
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]
));
const rel = file => path.relative(ROOT, file).split(path.sep).join('/');
const cell = text => String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');

let outOfDate = false;
try {
    const zh = (await server.ssrLoadModule('/src/i18n/locales/zh-CN.ts')).default;
    const lookup = key => key.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), zh);
    const text = key => (typeof lookup(key) === 'string' ? lookup(key) : `（缺：${key}）`);

    // Which file declares each lesson and each stand-in kind.
    const files = walk(path.join(ROOT, 'src', 'components', 'ponder'));
    const targetFileOf = new Map();
    for (const file of files.filter(name => name.endsWith('.target.ts'))) {
        const module = await server.ssrLoadModule(`/${rel(file)}`);
        targetFileOf.set(module.default.id, rel(file));
    }
    const surfaceFileOf = new Map();
    for (const file of files.filter(name => name.endsWith('.surface.tsx'))) {
        const module = await server.ssrLoadModule(`/${rel(file)}`);
        for (const kind of Object.keys(module.default)) surfaceFileOf.set(kind, rel(file));
    }
    const targets = Object.values((await server.ssrLoadModule('/src/components/ponder/ponderRegistry.ts')).PONDER_TARGETS)
        .sort((a, b) => a.id.localeCompare(b.id));

    // Section 2.
    const lessonRows = targets.map(target => {
        const kinds = new Set();
        for (const scene of target.scenes) {
            for (const anchor of Object.values(scene.anchors)) {
                if (anchor.role === 'surface') kinds.add(anchor.surfaceKind ?? 'palette');
            }
        }
        const byFile = new Map();
        for (const kind of kinds) {
            const file = surfaceFileOf.get(kind) ?? `（没有文件声明 ${kind}）`;
            byFile.set(file, [...(byFile.get(file) ?? []), kind]);
        }
        const drawings = [...byFile].map(([file, list]) => `${file}（${list.join('、')}）`).join('<br>') || '—';
        const scenes = target.scenes.map(scene => `\`${scene.id}\``).join('<br>');
        const where = target.hoverSelector ? `\`${cell(target.hoverSelector)}\`` : '没有悬停入口（页面级，或只从全部教程进入）';
        return `| \`${target.id}\` | \`${target.titleKey}\` | ${target.category} | \`${targetFileOf.get(target.id)}\` | ${where} | ${drawings} | ${scenes} |`;
    });

    // Section 6.
    const sceneKeys = new Set();
    const captionKeys = new Set();
    const captionRows = [];
    for (const target of targets) {
        for (const scene of target.scenes) {
            sceneKeys.add(scene.titleKey);
            for (const step of scene.steps) {
                if (step.kind !== 'caption') continue;
                captionKeys.add(step.textKey);
                const name = step.pointTo?.anchor;
                const labelKey = name ? scene.anchors[name]?.labelKey : undefined;
                const area = name ? (labelKey ? `${name}：${cell(text(labelKey))}` : name) : '—';
                captionRows.push(`| \`${target.id}\` | \`${scene.id}\` | ${cell(text(scene.titleKey))} | \`${step.textKey}\` | ${cell(text(step.textKey))} | ${area} | ${labelKey ? `\`${labelKey}\`` : '—'} |`);
            }
        }
    }
    const leaves = (node, prefix) => Object.entries(node ?? {}).flatMap(([key, value]) => (
        typeof value === 'string' ? [`${prefix}.${key}`] : leaves(value, `${prefix}.${key}`)
    ));
    const allScenes = leaves(zh.ponder.scenes, 'ponder.scenes');
    const allCaptions = leaves(zh.ponder.captions, 'ponder.captions');

    // Section 3: the ponder block as it stands in the file.
    const source = fs.readFileSync(LOCALE_PATH, 'utf8').split(/\r?\n/);
    const first = source.findIndex(line => /^  "?ponder"?: \{/.test(line));
    const last = source.findIndex((line, index) => index > first && /^  \},?$/.test(line));
    if (first < 0 || last < 0) throw new Error('the ponder block was not found in zh-CN.ts');
    const dump = source.slice(first, last + 1).join('\n').replace(/,$/, '');

    const before = fs.readFileSync(DOC_PATH, 'utf8');
    const lines = before.split(/\r?\n/);
    const heading = number => {
        const index = lines.findIndex(line => line.startsWith(`## ${number}. `));
        if (index < 0) throw new Error(`section ${number} was not found in docs/ponder-copy.md`);
        return index;
    };
    const [s1, s2, s3, s4, s6] = [1, 2, 3, 4, 6].map(heading);

    // Section 1: only the text column is a copy; the key and the file stay as written.
    const missingFiles = [];
    const section1 = lines.slice(s1, s2).map(line => {
        const match = /^\| `([^`]+)` \| (.*) \| ([^|]+) \|$/.exec(line);
        if (!match) return line;
        if (!fs.existsSync(path.join(ROOT, match[3].trim()))) missingFiles.push(match[3].trim());
        return `| \`${match[1]}\` | ${cell(text(match[1]))} | ${match[3].trim()} |`;
    });
    const section2 = [
        lines[s2], '',
        '一条教程是 targets/ 下的一个文件：声明标题、摘要、章节、字幕和锚点。手画界面按 surfaceKind 由 surfaces/ 下的 *.surface.tsx 各自声明，PonderSurfaceContents.tsx 把它们收齐。',
        '',
        '| 目标 ID | 目标标题 key | 类别 | 目标定义文件 | 悬停入口（hoverSelector） | 手画界面文件（surfaceKind） | 场景 ID |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...lessonRows, '',
    ];
    const section3 = [
        lines[s3], '',
        '下面是当前 zh-CN.ts 中 ponder 对象的完整内容。这里的 key 与源码保持一致，目标 / 场景的具体对应关系见第 2 节；如果要批量改稿，直接在这段里搜索 key 最方便。',
        '', '```ts', dump, '```', '',
    ];
    const section6 = [
        lines[s6], '',
        '这张表把第 3 节中的字幕正文连回实际目标脚本；指向区域是手画界面里的锚点，对应的区域标签同时列出。',
        '',
        `当前语言文件里有 ${allScenes.length} 个章节 key、${allCaptions.length} 个字幕 key；目标脚本直接引用的是 ${sceneKeys.size} 个章节和 ${captionKeys.size} 个字幕。第 3 节保留全部原文，下面的映射表只列脚本当前直接引用的文案。`,
        '',
        '| 目标 ID | 场景 ID | 场景标题 | 字幕 key | 中文文案 | 指向区域 | 区域 label key |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...captionRows, '',
    ];
    const after = [
        ...lines.slice(0, s1), ...section1, ...section2, ...section3, ...lines.slice(s4, s6), ...section6,
    ].join('\n');

    const unusedScenes = allScenes.filter(key => !sceneKeys.has(key));
    const unusedCaptions = allCaptions.filter(key => !captionKeys.has(key));
    console.log(`ponder copy-doc: ${targets.length} lessons, ${captionRows.length} caption rows; scene keys ${allScenes.length} (${unusedScenes.length} not used by a script), caption keys ${allCaptions.length} (${unusedCaptions.length} not used)`);
    if (unusedScenes.length) console.log(`  scene keys no script uses: ${unusedScenes.join(' ')}`);
    if (unusedCaptions.length) console.log(`  caption keys no script uses: ${unusedCaptions.join(' ')}`);
    if (missingFiles.length) console.log(`  section 1 names files that do not exist: ${[...new Set(missingFiles)].join(' ')}`);
    if (after === before) {
        console.log('ponder copy-doc: docs/ponder-copy.md is up to date');
    } else if (check) {
        outOfDate = true;
        console.log('ponder copy-doc: docs/ponder-copy.md is out of date; run node dev/ponder/copy-doc.mjs');
    } else {
        fs.writeFileSync(DOC_PATH, after);
        console.log(`ponder copy-doc: wrote docs/ponder-copy.md (${after.split('\n').length} lines, was ${lines.length})`);
    }
} finally {
    await server.close();
    clearTimeout(killer);
}
process.exit(outOfDate ? 1 : 0);
