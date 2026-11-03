import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// dev/nebbia/nebbiaStrokesPlugin.mjs
// 构建时生成雾笺的笔顺数据 nebbia-strokes.json（运行时由 src/components/visualizer/nebbia/nebbiaStrokes.ts 读）：
// 从钉死 commit 的 AnimCJK 下载 graphics 数据，抽出每个字的笔画中线，和 AnimCJK 的授权文本一起输出到构建产物根目录。
// 用到的 graphics 文本文件按 AnimCJK 的 COPYING 只有 Arphic Public License（可选 LGPL 的只是假名等 SVG），不进仓库，每次构建现下（有缓存）。
// 下载失败只警告、不让构建失败：没有这个文件时运行时退回字体骨架追踪。设 FOLIA_NEBBIA_STROKES=off 跳过。

const ANIMCJK_COMMIT = '99dba566b92daf45ae20d05e6c91d3f68d8619f2';
const ANIMCJK_RAW = `https://raw.githubusercontent.com/parsimonhi/animCJK/${ANIMCJK_COMMIT}`;

// 顺序就是优先级：假名 → 简体中文 → 日文汉字（中文按简体笔顺，日文独有的字形再用日文数据补）
const GRAPHICS = [
    { file: 'graphicsJaKana.txt', sha256: '3f61aee523e2cf95e76240b760234a1c6c437d4e9308dca88723178dd8bdb61c' },
    { file: 'graphicsZhHans.txt', sha256: '3bb2150fe12edc7d82e18df0044c3e942aca6b8f399f8fd17aa0eee5197cbd62' },
    { file: 'graphicsJa.txt', sha256: '3b2d95465152fb2a7e108774219e969c43af14f1e51e66498bc96522a674cfeb' },
];

// 随数据一起分发的授权文本：AnimCJK 的 COPYING、Arphic Public License 原文
const LICENSES = [
    { file: 'licenses/COPYING.txt', out: 'COPYING.txt', sha256: '19baa5148c9709776a95d78bf451a909086d7eb424b548c044c70fc1bf8330f2' },
    { file: 'licenses/APL/english/ARPHICPL.TXT', out: 'ARPHICPL.TXT', sha256: '3a5e90c0957524a89e48203febcd4492ca4393678abaa7e5b4d70f3ff32b386d' },
];

export const STROKES_FILE = 'nebbia-strokes.json';
export const LICENSE_DIR = 'licenses/nebbia-strokes';

// 改了生成方式就加一（旧缓存作废），同时把 CHANGED_ON 改成那天：APL 第 2(a) 条要写明怎么改、什么时候改的
const FORMAT_VERSION = 2;
const CHANGED_ON = '2026-10-30';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE_DIR = path.join(ROOT, 'node_modules', '.cache', 'folia-nebbia-strokes', `${ANIMCJK_COMMIT.slice(0, 12)}-v${FORMAT_VERSION}`);
const DOWNLOAD_TIMEOUT_MS = 180_000;

// 写进 JSON 自己（' notice' 键，运行时只按单个字查，碰不到它）和 licenses/nebbia-strokes/NOTICE.txt
export const CHANGE_NOTICE = `Modified on ${CHANGED_ON} by the Folia project from AnimCJK `
    + `<https://github.com/parsimonhi/animCJK> commit ${ANIMCJK_COMMIT} (graphicsJaKana.txt, graphicsZhHans.txt, graphicsJa.txt): `
    + 'only the "medians" of each character are kept, outlines and other fields are dropped; y is flipped to point down '
    + "(y' = 900 - y, a 1024 grid); strokes outside the grid (kana animation helpers) are removed; a character in more than "
    + 'one file is taken from the first of them in the order above. Distributed under the Arphic Public License, see '
    + `${LICENSE_DIR}/ARPHICPL.TXT and COPYING.txt.`;

const NOTICE = `nebbia-strokes.json - stroke medians for Folia's 雾笺 (Nebbia) lyric style

Derived from AnimCJK <https://github.com/parsimonhi/animCJK>, commit ${ANIMCJK_COMMIT}.
AnimCJK - Copyright 2016-2026 - FM&SH. Its graphics data derive from the Arphic PL KaitiM
GB / Big5 fonts and the Makemeahanzi project; see COPYING.txt.

${CHANGE_NOTICE}

The graphics text files this is made from are licensed by AnimCJK under the Arphic Public
License only (ARPHICPL.TXT), and so is this file. The program that produces it from those
files is dev/nebbia/nebbiaStrokesPlugin.mjs in the Folia repository
<https://github.com/chthollyphile/folia-major>.
`;

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

