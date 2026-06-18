import type { HexGridCoord } from './hexViewport';

// Computes and applies frame-local styles for draggable folia hex card wrappers.
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

const buildTransform = (coord: HexGridCoord, scale: number): string => (
    `translate3d(${formatNumber(coord.baseX, 3)}px, ${formatNumber(coord.baseY, 3)}px, 0) scale(${formatNumber(scale)})`
);

// Resolves visual state for one card without touching React or the DOM.
export const computeHexCardFrame = (
    coord: HexGridCoord,
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
    const scale = 1.1 - 0.65 * progress;
    const opacity = visible ? 1.0 - 0.60 * progress : 0;
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

export const createHexCardFrameStyleCache = (frame: HexCardFrame): HexCardFrameStyleCache => ({
    display: frame.display,
    transform: frame.transform,
    opacity: frame.opacity,
    zIndex: frame.zIndex,
    queueOpacity: frame.queueOpacity,
    queuePointerEvents: frame.queuePointerEvents,
    playOpacity: frame.playOpacity,
    playScale: frame.playScale,
    playPointerEvents: frame.playPointerEvents,
});

// Applies only changed style values so the drag rAF loop avoids redundant DOM writes.
export const applyHexCardFrameStyles = (
    target: HexCardStyleTarget,
    frame: HexCardFrame,
    cache: HexCardFrameStyleCache
): boolean => {
    let didWrite = false;
    const { style } = target;

    if (cache.display !== frame.display) {
        style.display = frame.display;
        cache.display = frame.display;
        didWrite = true;
    }

    if (!frame.visible) {
        return didWrite;
    }

    if (cache.transform !== frame.transform) {
        style.transform = frame.transform;
        cache.transform = frame.transform;
        didWrite = true;
    }

    if (cache.opacity !== frame.opacity) {
        style.opacity = frame.opacity;
        cache.opacity = frame.opacity;
        didWrite = true;
    }

    if (cache.zIndex !== frame.zIndex) {
        style.zIndex = frame.zIndex;
        cache.zIndex = frame.zIndex;
        didWrite = true;
    }

    const setCustomProperty = (
        property: string,
        cacheKey: keyof HexCardFrameStyleCache,
        value: string
    ) => {
        if (cache[cacheKey] === value) return;
        style.setProperty(property, value);
        cache[cacheKey] = value;
        didWrite = true;
    };

    setCustomProperty('--queue-opacity', 'queueOpacity', frame.queueOpacity);
    setCustomProperty('--queue-pe', 'queuePointerEvents', frame.queuePointerEvents);
    setCustomProperty('--play-opacity', 'playOpacity', frame.playOpacity);
    setCustomProperty('--play-scale', 'playScale', frame.playScale);
    setCustomProperty('--play-pe', 'playPointerEvents', frame.playPointerEvents);

    return didWrite;
};
