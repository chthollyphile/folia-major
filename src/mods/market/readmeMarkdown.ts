// src/mods/market/readmeMarkdown.ts
// A small Markdown reader for mod README files: headings, paragraphs, lists, quotes, code blocks, rules,
// and inline code, bold, italic, links and images. It makes a tree of plain values that ReadmeView turns
// into React elements; no HTML is ever produced or passed through, so raw HTML in a README shows as text.
// Links keep only https addresses; images keep only addresses under the market site (`imageOrigin`).

export type ReadmeInline =
    | { type: 'text'; text: string }
    | { type: 'code'; text: string }
    | { type: 'strong'; children: ReadmeInline[] }
    | { type: 'em'; children: ReadmeInline[] }
    | { type: 'link'; href: string; children: ReadmeInline[] }
    | { type: 'image'; src: string; alt: string };

export type ReadmeBlock =
    | { type: 'heading'; level: 1 | 2 | 3 | 4; children: ReadmeInline[] }
    | { type: 'paragraph'; children: ReadmeInline[] }
    | { type: 'list'; ordered: boolean; items: ReadmeInline[][] }
    | { type: 'quote'; children: ReadmeInline[] }
    | { type: 'code'; text: string }
    | { type: 'rule' };

const MAX_BLOCKS = 600;
const MAX_DEPTH = 4;
// How far a marker looks for its other half. A README is someone else's text and is read on the window's own
// thread: a line of ten thousand unclosed `[` or `` ` `` must not make each of them scan to its end.
const MAX_SPAN = 2048;

/** `needle` at or after `from`, no further than MAX_SPAN on; -1 when it is not there. */
const findWithin = (text: string, needle: string, from: number): number => {
    const found = text.indexOf(needle, from);
    return found >= 0 && found - from <= MAX_SPAN ? found : -1;
};

const httpsHref = (value: string, base: string | null): string | null => {
    try {
        const url = base ? new URL(value, base) : new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
    } catch {
        return null;
    }
};

type InlineOptions = { base: string | null; imageOrigin: string | null };

/** The closing bracket that matches the `[` at `start`, or -1. */
const closingBracket = (text: string, start: number): number => {
    let depth = 0;
    const last = Math.min(text.length, start + MAX_SPAN);
    for (let index = start; index < last; index += 1) {
        const char = text[index];
        if (char === '\\') { index += 1; continue; }
        if (char === '[') depth += 1;
        else if (char === ']') {
            depth -= 1;
            if (depth === 0) return index;
        }
    }
    return -1;
};

