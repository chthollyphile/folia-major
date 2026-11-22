import React, { useEffect, useRef } from 'react';
import { isMainAppSurface } from '../../../../utils/appSurface';
import { attachSurfaceBox } from './surfaceMount';
import { setSurfaceBoxShown } from './surfaceShowing';

// src/components/app/playback/surface/SurfacePlaybackHost.tsx
// The box a `playback.surface` source shows its picture in (Folium 2 plan §4.2): mounted once at the app's root
// and kept for as long as the window lives, under the player page's layer (which leaves its own background out
// while a picture shows, VisualizerBackdrop.tsx), so a picture is never moved or reloaded as the views change.
// Off the player page (home, a library page) it is hidden, not removed: the sound goes on, and the stage keeps
// its own background there (what the home wall's windows and seams show). The source's DOM sits in a
// ShadowRoot, apart from the host's styles, and never takes the pointer (the player page above it does). Only the
// main window has one: OBS sources, the remote and the export window show no picture.

interface SurfacePlaybackHostProps {
    /** The player page is the view now. */
    visible: boolean;
}

const SurfacePlaybackHost: React.FC<SurfacePlaybackHostProps> = ({ visible }) => {
    const hostRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const host = hostRef.current;
        if (!host || !isMainAppSurface) return undefined;
        // attachShadow runs once per element; a remount in development reuses it.
        const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
        const box = document.createElement('div');
        // `all: initial` would set visibility back to visible: the host's hidden is inherited again.
        box.style.cssText = 'all: initial; visibility: inherit; position: absolute; inset: 0; display: block; overflow: hidden; pointer-events: none;';
        root.replaceChildren(box);
        const detach = attachSurfaceBox(box);
        return () => {
            detach();
            box.remove();
        };
    }, []);

    useEffect(() => {
        if (!isMainAppSurface) return undefined;
        setSurfaceBoxShown(visible);
        return () => setSurfaceBoxShown(false);
    }, [visible]);

    if (!isMainAppSurface) return null;
    return (
        <div
            ref={hostRef}
            className="absolute inset-0 z-0 pointer-events-none"
            data-testid="surface-playback-host"
            style={{ visibility: visible ? 'visible' : 'hidden' }}
            aria-hidden
        />
    );
};

export default SurfacePlaybackHost;
