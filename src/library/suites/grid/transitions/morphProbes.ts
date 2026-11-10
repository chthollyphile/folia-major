import {
    COLLECTION_MORPH_MIN_RECT_WIDTH,
    type CollectionMorphCard,
    type CollectionMorphFrame,
    type CollectionMorphRect,
    type CollectionMorphTitle,
} from './morphGeometry';
import {
    ACTIVE_GRID_ATTR,
    ARTIST_INTRO_ATTR,
    CARD_TITLE_ATTR,
    GRID3D_CARD_INDEX_ATTR,
    GRID_CARD_ITEM_ID_ATTR,
    LATTICE_TILE_ATTR,
    LATTICE_WALL_ATTR,
    LEAVING_GRID_ATTR,
    MORPH_FRAME_ATTR,
    MORPH_SHADE_ATTR,
    MORPH_SOURCE_ATTR,
    MORPH_TARGET_ATTR,
} from './gridMorphContract';
import { settleStandInHandover } from './standInHandover';

// src/library/suites/grid/transitions/morphProbes.ts
// The morph's measuring tape: every rectangle the transition flies is read here,
// straight off the real DOM, and every attribute name it reads comes from
// gridMorphContract.ts (the single handshake shared with the grid components).
//
// Deliberately store-free. This module only measures and (optionally) reports
// clicks, with one exception: before the centred card is measured, a stand-in that is
// handing over to it is brought to the end of that (probeCentredCard). The store owns
// state and the overlay owns lifecycle, so there is no
// import cycle and the probes stay testable in isolation. The capture-phase
// click listener lives behind attachMorphCapture so it is attached by a React
// effect and disposed with it, instead of running as a module side effect on
// every HMR reload.

/** 采集结果：卡片量好了，但还不属于任何一次导航（导航快照由调用方在任何 React
 * onClick 生效之前补上，见 attachMorphCapture 的 capture 阶段语义）。 */
export interface CollectionMorphCapture extends CollectionMorphCard {
    sourceKey: string | null;
}

export type MorphCaptureHandler = (capture: CollectionMorphCapture) => void;

/** A card on the page: what a flight needs of it, and the elements that draw it. */
export interface MeasuredCard extends CollectionMorphCard {
    /** The element that draws the picture; null for a box that holds none yet. */
    picture: HTMLElement | null;
    /** The whole card: what is hidden while a carrier stands for it. */
    card: HTMLElement;
}

/** The card alone, without the elements it was read off. */
export const cardOf = ({ picture: _picture, card: _card, ...measured }: MeasuredCard): CollectionMorphCard => measured;

export const rectOfElement = (el: Element | null): CollectionMorphRect | null => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    return { x: r.left, y: r.top, width: r.width, height: r.height };
};

// How many elements above a picture are asked for the corners it is cut to.
const CLIP_SEARCH_DEPTH = 4;

/**
 * The corner radius a picture is drawn with, in screen pixels. The corners are seldom the
 * picture's own: a box around it has the radius and cuts it (`overflow: hidden`), sometimes
 * with a border between, which takes its width off the radius the picture is left with. A
 * card drawn scaled (the centred card of a grid) has its radius scaled with it.
 */
const drawnRadiusOf = (picture: HTMLElement, root: Element, rect: CollectionMorphRect): number => {
    let element: HTMLElement | null = picture;
    for (let depth = 0; element && depth <= CLIP_SEARCH_DEPTH; depth += 1) {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        const scale = element.offsetWidth > 0 ? box.width / element.offsetWidth : 1;
        const stated = style.borderTopLeftRadius;
        const radius = (stated.endsWith('%') ? (Number.parseFloat(stated) / 100) * element.offsetWidth : Number.parseFloat(stated)) * scale;
        if (radius > 0 && (element === picture || style.overflowX !== 'visible')) {
            const inset = Math.max(0, rect.x - box.left);
            return Math.max(0, Math.min(radius - inset, rect.width / 2, rect.height / 2));
        }
        if (element === root) break;
        element = element.parentElement;
    }
    return 0;
};

