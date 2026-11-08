// Geometry shared by the card settings store and its drag controller; no UI dependencies.
export type NowPlayingCardPosition = { x: number; y: number };
export type CardViewport = { width: number; height: number; cardWidth: number; cardHeight: number };
const MARGIN = 24;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const normalizeNowPlayingCardPosition = (value: unknown): NowPlayingCardPosition | null => {
    if (!value || typeof value !== 'object') return null;
    const point = value as Record<string, unknown>;
    if (typeof point.x !== 'number' || typeof point.y !== 'number' || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    return { x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) };
};

export const cardPositionBounds = ({ width, height, cardWidth, cardHeight }: CardViewport) => ({
    left: Math.min(MARGIN, Math.max(0, (width - cardWidth) / 2)),
    top: Math.min(MARGIN, Math.max(0, (height - cardHeight) / 2)),
    right: Math.max(Math.min(MARGIN, Math.max(0, (width - cardWidth) / 2)), width - cardWidth - MARGIN),
    bottom: Math.max(Math.min(MARGIN, Math.max(0, (height - cardHeight) / 2)), height - cardHeight - MARGIN),
});

export const clampCardPoint = (point: NowPlayingCardPosition, viewport: CardViewport) => {
    const bounds = cardPositionBounds(viewport);
    return { x: clamp(point.x, bounds.left, bounds.right), y: clamp(point.y, bounds.top, bounds.bottom) };
};

export const resolveCardPoint = (position: NowPlayingCardPosition | null, viewport: CardViewport, bottom: number) => {
    const bounds = cardPositionBounds(viewport);
    return position ? {
        x: bounds.left + position.x * (bounds.right - bounds.left),
        y: bounds.top + position.y * (bounds.bottom - bounds.top),
    } : clampCardPoint({ x: MARGIN, y: viewport.height - viewport.cardHeight - bottom }, viewport);
};

export const relativeCardPosition = (point: NowPlayingCardPosition, viewport: CardViewport): NowPlayingCardPosition => {
    const bounds = cardPositionBounds(viewport);
    const clamped = clampCardPoint(point, viewport);
    return {
        x: bounds.right > bounds.left ? (clamped.x - bounds.left) / (bounds.right - bounds.left) : 0,
        y: bounds.bottom > bounds.top ? (clamped.y - bounds.top) / (bounds.bottom - bounds.top) : 0,
    };
};
