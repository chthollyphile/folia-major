// dev/mcp/ts-code-map/format.mjs

/**
 * 紧凑文本渲染层。
 *
 * 这一层才是这个 MCP 的价值本体：原始 LSP JSON 比源码还大（VisualizerFume.tsx 的
 * documentSymbol JSON 是 244KB，文件本身才 125KB），直接透传等于什么都没省。
 * 所有工具的输出都要过这里，并且必须带上限和截断说明。
 */

const SYMBOL_KIND_NAMES = {
    1: 'file', 2: 'module', 3: 'namespace', 4: 'package', 5: 'class', 6: 'method',
    7: 'property', 8: 'field', 9: 'constructor', 10: 'enum', 11: 'interface',
    12: 'function', 13: 'var', 14: 'const', 15: 'string', 16: 'number', 17: 'bool',
    18: 'array', 19: 'object', 20: 'key', 21: 'null', 22: 'enum-member',
    23: 'struct', 24: 'event', 25: 'operator', 26: 'type-param',
};

export const kindName = kind => SYMBOL_KIND_NAMES[kind] ?? `kind${kind}`;

/** LSP 的 line 是 0-based，编辑器和 agent 说的行号是 1-based。所有对外输出都用 1-based。 */
export const toDisplayLine = lspLine => lspLine + 1;

export const location = (relPath, lspLine) => `${relPath}:${toDisplayLine(lspLine)}`;

/**
 * 统一的截断收尾。永远显式告诉调用方被截了多少，否则 agent 会把截断结果当成完整答案。
 */
export function withTruncation(lines, total, limit, hint = 'limit') {
    if (total <= lines.length) return lines.join('\n');
    return [...lines, `… 还有 ${total - lines.length} 条未显示（提高 ${hint} 查看）`].join('\n');
}

/** 折叠 hover 返回的 markdown 代码块，压成一行签名。 */
export function compactSignature(hoverContents, maxLength = 400) {
    if (!hoverContents) return '';
    const raw = typeof hoverContents === 'string' ? hoverContents
        : typeof hoverContents.value === 'string' ? hoverContents.value
        : Array.isArray(hoverContents) ? hoverContents.map(c => c?.value ?? c).join('\n')
        : '';
    const signature = raw
        .replace(/```[a-z]*\n?/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    return signature.length > maxLength ? `${signature.slice(0, maxLength)}…` : signature;
}

/** 从 hover 里摘出 JSDoc 正文（代码块之后的散文部分）。 */
export function extractDoc(hoverContents, maxLength = 300) {
    const raw = typeof hoverContents?.value === 'string' ? hoverContents.value : '';
    const afterCode = raw.split('```').slice(2).join('```').trim();
    if (!afterCode) return '';
    const doc = afterCode.replace(/\s+/g, ' ').trim();
    return doc.length > maxLength ? `${doc.slice(0, maxLength)}…` : doc;
}

/**
 * 符号排序：精确匹配 > 前缀匹配 > 子串匹配；同档内源码优先于测试，浅路径优先于深路径。
 * 没有这层排序时 workspace/symbol 对 "omni" 会返回 256 条无序结果。
 */
export function rankSymbols(symbols, query, relOf) {
    const lowered = query.toLowerCase();
    const score = symbol => {
        const name = symbol.name.toLowerCase();
        const rel = relOf(symbol);
        let base = name === lowered ? 0 : name.startsWith(lowered) ? 1 : 2;
        if (/(^|\/)(test|tests)\//.test(rel) || /\.(test|spec)\.[tj]sx?$/.test(rel)) base += 4;
        if (rel.endsWith('.d.ts')) base += 2;
        if (rel.startsWith('node_modules/')) base += 8;
        return base * 100 + Math.min(rel.split('/').length, 20);
    };
    return [...symbols].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
}

/** documentSymbol 只报「有成员」的种类才值得展开；函数的 children 其实是解构出来的参数。 */
export const CONTAINER_KINDS = new Set([2, 3, 5, 10, 11, 19, 23]);

/**
 * TS 的 SymbolKind 对 TS 特有的写法很粗糙：`const f = () => {}` 报成 var，
 * 类型别名报成 class。声明行就摆在那儿，读一眼比信 kind 数字准。
 */
export function refineKind(kind, sourceLine, name) {
    if (!sourceLine) return kindName(kind);
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\binterface\\s+${escaped}\\b`).test(sourceLine)) return 'interface';
    if (new RegExp(`\\btype\\s+${escaped}\\b`).test(sourceLine)) return 'type';
    if (new RegExp(`\\bclass\\s+${escaped}\\b`).test(sourceLine)) return 'class';
    if (new RegExp(`\\benum\\s+${escaped}\\b`).test(sourceLine)) return 'enum';
    if (new RegExp(`\\bfunction\\s+${escaped}\\b`).test(sourceLine)) return 'function';
    // const f = (...) => / const f = async / const C: React.FC
    if (new RegExp(`\\b(const|let|var)\\s+${escaped}\\s*(:\\s*React\\.(FC|FunctionComponent)|[:=][^=]*?(\\(|async\\b|function\\b))`).test(sourceLine)) {
        return 'function';
    }
    return kindName(kind);
}

/** 影响面按目录归类，否则大符号的引用列表会刷屏。 */
const AREA_RULES = [
    [/^src\/components\//, 'components'],
    [/^src\/hooks\//, 'hooks'],
    [/^src\/stores\//, 'stores'],
    [/^src\/services\//, 'services'],
    [/^src\/utils\//, 'utils'],
    [/^src\/types/, 'types'],
    [/^src\/workers\//, 'workers'],
    [/^src\/i18n\//, 'i18n'],
    [/^(test|dev)\//, 'test/dev'],
    [/^(electron|worker|api|api-ts|sync-server|shared)\//, 'backend/electron'],
    [/^src\//, 'src (其他)'],
];

export const areaOf = rel => AREA_RULES.find(([pattern]) => pattern.test(rel))?.[1] ?? '其他';

/** 分桶渲染：每桶给计数，只列前 perBucket 个，超出的用一行说明带过。 */
export function renderBuckets(paths, perBucket = 5) {
    const buckets = new Map();
    for (const rel of paths) {
        if (!buckets.has(areaOf(rel))) buckets.set(areaOf(rel), []);
        buckets.get(areaOf(rel)).push(rel);
    }
    const out = [];
    for (const [area, items] of [...buckets].sort((a, b) => b[1].length - a[1].length)) {
        out.push(`  ${area} (${items.length}):`);
        for (const rel of items.slice(0, perBucket)) out.push(`    ${rel}`);
        if (items.length > perBucket) out.push(`    … 还有 ${items.length - perBucket} 个`);
    }
    return out;
}