const frameOf = (element: HTMLElement | null): CollectionMorphFrame | null => {
    const rect = rectOfElement(element);
    if (!element || !rect) {
        return null;
    }
    const style = getComputedStyle(element);
    return {
        rect,
        radius: drawnRadiusOf(element, element, rect),
        background: style.backgroundColor,
        border: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
        shadow: style.boxShadow,
        // The theme's text colour is a variable on the app's root element, which the carrier
        // (under <body>) is not inside: it is read here, off the card, as a value.
        edge: style.getPropertyValue('--text-primary').trim() || style.color,
    };
};

// What makes a line of text look as it does, by React's style name and by CSS's.
const TITLE_STYLES: Array<[string, string]> = [
    ['fontFamily', 'font-family'], ['fontSize', 'font-size'], ['fontWeight', 'font-weight'], ['fontStyle', 'font-style'],
    ['letterSpacing', 'letter-spacing'], ['lineHeight', 'line-height'], ['color', 'color'], ['textAlign', 'text-align'],
    ['textShadow', 'text-shadow'], ['textTransform', 'text-transform'], ['whiteSpace', 'white-space'],
    ['wordBreak', 'word-break'], ['overflowWrap', 'overflow-wrap'], ['textOverflow', 'text-overflow'],
    ['WebkitLineClamp', '-webkit-line-clamp'], ['opacity', 'opacity'],
];

const titleOf = (element: HTMLElement | null): CollectionMorphTitle | null => {
    const rect = rectOfElement(element);
    const text = element?.textContent?.trim() ?? '';
    if (!element || !rect || !text) {
        return null;
    }
    const computed = getComputedStyle(element);
    return {
        rect,
        text,
        width: element.offsetWidth,
        height: element.offsetHeight,
        fontSize: Number.parseFloat(computed.fontSize) || 14,
        style: Object.fromEntries(TITLE_STYLES.map(([name, property]) => [name, computed.getPropertyValue(property)])),
    };
};

/**
 * The layer a card draws over its picture, where it marks one (MORPH_SHADE_ATTR): the background
 * that element is drawn with, with the card's own colours in it as values. The carrier, which is
 * outside the card, draws the same layer from it.
 */
const shadeOf = (card: HTMLElement): string | null => {
    const layer = card.querySelector<HTMLElement>(`[${MORPH_SHADE_ATTR}]`);
    return layer ? getComputedStyle(layer).background || null : null;
};

/**
 * The card at `root`: its picture, and its frame and title where it has them. `root` is the card
 * itself, or a box of it that holds the picture (a landing place); the frame is looked for around
 * it and inside it, the title inside whichever is the outer. Null where there is no picture,
 * unless `evenBare`: the box itself then stands for the picture (an artist that has none).
 */
export const measureCard = (root: Element | null, evenBare = false): MeasuredCard | null => {
    if (!(root instanceof HTMLElement)) {
        return null;
    }
    const picture = root instanceof HTMLImageElement ? root : root.querySelector<HTMLImageElement>('img');
    const rect = rectOfElement(picture) ?? (evenBare ? rectOfElement(root) : null);
    if (!rect) {
        return null;
    }
    const frame = root.closest<HTMLElement>(`[${MORPH_FRAME_ATTR}]`) ?? root.querySelector<HTMLElement>(`[${MORPH_FRAME_ATTR}]`);
    const card = frame?.contains(root) ? frame : root;
    return {
        rect,
        radius: drawnRadiusOf(picture ?? root, root, rect),
        url: picture ? picture.currentSrc || picture.getAttribute('src') || null : null,
        proportions: picture && picture.naturalWidth > 0 && picture.naturalHeight > 0 ? picture.naturalWidth / picture.naturalHeight : 0,
        frame: frameOf(frame),
        title: titleOf(card.querySelector<HTMLElement>(`[${CARD_TITLE_ATTR}]`)),
        shade: shadeOf(card),
        picture,
        card,
    };
};

const markedRoot = (attribute: string): HTMLElement | null => (
    typeof document === 'undefined' ? null : document.querySelector(`[${attribute}]`)?.parentElement ?? null
);

