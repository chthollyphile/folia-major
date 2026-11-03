import { useEffect } from 'react';
import type { FoliumPlayerLayout } from '../mods/folium/contract';
import { playerOverlayLayout } from '../services/playerOverlayLayout';

// src/hooks/useMacWallpaperHitRegions.ts
// macOS wallpaper mode: tells the main process where the player's controls are on screen (the
// bottom capsule, the panel toggle and panel, the toasts), so it can put click catchers over them
// that keep those clicks away from Finder's desktop and so from Stage Manager (issue #698;
// electron/wallpaper/macWallpaperHitPanels.cjs). The rects come from the overlay layout the
// controls already register (services/playerOverlayLayout.ts): measured on its own debounce, never
// per frame, and only sent when they change. Hidden controls are not in it, so desktop icons under
// them stay clickable.

export interface WallpaperHitRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** The controls' rects in a player layout; none outside the player view. */
export const wallpaperHitRects = (layout: FoliumPlayerLayout | null): WallpaperHitRect[] => (
    layout
        ? layout.obstacles
            .filter(obstacle => obstacle.kind === 'control')
            .map(({ rect }) => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }))
        : []
);

export const useMacWallpaperHitRegions = (wallpaperMode: boolean) => {
    useEffect(() => {
        const electron = window.electron;
        const send = electron?.setWallpaperHitRegions;
        if (!wallpaperMode || !send || electron?.platform !== 'darwin') return undefined;
        let last = '';
        const report = () => {
            const rects = wallpaperHitRects(playerOverlayLayout.source.get());
            const key = JSON.stringify(rects);
            if (key === last) return;
            last = key;
            send(rects);
        };
        const unsubscribe = playerOverlayLayout.source.subscribe(report);
        report();
        return () => {
            unsubscribe();
            send([]);
        };
    }, [wallpaperMode]);
};