/** 下载 AnimCJK 的一个文件并核对 sha256；不对就抛错，不用错的数据。 */
const fetchPinned = async ({ file, sha256: expected }) => {
    const response = await fetch(`${ANIMCJK_RAW}/${file}`, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`下载 ${file} 失败：HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const actual = sha256(buffer);
    if (actual !== expected) throw new Error(`${file} 的 sha256 不对：${actual}`);
    return buffer;
};

/**
 * 把 graphics 文件（每行一个字的 JSON）合成 { 字: 笔画中线[] }。
 * @param {string[]} graphicsTexts
 * @returns {Record<string, [number, number][][]>}
 */
export const buildStrokeData = (graphicsTexts) => {
    /** @type {Record<string, [number, number][][]>} */
    const out = {};
    for (const text of graphicsTexts) {
        for (const line of text.split('\n')) {
            if (!line.trim()) continue;
            const entry = JSON.parse(line);
            if (out[entry.character]) continue;
            // 假名数据里有落在 1024 方格外的辅助笔画（动画裁切用），丢掉
            out[entry.character] = entry.medians
                .map(median => median.map(([x, y]) => [x, 900 - y]))
                .filter(median => median.every(([x, y]) => x > -20 && x < 1044 && y > -20 && y < 1044));
        }
    }
    return out;
};

/** 写缓存：先写临时文件再改名，写到一半被打断不会留下半个文件。 */
const writeAtomic = async (file, buffer) => {
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, buffer);
    await fs.rename(temporary, file);
};

/** 读一份缓存：缺文件或 JSON 坏了（写到一半被打断等）返回 null，由调用方整份重新生成。 */
export const readCache = async (dir) => {
    try {
        const licenses = [];
        for (const item of LICENSES) licenses.push([item.out, await fs.readFile(path.join(dir, item.out))]);
        return { strokes: JSON.parse(await fs.readFile(path.join(dir, STROKES_FILE), 'utf8')), licenses };
    } catch {
        return null;
    }
};

/** 下载并生成笔画中线和授权文本，缓存在 CACHE_DIR；缓存读得通就不再下载。 */
const loadSources = async () => {
    const cached = await readCache(CACHE_DIR);
    if (cached) return cached;
    const strokesCache = path.join(CACHE_DIR, STROKES_FILE);
    const graphics = [];
    for (const item of GRAPHICS) graphics.push((await fetchPinned(item)).toString('utf8'));
    const licenses = [];
    for (const item of LICENSES) licenses.push([item.out, await fetchPinned(item)]);
    const strokes = buildStrokeData(graphics);
    await fs.mkdir(CACHE_DIR, { recursive: true });
    for (const [out, buffer] of licenses) await writeAtomic(path.join(CACHE_DIR, out), buffer);
    await writeAtomic(strokesCache, Buffer.from(JSON.stringify(strokes)));
    return { strokes, licenses };
};

/**
 * 产物里的文件：{ 路径: 内容 }。说明文字每次从常量生成，不进缓存；JSON 自己带 ' notice'（APL 第 2(a) 条）。
 * @param {{ strokes: Record<string, unknown>, licenses: [string, Buffer][] }} sources
 */
export const bundleFiles = ({ strokes, licenses }) => new Map([
    [STROKES_FILE, Buffer.from(JSON.stringify({ ' notice': CHANGE_NOTICE, ...strokes }))],
    [`${LICENSE_DIR}/NOTICE.txt`, Buffer.from(NOTICE)],
    ...licenses.map(([out, buffer]) => [`${LICENSE_DIR}/${out}`, buffer]),
]);

const generate = async () => bundleFiles(await loadSources());

let pending = null;
const generateOnce = () => {
    pending ??= generate().catch(error => {
        pending = null;
        throw error;
    });
    return pending;
};

const disabled = () => ['off', '0', 'false'].includes(String(process.env.FOLIA_NEBBIA_STROKES ?? '').toLowerCase());

export function nebbiaStrokesPlugin() {
    let warned = false;
    const warn = (logger, error) => {
        if (warned) return;
        warned = true;
        const cause = error?.cause ? `（${error.cause.message ?? error.cause}）` : '';
        logger.warn(`[nebbia-strokes] 没有生成笔顺数据，雾笺的中日文退回字体骨架追踪：${error?.message ?? error}${cause}`);
    };
    return {
        name: 'nebbia-strokes',
        configureServer(server) {
            // 开发时按需生成：第一次请求这个文件（打开雾笺）时才下载
            server.middlewares.use(async (req, res, next) => {
                const url = (req.url ?? '').split('?')[0];
                // Electron 构建的 base 是 ./，开发服务器上仍从根路径取
                const base = server.config.base.startsWith('/') ? server.config.base.replace(/\/?$/, '/') : '/';
                if (!url.startsWith(base) || disabled()) return next();
                // 这几个文件名都是 ASCII，按原样比，不解码（坏的百分号编码会让 decodeURIComponent 抛错）
                const name = url.slice(base.length);
                if (name !== STROKES_FILE && !name.startsWith(`${LICENSE_DIR}/`)) return next();
                try {
                    const buffer = (await generateOnce()).get(name);
                    if (!buffer) return next();
                    res.setHeader('Content-Type', name.endsWith('.json') ? 'application/json' : 'text/plain; charset=utf-8');
                    res.end(buffer);
                } catch (error) {
                    warn(server.config.logger, error);
                    next();
                }
            });
        },
        async generateBundle() {
            if (disabled()) return;
            try {
                for (const [fileName, source] of await generateOnce()) this.emitFile({ type: 'asset', fileName, source });
            } catch (error) {
                warn({ warn: message => this.warn(message) }, error);
            }
        },
    };
}