/**
 * 当前活动的详情网格根。出栈的旧网格在退出动画期间仍留在 DOM 里，并且带着同样的
 * 卡片属性；不限定范围就会量到旧网格的卡片。GridView / ArtistGridView 在自己的根节点里放了
 * 一个 ActiveGridMarker：它（按 framer 的 useIsPresent()）只在还没开始退出的那一层里带着
 * 这个属性，所以同一时刻只可能有一个，它的父元素就是当前那一层。标记缺失时
 * 退回整篇文档，保证转场不会因为标记丢失而整个失效。没有 document（单测、非浏览器上下文）时
 * 返回 null。
 */
export const activeGridRoot = (): ParentNode | null => {
    if (typeof document === 'undefined') {
        return null;
    }
    return markedRoot(ACTIVE_GRID_ATTR) ?? document;
};

/** The page that is leaving (its marker says so from the commit that takes it off the navigation); null where none is. */
export const leavingGridRoot = (): HTMLElement | null => markedRoot(LEAVING_GRID_ATTR);

// The source key of the poster wall's grown tile is this and the tile's id.
const LATTICE_KEY = 'lattice:';

/** The source key of the poster wall's tile with this id, grown. */
export const latticeSourceKey = (tileId: string): string => `${LATTICE_KEY}${tileId}`;

const cardSelectorForSourceKey = (sourceKey: string): string | null => {
    if (sourceKey.startsWith('grid3d:')) {
        return `[${GRID3D_CARD_INDEX_ATTR}="${CSS.escape(sourceKey.slice('grid3d:'.length))}"]`;
    }
    if (sourceKey.startsWith('item:')) {
        return `[${GRID_CARD_ITEM_ID_ATTR}="${CSS.escape(sourceKey.slice('item:'.length))}"]`;
    }
    if (sourceKey.startsWith('source:')) {
        return `[${MORPH_SOURCE_ATTR}="${CSS.escape(sourceKey.slice('source:'.length))}"]`;
    }
    if (sourceKey.startsWith(LATTICE_KEY)) {
        return `[${LATTICE_TILE_ATTR}="${CSS.escape(sourceKey.slice(LATTICE_KEY.length))}"]`;
    }
    return null;
};

/**
 * Whether the card a source key stands for, not on the page now, is still to come: the poster
 * wall's tile, while the wall is on the page. The navigation back to the wall puts it up anew,
 * and it measures itself before it draws a tile. A flight back to such a card waits for it.
 */
export const isCardToCome = (sourceKey: string | null): boolean => (
    Boolean(sourceKey?.startsWith(LATTICE_KEY))
    && typeof document !== 'undefined'
    && document.querySelector(`[${LATTICE_WALL_ATTR}]`) !== null
);

/** The card a source key stands for, where it is under `root` now (the whole page by default). */
export const findMorphCard = (sourceKey: string | null, root?: ParentNode | null): HTMLElement | null => {
    if (!sourceKey || typeof document === 'undefined') {
        return null;
    }
    const selector = cardSelectorForSourceKey(sourceKey);
    return selector ? (root ?? document).querySelector<HTMLElement>(selector) : null;
};

/**
 * Where a flight into the active page lands: the page's stand-in (GridView) or the artist's
 * picture (ArtistGridView). Both carry MORPH_TARGET_ATTR and have no entrance of their own: each
 * is at its place and size in the commit that mounts it, which is the commit that mounts its
 * page. The artist's picture is in a card that moves with the grid, and on a page that is come
 * back to it is a landing place only once the artist has been read.
 * Where the box holds no picture yet (an artist without one), the box itself is the landing.
 */
export const probeMorphTarget = (): MeasuredCard | null => (
    measureCard(activeGridRoot()?.querySelector(`[${MORPH_TARGET_ATTR}]`) ?? null, true)
);

/**
 * The card at the middle of the page under `root`: the page's landing place while it still shows
 * a picture (the stand-in of a page whose cards have not come; the artist's picture, where it is
 * marked as a landing place), else the card nearest the middle of the window, which is the one
 * the grid is centred on.
 */
