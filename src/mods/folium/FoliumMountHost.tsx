import React, { useEffect, useRef } from 'react';
import type { FoliumDisposer, FoliumMount, FoliumTheme } from './contract';
import { reportFoliumIssue } from './status';

// src/mods/folium/FoliumMountHost.tsx
// The host-owned container every UI-shaped Folium entry mounts into. The host
// creates the element, optionally isolates it in a ShadowRoot, passes theme
// colors as inherited `--folium-*` custom properties, and runs the mod's
// disposer when React removes it. A mount that throws only blanks its own
// container and is reported against its mod.

export const foliumThemeVars = (theme: FoliumTheme | null | undefined): React.CSSProperties => (
    theme
        ? {
            '--folium-bg': theme.backgroundColor,
            '--folium-primary': theme.primaryColor,
            '--folium-secondary': theme.secondaryColor,
            '--folium-accent': theme.accentColor,
            '--folium-font': theme.fontFamily,
        } as React.CSSProperties
        : {}
);

interface FoliumMountHostProps<Ctx> {
    modId: string;
    /** Label for error reports, e.g. "visualizer aurora:aurora-text". */
    where: string;
    mount: FoliumMount<Ctx>;
    /** Memoize it: a new context identity remounts the entry. */
    ctx: Ctx;
    /** Isolate the mod's DOM and styles from the host (panels, overlays). */
    shadow?: boolean;
    /** Container fills the host box (layers) instead of sizing to content (panels). */
    fill?: boolean;
    /*
     * 'none' makes the container click-through: pointer-events inherit, so mod
     * content ignores the pointer unless an element sets `pointer-events: auto`.
     * Needed inside a ShadowRoot too, where `all: initial` would reset it.
     */
    pointerEvents?: 'auto' | 'none';
    theme?: FoliumTheme | null;
    className?: string;
    style?: React.CSSProperties;
}

export function FoliumMountHost<Ctx>({
    modId,
    where,
    mount,
    ctx,
    shadow = false,
    fill = true,
    pointerEvents = 'auto',
    theme,
    className,
    style,
}: FoliumMountHostProps<Ctx>) {
    const hostRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return undefined;
        let container: HTMLElement = host;
        let shadowRoot: ShadowRoot | null = null;
        if (shadow) {
            // attachShadow can only run once per element; reuse it across remounts.
            shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
            container = document.createElement('div');
            container.style.cssText = `all: initial; display: block; width: 100%;${fill ? ' height: 100%;' : ''} pointer-events: ${pointerEvents}; font-family: var(--folium-font, inherit); color: var(--folium-primary, inherit);`;
            shadowRoot.replaceChildren(container);
        } else {
            container = document.createElement('div');
            container.style.cssText = `position: relative; width: 100%;${fill ? ' height: 100%;' : ''} pointer-events: ${pointerEvents};`;
            host.replaceChildren(container);
        }

        let dispose: FoliumDisposer | void = undefined;
        try {
            dispose = mount(container, ctx);
        } catch (error) {
            reportFoliumIssue(modId, `${where} mount`, error);
        }

        return () => {
            if (typeof dispose === 'function') {
                try {
                    dispose();
                } catch (error) {
                    reportFoliumIssue(modId, `${where} dispose`, error);
                }
            }
            container.remove();
        };
    }, [modId, where, mount, ctx, shadow, fill, pointerEvents]);

    return (
        <div
            ref={hostRef}
            className={className}
            style={{ ...foliumThemeVars(theme), pointerEvents, ...style }}
            data-folium-owner={modId}
        />
    );
}
