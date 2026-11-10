// src/components/wall/wallView.ts

import type { Bounds } from './layout';

// Viewport <-> world conversions for the fixed-world wall. The pure geometry here talks about the
// world point under the seam line (the "view centre"); the DOM camera is a translation plus scale.

export type WallView = {
    /** Viewport size in screen px. */
    width: number;
    height: number;
    scale: number;
    /** Screen x of the seam's base line; the viewport's horizontal middle when omitted. */
    lineX?: number;
};

export type WallViewCenter = { x: number; y: number };

/** Same shape as the wall's DOM camera: `screen = camera + world * scale`. */
export type WallViewCamera = { x: number; y: number; scale: number };

export const getViewLineX = (view: WallView) => view.lineX ?? view.width / 2;

/**
 * The world layer's CSS transform for a camera, with the translation snapped to whole device pixels.
 * The world is deliberately not `will-change: transform` (see wall.css), and without that hint Chromium
 * aligns the layer's raster to the pixel grid: every change in the fractional part of the translation
 * throws the tiles away and rasterizes the whole visible wall again, i.e. on every frame of a wheel glide,
 * a drag or a camera tween. Moving in whole device pixels keeps that fraction fixed, so panning only moves
 * tiles, the same way the browser snaps its own scroll offsets.
 */
export const formatWorldTransform = (x: number, y: number, scale: number, devicePixelRatio = window.devicePixelRatio || 1) => {
    const snap = (value: number) => Math.round(value * devicePixelRatio) / devicePixelRatio;
    return `translate3d(${snap(x)}px, ${snap(y)}px, 0) scale(${scale})`;
};

export const viewCenterFromCamera = (camera: WallViewCamera, view: WallView): WallViewCenter => ({
    x: (getViewLineX(view) - camera.x) / camera.scale,
    y: (view.height / 2 - camera.y) / camera.scale,
});

export const cameraFromViewCenter = (center: WallViewCenter, view: WallView): WallViewCamera => ({
    x: getViewLineX(view) - center.x * view.scale,
    y: view.height / 2 - center.y * view.scale,
    scale: view.scale,
});

/**
 * World rect on screen around a view centre. An open seam pushes the two halves apart, so the
 * horizontal span is widened by the seam width on both sides (as the prototype's culling does);
 * a seam between two block rows (`seamHeight`) widens the vertical span the same way.
 */
export const getViewWorldBounds = (
    center: WallViewCenter,
    view: WallView,
    { seamWidth = 0, seamHeight = 0, overscan = 0 }: { seamWidth?: number; seamHeight?: number; overscan?: number } = {},
): Bounds => {
    const lineX = getViewLineX(view);
    return {
        left: center.x - (lineX + seamWidth) / view.scale - overscan,
        right: center.x + (view.width - lineX + seamWidth) / view.scale + overscan,
        top: center.y - (view.height / 2 + seamHeight) / view.scale - overscan,
        bottom: center.y + (view.height / 2 + seamHeight) / view.scale + overscan,
    };
};