export const parseReadmeInline = (text: string, options: InlineOptions, depth = 0): ReadmeInline[] => {
    const out: ReadmeInline[] = [];
    let buffer = '';
    const flush = () => {
        if (buffer) out.push({ type: 'text', text: buffer });
        buffer = '';
    };
    let index = 0;
    while (index < text.length) {
        const char = text[index];
        if (char === '\\' && index + 1 < text.length && /[\\`*_[\]()#!>-]/.test(text[index + 1])) {
            buffer += text[index + 1];
            index += 2;
            continue;
        }
        if (char === '`') {
            const end = findWithin(text, '`', index + 1);
            if (end > index) {
                flush();
                out.push({ type: 'code', text: text.slice(index + 1, end) });
                index = end + 1;
                continue;
            }
        }
        if (depth < MAX_DEPTH && (char === '*' || char === '_')) {
            const double = text[index + 1] === char;
            const marker = double ? char + char : char;
            const end = findWithin(text, marker, index + marker.length);
            // `snake_case` words keep their underscores: an `_` emphasis must start a word.
            const startsWord = char === '*' || index === 0 || /\s|[([]/.test(text[index - 1]);
            if (startsWord && end > index + marker.length && text[index + marker.length] !== ' ') {
                flush();
                const children = parseReadmeInline(text.slice(index + marker.length, end), options, depth + 1);
                out.push(double ? { type: 'strong', children } : { type: 'em', children });
                index = end + marker.length;
                continue;
            }
        }
        const isImage = char === '!' && text[index + 1] === '[';
        if (char === '[' || isImage) {
            const open = isImage ? index + 1 : index;
            const close = closingBracket(text, open);
            if (close > open && text[close + 1] === '(') {
                const end = findWithin(text, ')', close + 2);
                if (end > close) {
                    const label = text.slice(open + 1, close);
                    const target = text.slice(close + 2, end).trim().split(/\s+/)[0] ?? '';
                    const href = httpsHref(target, options.base);
                    flush();
                    if (isImage) {
                        const allowed = href && options.imageOrigin && href.startsWith(`${options.imageOrigin}/`);
                        if (allowed) out.push({ type: 'image', src: href, alt: label });
                        else if (href) out.push({ type: 'link', href, children: [{ type: 'text', text: label || href }] });
                        else if (label) out.push({ type: 'text', text: label });
                    } else if (href && depth < MAX_DEPTH) {
                        out.push({ type: 'link', href, children: parseReadmeInline(label, options, depth + 1) });
                    } else if (depth < MAX_DEPTH) {
                        out.push(...parseReadmeInline(label, options, depth + 1));
                    } else {
                        // Nested deeper than links are read: the rest is plain text, so no README can recurse without end.
                        out.push({ type: 'text', text: label });
                    }
                    index = end + 1;
                    continue;
                }
            }
        }
        if (char === '<') {
            const end = findWithin(text, '>', index + 1);
            const inner = end > index ? text.slice(index + 1, end) : '';
            const href = /^https:\/\/\S+$/.test(inner) ? httpsHref(inner, null) : null;
            if (href) {
                flush();
                out.push({ type: 'link', href, children: [{ type: 'text', text: inner }] });
                index = end + 1;
                continue;
            }
        }
        buffer += char;
        index += 1;
    }
    flush();
    return out;
};

const LIST_ITEM = /^\s{0,3}([-*+]|\d{1,9}[.)])\s+(.*)$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s{0,3}(```|~~~)/;

/*
 * Reads a README. `base` is the README's own address, for relative links; `imageOrigin` the market site, the
 * only place images are loaded from. The first heading 1 is kept (the view shows it under its own title).
 */
export const parseReadme = (source: string, { base = null, imageOrigin = null }: { base?: string | null; imageOrigin?: string | null } = {}): ReadmeBlock[] => {
    const options: InlineOptions = { base, imageOrigin };
    const inline = (text: string) => parseReadmeInline(text, options);
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    const blocks: ReadmeBlock[] = [];
    let paragraph: string[] = [];
    let list: { ordered: boolean; items: string[] } | null = null;
    let quote: string[] = [];

    const flushParagraph = () => {
        if (paragraph.length > 0) blocks.push({ type: 'paragraph', children: inline(paragraph.join(' ')) });
        paragraph = [];
    };
    const flushList = () => {
        if (list) blocks.push({ type: 'list', ordered: list.ordered, items: list.items.map(inline) });
        list = null;
    };
    const flushQuote = () => {
        if (quote.length > 0) blocks.push({ type: 'quote', children: inline(quote.join(' ')) });
        quote = [];
    };
    const flushAll = () => { flushParagraph(); flushList(); flushQuote(); };

    for (let index = 0; index < lines.length && blocks.length < MAX_BLOCKS; index += 1) {
        const line = lines[index];
        const fence = FENCE.exec(line);
        if (fence) {
            flushAll();
            const code: string[] = [];
            index += 1;
            while (index < lines.length && !lines[index].trimStart().startsWith(fence[1])) {
                code.push(lines[index]);
                index += 1;
            }
            blocks.push({ type: 'code', text: code.join('\n') });
            continue;
        }
        if (line.trim() === '') {
            flushAll();
            continue;
        }
        const heading = HEADING.exec(line);
        if (heading) {
            flushAll();
            blocks.push({ type: 'heading', level: Math.min(4, heading[1].length) as 1 | 2 | 3 | 4, children: inline(heading[2]) });
            continue;
        }
        if (RULE.test(line)) {
            flushAll();
            blocks.push({ type: 'rule' });
            continue;
        }
        if (/^\s{0,3}>/.test(line)) {
            flushParagraph();
            flushList();
            quote.push(line.replace(/^\s{0,3}>\s?/, ''));
            continue;
        }
        const item = LIST_ITEM.exec(line);
        if (item) {
            flushParagraph();
            flushQuote();
            const ordered = /\d/.test(item[1]);
            if (!list || list.ordered !== ordered) {
                flushList();
                list = { ordered, items: [] };
            }
            list.items.push(item[2]);
            continue;
        }
        // An indented line under a list item goes on with that item.
        if (list && /^\s{2,}\S/.test(line)) {
            list.items[list.items.length - 1] += ` ${line.trim()}`;
            continue;
        }
        flushList();
        flushQuote();
        paragraph.push(line.trim());
    }
    flushAll();
    return blocks;
};