export const centredCardOf = (root: ParentNode): MeasuredCard | null => {
    const landing = measureCard(root.querySelector(`[${MORPH_TARGET_ATTR}]`));
    if (landing) {
        return landing;
    }
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    let nearest: HTMLElement | null = null;
    let nearestDistSq = Infinity;
    for (const el of root.querySelectorAll<HTMLElement>(`[${GRID_CARD_ITEM_ID_ATTR}]`)) {
        const rect = rectOfElement(el);
        if (!rect) {
            continue;
        }
        const distSq = (rect.x + rect.width / 2 - cx) ** 2 + (rect.y + rect.height / 2 - cy) ** 2;
        if (distSq < nearestDistSq) {
            nearestDistSq = distSq;
            nearest = el;
        }
    }
    return measureCard(nearest);
};

/**
 * The card a flight back starts from: the one at the middle of the active page. A handover of
 * that page's stand-in that is under way is ended first, which changes the page.
 */
export const probeCentredCard = (): MeasuredCard | null => {
    // A stand-in that is turning over into the centred card: measured in mid-turn, either is a sliver.
    settleStandInHandover();
    const root = activeGridRoot();
    return root ? centredCardOf(root) : null;
};

/**
 * The card a source key stands for, as it is drawn now; null when the card is not on the page,
 * or is drawn too small to fly to (COLLECTION_MORPH_MIN_RECT_WIDTH).
 */
export const measureSourceCard = (sourceKey: string | null): MeasuredCard | null => {
    const card = findMorphCard(sourceKey);
    if (!card || card.getBoundingClientRect().width < COLLECTION_MORPH_MIN_RECT_WIDTH) {
        return null;
    }
    return measureCard(card);
};

// Resolves the clicked card straight off its DOM: the rectangles are exact and the
// picture is the same <img> the user was looking at — no second network fetch.
export const captureClickedCard = (card: HTMLElement): CollectionMorphCapture | null => {
    if (card.getBoundingClientRect().width < COLLECTION_MORPH_MIN_RECT_WIDTH) {
        return null;
    }
    const measured = measureCard(card);
    if (!measured) {
        return null;
    }
    const sourceKey = card.dataset.grid3dIndex !== undefined
        ? `grid3d:${card.dataset.grid3dIndex}`
        : card.dataset.foliaGridItemId !== undefined
            ? `item:${card.dataset.foliaGridItemId}`
            : card.dataset.foliaMorphSource !== undefined
                ? `source:${card.dataset.foliaMorphSource}`
                : card.dataset.foliaLatticeTile !== undefined
                    ? `${LATTICE_KEY}${card.dataset.foliaLatticeTile}`
                    : null;
    return { ...cardOf(measured), sourceKey };
};

/**
 * 记录「用户点了哪张卡片」。返回卸载函数，所以它挂在 React effect 里，而不是模块加载时
 * 就注册一个永远不撤销的 document 监听（那种写法在每次 HMR 都会多留一个）。
 *
 * 监听必须是 capture 阶段：payload 里的导航快照要反映**点击之前**的状态，而 React 的
 * onClick 会在这个监听之后才更新导航 store。卡片点击只是居中/播放时导航签名不变，overlay
 * 的观察窗口会把这份采集丢掉，所以这里不需要额外判断意图。
 */
export const attachMorphCapture = (handler: MorphCaptureHandler): (() => void) => {
    if (typeof document === 'undefined') {
        return () => {};
    }
    const onClick = (event: MouseEvent) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }
        const card = target.closest<HTMLElement>(`[${GRID3D_CARD_INDEX_ATTR}], [${GRID_CARD_ITEM_ID_ATTR}], [${MORPH_SOURCE_ATTR}]`);
        if (!card) {
            return;
        }
        // 歌手页的头像与简介卡不是可搬运的卡片：简介弹窗不改变导航，头像有自己的落点。
        if (card.closest(`[${ARTIST_INTRO_ATTR}]`)) {
            return;
        }
        const capture = captureClickedCard(card);
        if (!capture) {
            return;
        }
        handler(capture);
    };
    document.addEventListener('click', onClick, { capture: true });
    return () => document.removeEventListener('click', onClick, { capture: true });
};
