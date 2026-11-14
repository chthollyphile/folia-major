#!/usr/bin/env node
// dev/folium/api-docs.mjs
// Generates docs/folium/api.md, the Folium API reference, from the public
// contract: src/mods/folium/contract.ts (the client entry),
// src/mods/folium/sources/contract.ts (Folium 2.0: `folium.sources` and its
// capabilities) and src/mods/folium/mainContract.ts (the main entry), the
// single sources of the API. They are written in a regular style (JSDoc, `// ----` section markers,
// one member per `;`), so a small scanner is enough; TypeScript's JS compiler
// API is not available with the native TypeScript 7 package.
//
//   node dev/folium/api-docs.mjs           write docs/folium/api.md
//   node dev/folium/api-docs.mjs --check   exit 1 when the file is out of date
//
// test/unit/mod-system/foliumApiDocs.test.ts runs the check, so a contract
// change without regenerating the reference fails the unit tests.
//
// Three tables in the reference come from tables of facts, imported or read as
// they are: the registries from the kinds table (src/mods/folium/kinds.ts), the
// events from the event types table (src/mods/folium/eventTypes.ts), and the
// permissions, with the members each unlocks, from
// electron/modSystem/foliumShared.json. Folium 1.6 only: the section of old
// names that still work comes from the two deprecation tables
// (src/mods/folium/deprecated/oldNames.ts, electron/modSystem/deprecated.cjs).

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { FOLIUM_KINDS } from '../../src/mods/folium/kinds.ts';
import { FOLIUM_EVENT_TYPES } from '../../src/mods/folium/eventTypes.ts';
import { FOLIUM_OLD_CLIENT_NAMES, foliumOldNameAdvice } from '../../src/mods/folium/deprecated/oldNames.ts';

const require = createRequire(import.meta.url);
const { OLD_MAIN_NAMES, OLD_PERMISSIONS } = require('../../electron/modSystem/deprecated.cjs');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CONTRACT_PATH = path.join(ROOT, 'src', 'mods', 'folium', 'contract.ts');
export const MAIN_CONTRACT_PATH = path.join(ROOT, 'src', 'mods', 'folium', 'mainContract.ts');
export const SOURCES_CONTRACT_PATH = path.join(ROOT, 'src', 'mods', 'folium', 'sources', 'contract.ts');

/** The sources contract as it is on disk: what the generators read when they are not handed it. */
export const readSourcesContract = () => fs.readFileSync(SOURCES_CONTRACT_PATH, 'utf8');
export const OUTPUT_PATH = path.join(ROOT, 'docs', 'folium', 'api.md');
export const SHARED_PATH = path.join(ROOT, 'electron', 'modSystem', 'foliumShared.json');

/** What both sides of the mod system agree on: version, permission names, experimental names, channels. */
export const readFoliumShared = () => JSON.parse(fs.readFileSync(SHARED_PATH, 'utf8'));

// ---------------------------------------------------------------- scanning

/* Index just past the comment or string starting at `i`, or -1 when none starts there. */
const skipCommentOrString = (text, i) => {
    if (text.startsWith('//', i)) {
        const end = text.indexOf('\n', i);
        return end === -1 ? text.length : end;
    }
    if (text.startsWith('/*', i)) return text.indexOf('*/', i + 2) + 2;
    const quote = text[i];
    if (quote === '\'' || quote === '"' || quote === '`') {
        let j = i + 1;
        while (j < text.length && text[j] !== quote) j += text[j] === '\\' ? 2 : 1;
        return j + 1;
    }
    return -1;
};

/* Index of the first `stop` character at bracket depth 0 from `start` (strings and comments skipped). */
const findAtDepthZero = (text, start, stops) => {
    let depth = 0;
    for (let i = start; i < text.length; i += 1) {
        const skipped = skipCommentOrString(text, i);
        if (skipped !== -1) {
            i = skipped - 1;
            continue;
        }
        const char = text[i];
        if (depth === 0 && stops.includes(char)) return i;
        if ('({['.includes(char)) depth += 1;
        else if (')}]'.includes(char)) depth -= 1;
    }
    return -1;
};

/* JSDoc or line-comment text without comment markers, one paragraph per blank line. */
const cleanComment = (raw) => raw
    .replace(/^\/\*\*?/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*(\*|\/\/)\s?/, '').trimEnd())
    .join('\n')
    .trim();

