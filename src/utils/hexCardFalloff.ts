// src/utils/hexCardFalloff.ts
// 六边形卡片距离衰减的两个下限（缩放、不透明度）的出厂值与可调范围。网格的 hexCardTransform 拿它们
// 当默认值，网格外观设置的 store 与设置页拿它们做夹取和「恢复默认」——后两者不能 import 网格 suite，
// 所以这几个常量单独放在这里。

export const HEX_CARD_MIN_SCALE_DEFAULT = 0.45;
export const HEX_CARD_MIN_OPACITY_DEFAULT = 0.4;
export const HEX_CARD_MIN_SCALE_BOUNDS = { min: 0.2, max: 1.1 } as const;
export const HEX_CARD_MIN_OPACITY_BOUNDS = { min: 0, max: 1 } as const;

/** Where a card sits on the grid; the frame math reads only its base position. */
export interface HexCardCoord {
    baseX: number;
    baseY: number;
}

export type HexCardPointerEvents = 'auto' | 'none';

export interface HexCardFrameOptions {
    clipRadius: number;
    maxDistance: number;
    lodStart: number;
    lodEnd: number;
    viewportWidth?: number;
    viewportHeight?: number;
    cardWidth?: number;
    cardHeight?: number;
    visibilityBuffer?: number;
    /** Scale the furthest still-visible card shrinks to. Defaults to the historical falloff. */
    minScale?: number;
    /** Opacity the furthest still-visible card fades to. Defaults to the historical falloff. */
    minOpacity?: number;
}

export interface HexCardFrame {
    visible: boolean;
    display: '' | 'none';
    distance: number;
    distanceSq: number;
    transform: string;
    opacity: string;
    zIndex: string;
    queueOpacity: string;
    queuePointerEvents: HexCardPointerEvents;
    playOpacity: string;
    playScale: string;
    playPointerEvents: HexCardPointerEvents;
}

export interface HexCardFrameStyleCache {
    display?: string;
    transform?: string;
    opacity?: string;
    zIndex?: string;
    queueOpacity?: string;
    queuePointerEvents?: string;
    playOpacity?: string;
    playScale?: string;
    playPointerEvents?: string;
}

export interface HexCardStyleTarget {
    style: Pick<CSSStyleDeclaration, 'display' | 'transform' | 'opacity' | 'zIndex' | 'setProperty'>;
}

const formatNumber = (value: number, precision = 4): string => {
    if (Object.is(value, -0) || Math.abs(value) < 0.00001) return '0';
    const rounded = Number(value.toFixed(precision));
    return String(rounded);
};

const formatOpacity = (value: number): string => formatNumber(Math.max(0, Math.min(1, value)), 3);

// Scale of the card sitting under the viewport centre; the falloff interpolates from here down to
// `minScale`. Both thresholds are user-tunable, so the defaults (in `utils/hexCardFalloff`) are the shipped falloff and
// `useGridViewSettingsStore` clamps whatever the user picks back into a sane band.
export const HEX_CARD_CENTER_SCALE = 1.1;

const buildTransform = (coord: HexCardCoord, scale: number): string => (
    `translate3d(${formatNumber(coord.baseX, 3)}px, ${formatNumber(coord.baseY, 3)}px, 0) scale(${formatNumber(scale)})`
);

// Resolves visual state for one card without touching React or the DOM.
export const computeHexCardFrame = (
    coord: HexCardCoord,
    dx: number,
    dy: number,
    {
        clipRadius,
        maxDistance,
        lodStart,
        lodEnd,
        viewportWidth,
        viewportHeight,
        cardWidth = 0,
        cardHeight = 0,
        visibilityBuffer = 0,
        minScale = HEX_CARD_MIN_SCALE_DEFAULT,
        minOpacity = HEX_CARD_MIN_OPACITY_DEFAULT,
    }: HexCardFrameOptions
): HexCardFrame => {
    const centerX = coord.baseX + dx;
    const centerY = coord.baseY + dy;
    const distanceSq = centerX * centerX + centerY * centerY;
    const distance = Math.sqrt(distanceSq);
    const visibleInRadius = distance <= clipRadius;
    const visibleInViewport = viewportWidth === undefined || viewportHeight === undefined
        ? true
        : Math.abs(centerX) <= viewportWidth / 2 + cardWidth / 2 + visibilityBuffer
            && Math.abs(centerY) <= viewportHeight / 2 + cardHeight / 2 + visibilityBuffer;
    const visible = visibleInRadius && visibleInViewport;
    const progress = Math.min(distance / Math.max(maxDistance, 1), 1);
    const scale = HEX_CARD_CENTER_SCALE - (HEX_CARD_CENTER_SCALE - minScale) * progress;
    const opacity = visible ? 1.0 - (1.0 - minOpacity) * progress : 0;
    const zIndex = Math.round(50 - 49 * progress);

    let queueOpacity = '0';
    let queuePointerEvents: HexCardPointerEvents = 'none';
    if (distance < lodStart || lodEnd <= lodStart) {
        queueOpacity = '1';
        queuePointerEvents = 'auto';
    } else if (distance <= lodEnd) {
        const queueProgress = (distance - lodStart) / (lodEnd - lodStart);
        queueOpacity = formatOpacity(1 - queueProgress);
        queuePointerEvents = 'auto';
    }

    let playOpacity = '0';
    let playScale = '0.8';
    let playPointerEvents: HexCardPointerEvents = 'none';
    if (distance < 40) {
        const playProgress = distance / 40;
        playOpacity = formatOpacity(1 - playProgress);
        playScale = formatNumber(1 - 0.2 * playProgress);
        playPointerEvents = 'auto';
    }

    return {
        visible,
        display: visible ? '' : 'none',
        distance,
        distanceSq,
        transform: buildTransform(coord, scale),
        opacity: formatOpacity(opacity),
        zIndex: String(zIndex),
        queueOpacity,
        queuePointerEvents,
        playOpacity,
        playScale,
        playPointerEvents,
    };
};
