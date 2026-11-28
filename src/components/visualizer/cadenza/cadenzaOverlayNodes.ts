import type { OverlayWordFrame, OverlayWordNodes } from './cadenzaTypes';
import { disposeCadenzaHandwriting } from './cadenzaHandwriting';

// src/components/visualizer/cadenza/cadenzaOverlayNodes.ts
// 每个词落点对应的 DOM 叠层节点（外框 / 内框 / 正文 / 逐字 glow），由 RAF 循环直接写样式。

export const createOverlayWordNodes = (): OverlayWordNodes => {
    const outer = document.createElement('div');
    outer.className = 'absolute left-0 top-0';
    outer.setAttribute('aria-hidden', 'true');
    outer.style.transformOrigin = '0 0';

    const inner = document.createElement('div');
    inner.className = 'whitespace-nowrap';
    inner.style.lineHeight = '1';
    inner.style.display = 'inline-block';
    inner.style.position = 'relative';

    const body = document.createElement('span');
    body.style.lineHeight = '1';
    body.style.display = 'block';
    body.style.position = 'relative';
    body.style.zIndex = '1';
    body.style.whiteSpace = 'pre';

    const glow = document.createElement('span');
    glow.style.color = 'transparent';
    glow.style.lineHeight = '1';
    glow.style.display = 'block';
    glow.style.position = 'absolute';
    glow.style.inset = '0';
    glow.style.zIndex = '0';
    glow.style.pointerEvents = 'none';
    glow.style.whiteSpace = 'pre';

    inner.appendChild(body);
    inner.appendChild(glow);
    outer.appendChild(inner);

    return {
        outer,
        inner,
        body,
        glow,
        glyphSpans: [],
        glyphSignature: '',
        written: null,
        glyphShadows: [],
        frame: -1,
        hw: null,
    };
};

/**
 * Writes one frame of a word, skipping every value that is already on the node. Re-assigning
 * `textContent` swaps the text node even when the string is the same, and the font and text
 * are what make the browser lay the word out again - most words keep both for a whole line.
 */
export const writeOverlayWord = (nodes: OverlayWordNodes, next: OverlayWordFrame) => {
    const written = nodes.written;
    if (written?.outerTransform !== next.outerTransform) nodes.outer.style.transform = next.outerTransform;
    if (written?.willChange !== next.willChange) nodes.outer.style.willChange = next.willChange;
    if (written?.font !== next.font) nodes.inner.style.font = next.font;
    if (written?.innerTransform !== next.innerTransform) nodes.inner.style.transform = next.innerTransform;
    // 手写笔画接上时正文是逐字的 span（cadenzaHandwriting.ts），文字由它管
    if (written?.text !== next.text && !nodes.hw) nodes.body.textContent = next.text;
    if (written?.color !== next.color) nodes.body.style.color = next.color;
    if (written?.opacity !== next.opacity) nodes.body.style.opacity = next.opacity;
    if (written?.filter !== next.filter) nodes.body.style.filter = next.filter;
    nodes.written = next;
};

/** Sets a glyph span's text-shadow only when it differs from what the span already has. */
export const writeOverlayGlyphShadow = (nodes: OverlayWordNodes, index: number, shadow: string) => {
    if (nodes.glyphShadows[index] === shadow) return;
    nodes.glyphShadows[index] = shadow;
    nodes.glyphSpans[index]!.style.textShadow = shadow;
};

export const syncOverlayGlyphSpans = (nodes: OverlayWordNodes, texts: string[]) => {
    const glyphSignature = texts.join('\u0001');
    if (nodes.glyphSignature === glyphSignature) {
        return;
    }

    nodes.glow.replaceChildren();
    nodes.glyphSpans = texts.map(text => {
        const span = document.createElement('span');
        span.textContent = text;
        span.style.color = 'transparent';
        span.style.lineHeight = '1';
        nodes.glow.appendChild(span);
        return span;
    });
    nodes.glyphShadows = [];
    nodes.glyphSignature = glyphSignature;
};

/** 移除一个落点的节点（连同手写笔画的遮罩）。 */
export const removeOverlayWordNodes = (nodes: OverlayWordNodes) => {
    disposeCadenzaHandwriting(nodes);
    nodes.outer.remove();
};

export const clearOverlayWordNodes = (overlayNodes: Map<string, OverlayWordNodes>) => {
    overlayNodes.forEach(nodes => {
        removeOverlayWordNodes(nodes);
    });
    overlayNodes.clear();
};