const squash = (value) => value.replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/,\s*\)/g, ')').replace(/\s+\)/g, ')').trim();

/* `text` without its comments (strings kept as they are). */
const stripComments = (text) => {
    let out = '';
    for (let i = 0; i < text.length;) {
        const skipped = skipCommentOrString(text, i);
        if (skipped === -1) {
            out += text[i];
            i += 1;
            continue;
        }
        if (text.startsWith('//', i) || text.startsWith('/*', i)) out += ' ';
        else out += text.slice(i, skipped);
        i = skipped;
    }
    return out;
};

/* The body of an inline object type (`{ … }` and nothing around it), or null for any other type. */
const inlineObjectBody = (type) => {
    const trimmed = type.trim();
    if (!trimmed.startsWith('{')) return null;
    const close = findAtDepthZero(trimmed, 1, ['}']);
    return close === trimmed.length - 1 ? trimmed.slice(1, close) : null;
};

/*
 * Splits an interface body into members. Comments directly above a member
 * (no blank line between) become its description. A member whose type is an
 * inline object type with described members of its own (FoliumOmniProviderInfo's
 * `supports`) carries them as `children`, and its type is shown without their
 * comments.
 */
const parseMembers = (body) => {
    const members = [];
    let i = 0;
    let doc = [];
    while (i < body.length) {
        const char = body[i];
        if (char === '\n' && /^\n[ \t]*\n/.test(body.slice(i))) doc = [];
        if (/\s/.test(char)) {
            i += 1;
            continue;
        }
        if (body.startsWith('/*', i) || body.startsWith('//', i)) {
            const end = skipCommentOrString(body, i);
            doc.push(cleanComment(body.slice(i, end)));
            i = end;
            continue;
        }
        const end = findAtDepthZero(body, i, [';']);
        const raw = body.slice(i, end === -1 ? body.length : end).trim();
        i = end === -1 ? body.length : end + 1;
        const match = /^(readonly\s+)?('[^']+'|"[^"]+"|[A-Za-z_$][\w$]*)(\?)?\s*([\s\S]*)$/.exec(raw);
        if (!match) continue;
        const [, readonly, name, optional, rest] = match;
        const isMethod = rest.startsWith('(') || rest.startsWith('<');
        const type = isMethod ? rest : rest.replace(/^:\s*/, '');
        const objectBody = isMethod ? null : inlineObjectBody(type);
        const children = objectBody !== null && /\/\*|\/\//.test(objectBody) ? parseMembers(objectBody) : [];
        members.push({
            name: name.replace(/^['"]|['"]$/g, ''),
            readonly: Boolean(readonly),
            optional: Boolean(optional),
            method: isMethod,
            type: squash(stripComments(type)),
            doc: doc.join('\n\n'),
            ...(children.length > 0 ? { children } : {}),
        });
        doc = [];
    }
    return members;
};

/*
 * Reads the contract into sections of declarations. Declarations before the
 * first `// ----` marker land in a 'Basics' section.
 */
export const parseContract = (text) => {
    const sections = [{ title: 'Basics', items: [] }];
    let i = 0;
    let doc = [];
    while (i < text.length) {
        if (text[i] === '\n' && /^\n[ \t]*\n/.test(text.slice(i))) doc = [];
        if (/\s/.test(text[i])) {
            i += 1;
            continue;
        }
        const marker = /^\/\/ -{8,} (.+)$/m.exec(text.slice(i, text.indexOf('\n', i) === -1 ? undefined : text.indexOf('\n', i)));
        if (marker && text.startsWith('// --', i)) {
            sections.push({ title: marker[1].trim(), items: [] });
            i = text.indexOf('\n', i);
            doc = [];
            continue;
        }
        if (text.startsWith('/*', i) || text.startsWith('//', i)) {
            const end = skipCommentOrString(text, i);
            doc.push(cleanComment(text.slice(i, end)));
            i = end;
            continue;
        }
        const head = /^export (interface|type|const) ([A-Za-z_$][\w$]*)/.exec(text.slice(i, i + 200));
        if (!head) {
            const lineEnd = text.indexOf('\n', i);
            i = lineEnd === -1 ? text.length : lineEnd;
            doc = [];
            continue;
        }
        const [, kind, name] = head;
        const section = sections[sections.length - 1];
        const description = doc.join('\n\n');
        doc = [];
        if (kind === 'interface') {
            const open = text.indexOf('{', i);
            const header = squash(text.slice(i + 'export interface '.length, open));
            const close = findAtDepthZero(text, open + 1, ['}']);
            section.items.push({ kind, name, header, doc: description, members: parseMembers(text.slice(open + 1, close)) });
            i = close + 1;
        } else {
            const end = findAtDepthZero(text, i, [';']);
            const source = text.slice(i + 'export '.length, end).trim();
            section.items.push({ kind, name, source: kind === 'type' ? squash(source) : source, doc: description });
            i = end + 1;
        }
    }
    return sections.filter((section) => section.items.length > 0);
};

// ---------------------------------------------------------------- rendering

/*
 * Folium 2.0 (plan §10, delivery): while foliumShared.json says `sourcesPreview`, the source interface is a
 * preview, and the reference says so at its top and over the two sections that hold it. The type file says the
 * same (types.mjs). `folium: 1`'s promise is not touched: its interface stays frozen at 1.9.
 */
export const SOURCES_PREVIEW_SECTIONS = ['Sources', 'Source main API'];
export const SOURCES_PREVIEW_NOTE = '> **预览**：Folium 2 的音源接口（`folium.sources` 与音源类模组 main 入口的 `api`）还是预览版，'
    + '九个内置音源全部迁过去之前可能变动；用它写的模组可能要随新版本更新。`folium: 1` 冻结在 Folium 1.9 的接口不受影响。';
export const sourcesPreview = () => readFoliumShared().sourcesPreview === true;

// Contract section → reference heading, lookup order, and a short orientation.
const SECTION_INFO = {
    'Client API': {
        order: 1,
        title: '客户端入口',
        intro: '模组的 `client` 入口默认导出 `activate(folium)`，参数就是 [FoliumClientApi](#foliumclientapi)，所有能力都从这里取。数据文件 `folium.storage`、密钥字段的值 `folium.secrets`（Folium 1.7）和通往 main 入口的 `folium.rpc` 也在这一节。',
    },
    'Registry definitions': {
        order: 2,
        title: '注册表与条目',
        intro: '`folium.registries.<名称>.register(def)` 返回 [FoliumRegistryHandle](#foliumregistryhandle)。条目 id 由宿主加上命名空间成为 `<modid>:<id>`；模组停用时宿主自动撤下它注册的一切。',
    },
    'Host containers': {
        order: 3,
        title: '宿主容器与上下文',
        intro: '界面类条目都是 `mount(container, ctx) => dispose?`：宿主创建并回收容器，通过 `ctx` 提供时钟、主题、设置、音频等只读信息与订阅。',
    },
    Events: {
        order: 4,
        title: '事件',
        intro: '`folium.events.on(type, handler, { priority })`。通知只读、事后发出；钩子让处理器依次修改同一个事件对象。',
    },
    Services: {
        order: 5,
        title: '服务',
        intro: '`folium.playback` / `folium.ui` / `folium.net`，以及 Folium 1.7 的登录状态 `folium.account` 和经 Omni 只读在线音源的 `folium.omni`（两者都不需要权限；`folium.omni` 以用户在 Folia 登录的平台账号发请求），以及宿主均衡器 `folium.equalizer`（读不需要权限，写需 `equalizer.control`）；Folium 1.8 加了歌词显示设置 `folium.visualizer`：歌词画布渲染质量、歌词动画模式、内置模式的样式参数与智能动感效果（读不需要权限，写分别需 `visualizer.renderQuality`、`visualizer.mode`、`visualizer.tuning`、`visualizer.beatEffects`）；Folium 1.9 加了返回一层的 `folium.ui.back()`，以及 `folium.visualizer` 的背景类型与动画强度（写分别需 `visualizer.background`、`visualizer.animationIntensity`）。需要权限的方法见[权限一览](#权限一览)；导出窗口里调用会抛 `*-unavailable-in-export-context`（`ui.icon` 除外）。',
    },
    'Shared helpers': {
        order: 6,
        title: '共享工具',
        intro: '`folium.lyrics` 与 `folium.theme`：内置歌词动画使用的同一批函数，主窗口与导出窗口都可用。`folium.lyrics.parse` 是唯一的异步方法，走本地歌词文件的解析流程。',
    },
    Parameters: {
        order: 7,
        title: '设置 schema',
        intro: '设置分区、visualizer / background 设置、tunings 与命令参数共用 [FoliumSetting](#foliumsetting)。读到的值已合并默认值，写入按 schema 校验。',
    },
    DTOs: {
        order: 8,
        title: '数据结构',
        intro: '歌词行与主题与内置 visualizer 收到的 `Line` / `Theme` 同名同义，是宿主投影出的冻结副本。',
    },
    Sources: {
        order: 9,
        title: '音源（Folium 2）',
        intro: '`folium: 2` 的音源类模组（`mod.json` 里声明了 `sources`）在 client 入口里用 `folium.sources.register` 注册音源：注册字段加上一组带版本的能力（`search@1`、`songs@1`、`playback.audio@1` …），宿主按实现了哪些能力、其中哪些成员在推导界面上的开关。`folium.sources.supports(id, version)` 说这个宿主实现了哪些能力；`folium.omni.capability` 取别的音源的自定义能力。这一节来自 [`src/mods/folium/sources/contract.ts`](../../src/mods/folium/sources/contract.ts)。`folium: 1` 的模组没有这些成员。',
    },
    Experimental: {
        order: 10,
        title: '实验接口',
        intro: '需要在 `mod.json` 的 `experimental` 里选用，经 `folium.experimental[name]` 访问；任何 minor 版本都可能变化。',
    },
    'Main API': {
        order: 11,
        title: 'main 入口（Node）',
        intro: '`mod.json` 的 `main` 指向一个 `.cjs` / `.js` 文件，它导出的 `activate(api)`（[FoliumMainModule](#foliummainmodule)）在 Folia 的主进程里运行，参数是 [FoliumMainApi](#foliummainapi)。这一节来自 [`src/mods/folium/mainContract.ts`](../../src/mods/folium/mainContract.ts)。',
    },
    'Source main API': {
        order: 12,
        title: '音源类模组的 main 入口',
        intro: '音源类模组的 main 入口拿到的 `api` 比普通模组多下面这些成员（[FoliumSourceMainApi](#foliumsourcemainapi)，方案 §5.5），也不受普通模组的网络、存储限额约束；普通模组的 `api` 没有它们。',
    },
    Basics: {
        order: 13,
        title: '基础类型',
        intro: '',
    },
};

// The section of mainContract.ts: the types of the main entry's `api` and what it hands out. They render
// under the main entry heading, never under the client entry.
export const MAIN_ENTRY_SECTION = 'Main API';

const anchorOf = (name) => name.toLowerCase();

const escapeCell = (value) => value.replace(/\|/g, '\\|').replace(/\n+/g, ' ');

/* Folium type names mentioned in `text`, excluding `self`, that the reference documents. */
const referencedTypes = (text, known, self) => [...new Set(text.match(/\bFolium[A-Z]\w*/g) ?? [])]
    .filter((name) => name !== self && known.has(name));

const renderReferences = (names) => (names.length > 0
    ? `\n相关：${names.map((name) => `[${name}](#${anchorOf(name)})`).join(' · ')}\n`
    : '');

/* The interfaces an interface's header extends, by name: `A<T> extends B, C<D>` gives B and C. */
const parentsOf = (item) => {
    let rest = item.header.slice(item.name.length).trimStart();
    if (rest.startsWith('<')) {
        // Skip the type parameters: an `extends` inside them is a constraint, not a parent.
        let depth = 0;
        let end = 0;
        for (; end < rest.length; end += 1) {
            if (rest[end] === '<') depth += 1;
            else if (rest[end] === '>' && (depth -= 1) === 0) break;
        }
        rest = rest.slice(end + 1).trimStart();
    }
    const match = /^extends\s+(.+)$/.exec(rest);
    return match ? match[1].split(',').map((parent) => parent.trim().replace(/<.*$/, '')) : [];
};

/*
 * The members an interface takes from the interfaces it extends, nearest first, each with the
 * interface it is written in. A member the interface itself has (or a nearer one) is left out.
 */
const inheritedMembers = (item, interfaces) => {
    const seen = new Set(item.members.map((member) => member.name));
    const inherited = [];
    const visit = (current) => {
        for (const name of parentsOf(current)) {
            const parent = interfaces.get(name);
            if (!parent) continue;
            for (const member of parent.members) {
                if (seen.has(member.name)) continue;
                seen.add(member.name);
                inherited.push({ member, from: parent.name });
            }
            visit(parent);
        }
    };
    visit(item);
    return inherited;
};

const renderMemberRow = (member, note = '') => {
    const name = `${member.readonly ? 'readonly ' : ''}${member.name}${member.optional ? '?' : ''}${member.method ? '()' : ''}`;
    return `| \`${escapeCell(name)}\` | \`${escapeCell(member.type)}\` | ${escapeCell(`${note}${member.doc}`)} |`;
};

const renderItem = (item, known, interfaces) => {
    const lines = [`### ${item.name}`, ''];
    if (item.doc) lines.push(item.doc, '');
    if (item.kind === 'interface') {
        const signature = `interface ${item.header}`;
        if (signature !== `interface ${item.name}`) lines.push('```ts', signature, '```', '');
        const inherited = inheritedMembers(item, interfaces);
        if (item.members.length > 0 || inherited.length > 0) {
            lines.push('| 成员 | 类型 | 说明 |', '| --- | --- | --- |');
            for (const member of item.members) {
                lines.push(renderMemberRow(member));
                // The members of an inline object type, each on a row of its own under the member's name.
                for (const child of member.children ?? []) lines.push(renderMemberRow({ ...child, name: `${member.name}.${child.name}` }));
            }
            for (const { member, from } of inherited) {
                lines.push(renderMemberRow(member, `继承自 [${from}](#${anchorOf(from)})。`));
            }
        }
        const text = [item.header, ...item.members.map((member) => member.type)].join(' ');
        lines.push(renderReferences(referencedTypes(text, known, item.name)));
    } else {
        lines.push('```ts', item.source, '```');
        lines.push(renderReferences(referencedTypes(item.source, known, item.name)));
    }
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
};

const KINDS_HEADING = '注册表一览';
const PERMISSIONS_HEADING = '权限一览';
const EVENTS_HEADING = '事件一览';

/*
 * The table of registries: one row per kind, from the kinds table. The definition type of each
 * comes from the contract's FoliumRegistries (`visualizers: FoliumRegistry<FoliumVisualizerDef>`).
 */
const renderKinds = (items) => {
    const registries = items.find((item) => item.name === 'FoliumRegistries');
    const defOf = (name) => /FoliumRegistry<(\w+)/.exec(registries?.members.find((member) => member.name === name)?.type ?? '')?.[1];
    const lines = [
        `### ${KINDS_HEADING}`,
        '',
        '本表由宿主里那张条目种类表（`src/mods/folium/kinds.ts`）生成。',
        '',
        '| 注册表 | 用途 | 条目定义 | 需要的权限 | 导出窗口里 | 容器的 `data-folium-kind` |',
        '| --- | --- | --- | --- | --- | --- |',
    ];
    for (const [name, kind] of Object.entries(FOLIUM_KINDS)) {
        const def = defOf(name);
        const marks = Object.keys(kind.mounts);
        lines.push(`| ${[
            `\`${name}\``,
            escapeCell(kind.use),
            def ? `[${def}](#${anchorOf(def)})` : '—',
            kind.permission === null ? '—' : `\`${kind.permission}\``,
            kind.uiOnly ? '不生效' : '生效',
            marks.length > 0 ? marks.map((mark) => `\`${mark}\``).join('、') : '—',
        ].join(' | ')} |`);
    }
    lines.push(
        '',
        '「导出窗口里不生效」的注册表在导出窗口里照常调用、照常返回句柄，但什么都不登记，所以同一份代码两边都能跑。',
        '需要权限的注册表，模组没有在 `mod.json` 里声明这个权限时，`register` 抛 `permission-denied:<权限>`。',
        '最后一列是这种条目的容器外层 `data-folium-kind` 属性的取值（没有容器的写 —）。',
    );
    return lines.join('\n');
};

/* The table of permissions: one row per permission in foliumShared.json, with the members it guards. */
const renderPermissions = () => {
    const lines = [
        `### ${PERMISSIONS_HEADING}`,
        '',
        '本表由 `electron/modSystem/foliumShared.json` 里每个权限的 `guards` 生成，`npm run folium:check` 用同一张表查模组用到的成员。'
            + "`platform.*` 两行例外：模组只能写成 `folium.experimental['platform.raw']`，表里的成员名只是说明；"
            + "`folium:check` 改为按代码里 `request('<平台>', …)` 写出的平台 id 查 `platform.<平台>.read`，`.write` 要看调的是哪个接口，查不到。",
        '',
        '| 权限 | 解锁的成员 |',
        '| --- | --- |',
    ];
    for (const [id, permission] of Object.entries(readFoliumShared().permissions)) {
        lines.push(`| \`${id}\` | ${permission.guards.map((member) => `\`${member}\``).join('、')} |`);
    }
    lines.push(
        '',
        '`folium.*` 是 client 入口的成员，`api.*` 是 main 入口的成员；写到哪一级就管到哪一级，`folium.storage` 管它下面的全部方法。',
        '模组没有在 `mod.json` 的 `permissions` 里声明这个权限就调用时，同步的成员抛 `permission-denied:<权限>`，异步的成员返回的 promise 以同一个错误拒绝。',
        '`platform.<平台>.read` / `.write` 管的是实验接口 `platform.raw` 的 `request` 能调这个平台的哪一类接口：读接口要 read，改动账号的接口还要 write（表里的 `request.write` 指这一类接口，不是一个成员）；两者都要在 `experimental` 里选用 `platform.raw`，声明 write 也要同时声明 read。',
    );
    return lines.join('\n');
};

/* The table of events: one row per event type, from the event types table. */
const renderEvents = () => {
    const lines = [
        `### ${EVENTS_HEADING}`,
        '',
        '本表由宿主里那张事件类型表（`src/mods/folium/eventTypes.ts`）生成。',
        '',
        '| 事件 | 方式 | 需要选用的实验接口 |',
        '| --- | --- | --- |',
    ];
    for (const [name, type] of Object.entries(FOLIUM_EVENT_TYPES)) {
        lines.push(`| \`${name}\` | ${type.dispatch === 'hook' ? '钩子' : '通知'} | ${type.experimental === null ? '—' : `\`${type.experimental}\``} |`);
    }
    lines.push(
        '',
        '每个事件带的内容见 [FoliumNotificationEvents](#foliumnotificationevents) 与 [FoliumHookEvents](#foliumhookevents)。',
        '不在表里的名字，`folium.events.on` 抛 `unknown-event:<名字>`；需要选用实验接口的事件，没有在 `mod.json` 的 `experimental` 里选用就监听时抛 `experimental-not-declared:<接口>`。',
    );
    return lines.join('\n');
};

const OLD_NAMES_HEADING = '仍可用的旧名字';

/*
 * Folium 1.6 only: the names Folium 2 removes, which still work and warn, from the two deprecation tables.
 * Step 2 deletes this and its two uses in renderApiDocs.
 */
const oldNamesSection = () => {
    // A name as code; a description (it has spaces) as text.
    const code = (text) => (/\s/.test(text) ? escapeCell(text) : `\`${escapeCell(text)}\``);
    const now = (row) => (row.now === null ? escapeCell(foliumOldNameAdvice(row)) : code(row.now));
    const lines = [
        `## ${OLD_NAMES_HEADING}`,
        '',
        '为 Folium 1.5 写的模组在 Folium 1.x 里照旧能用下面这些名字；模组用到哪一个，设置里这个模组那一行就提醒一次。Folium 2 起它们不再有效。本表由 `src/mods/folium/deprecated/oldNames.ts` 和 `electron/modSystem/deprecated.cjs` 生成，`npm run folium:check` 用同样的表把它们列为提醒。',
        '',
        '| 旧名字 | 现在写 | 在哪里 |',
        '| --- | --- | --- |',
        ...Object.values(FOLIUM_OLD_CLIENT_NAMES).map((row) => `| ${code(row.old)} | ${now(row)} | client 入口 |`),
        ...Object.values(OLD_MAIN_NAMES).map((row) => `| ${code(row.old)} | ${now(row)} | main 入口 |`),
        ...Object.entries(OLD_PERMISSIONS).map(([old, id]) => `| 权限 ${code(old)} | ${code(id)} | mod.json |`),
        '| mod.json 不认识的字段 | 只提醒；Folium 2 起是错误，模组不加载 | mod.json |',
    ];
    return lines.join('\n');
};

// The generated tables, by the contract section they go under, each with its heading for the contents.
const TABLES = {
    'Client API': { heading: PERMISSIONS_HEADING, render: renderPermissions },
    'Registry definitions': { heading: KINDS_HEADING, render: renderKinds },
    Events: { heading: EVENTS_HEADING, render: renderEvents },
};

/* The whole reference as markdown, from the texts of the contract, the main contract and the sources contract. */
export const renderApiDocs = (contractText, mainContractText, sourcesContractText = readSourcesContract()) => {
    const sections = [...parseContract(contractText), ...parseContract(sourcesContractText), ...parseContract(mainContractText)]
        .map((section) => ({ ...section, info: SECTION_INFO[section.title] ?? { order: 99, title: section.title, intro: '' } }))
        .sort((left, right) => left.info.order - right.info.order);
    const items = sections.flatMap((section) => section.items);
    const known = new Set(items.map((item) => item.name));
    const interfaces = new Map(items.filter((item) => item.kind === 'interface').map((item) => [item.name, item]));
    const preview = sourcesPreview();
    const version = /FOLIUM_VERSION = Object\.freeze\(\{ major: (\d+), minor: (\d+) \}\)/.exec(contractText);
    if (!version) throw new Error('contract.ts has no FOLIUM_VERSION = Object.freeze({ major, minor })');

    const out = [
        '<!-- 本文件由 `npm run folium:api` 从 src/mods/folium/contract.ts、sources/contract.ts 和 mainContract.ts 生成，请勿手动修改。 -->',
        '',
        '# Folium API 参考',
        '',
        `当前契约版本：**Folium ${version[1]}.${version[2]}**。`,
        '',
        ...(preview ? [SOURCES_PREVIEW_NOTE, ''] : []),
        '本文列出模组能用到的全部公开类型，内容直接来自契约文件 [`src/mods/folium/contract.ts`](../../src/mods/folium/contract.ts)',
        '（client 入口）、[`src/mods/folium/sources/contract.ts`](../../src/mods/folium/sources/contract.ts)（音源）与 [`src/mods/folium/mainContract.ts`](../../src/mods/folium/mainContract.ts)（main 入口），',
        '`mod.json` 写 `"folium": 1` 的模组看到的接口冻结在 Folium 1.9（`folium.host.folium` 读到 1.9，没有标着 Folium 2 的成员）。',
        '成员说明保留契约里的原文注释。平台规则（清单、权限、生命周期、安全模型）见 [Folium 规范](../../mods/README.md)，',
        '从零开始写模组、调试与发布到模组市场见 [模组开发与贡献指南](contributing.md)。',
        '',
        '## 目录',
        '',
        ...sections.map((section) => `- **${section.info.title}**：${[
            ...(TABLES[section.title] ? [`[${TABLES[section.title].heading}](#${TABLES[section.title].heading})`] : []),
            ...section.items.map((item) => `[${item.name}](#${anchorOf(item.name)})`),
        ].join(' · ')}`),
        `- **[${OLD_NAMES_HEADING}](#${OLD_NAMES_HEADING})**`,
        '',
    ];
    for (const section of sections) {
        out.push(`## ${section.info.title}`, '');
        if (preview && SOURCES_PREVIEW_SECTIONS.includes(section.title)) out.push(SOURCES_PREVIEW_NOTE, '');
        if (section.info.intro) out.push(section.info.intro, '');
        if (TABLES[section.title]) out.push(TABLES[section.title].render(items), '');
        for (const item of section.items) out.push(renderItem(item, known, interfaces), '');
    }
    out.push(oldNamesSection(), '');
    return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const next = renderApiDocs(fs.readFileSync(CONTRACT_PATH, 'utf8'), fs.readFileSync(MAIN_CONTRACT_PATH, 'utf8'));
    if (process.argv.includes('--check')) {
        const current = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, 'utf8') : '';
        if (current !== next) {
            console.error('docs/folium/api.md is out of date: run `npm run folium:api`');
            process.exit(1);
        }
        console.log('docs/folium/api.md is up to date');
    } else {
        fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
        fs.writeFileSync(OUTPUT_PATH, next);
        console.log(`wrote ${path.relative(ROOT, OUTPUT_PATH)}`);
    }
}
