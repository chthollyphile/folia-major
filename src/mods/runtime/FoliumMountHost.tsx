import React, { useEffect, useRef } from 'react';
import type { FoliumMount, FoliumTheme } from '../folium/contract';
import { resolveThemeFontStack } from '@/utils/fontStacks';
import { callFoliumMod } from './guard';
import { createFoliumMountScope, type FoliumHostContext } from '../folium/helpers';
import type { FoliumEntryKind } from '../folium/kinds';

// src/mods/runtime/FoliumMountHost.tsx
// The host-owned container every UI-shaped Folium entry mounts into. The host
// creates the element, optionally isolates it in a ShadowRoot, passes theme
// colors as inherited `--folium-*` custom properties, and runs the mod's
// disposer when React removes it. A mount that throws only leaves its own
// container empty and is reported against its mod: the host's own layers
// around it (background, subtitles, the rest of the bar or panel) stay, and
// the user's saved choice of that entry is not touched. The context the mod receives is
// the host's plus the mount helpers (helpers.ts), all of it owned by this mount.

export const foliumThemeVars = (theme: FoliumTheme | null | undefined): React.CSSProperties => (
    theme
        ? {
            '--folium-bg': theme.backgroundColor,
            '--folium-primary': theme.primaryColor,
            '--folium-secondary': theme.secondaryColor,
            '--folium-accent': theme.accentColor,
            '--folium-font': resolveThemeFontStack(theme),
        } as React.CSSProperties
        : {}
);

// What a host container can hold, for `data-folium-kind`: the names come from the kinds table (kinds.ts).
export type { FoliumEntryKind };

/** The attributes that name an entry's container (see FoliumEntryKind). */
export const foliumEntryAttributes = (modId: string, kind: FoliumEntryKind, entryId: string) => ({
    'data-folium-owner': modId,
    'data-folium-kind': kind,
    'data-folium-entry': entryId,
});

interface FoliumMountHostProps<Ctx> {
    modId: string;
    /** Label for error reports, e.g. "visualizer aurora:aurora-text". */
    where: string;
    entryKind: FoliumEntryKind;
    /** The namespaced registry id, `<modid>:<name>`. */
    entryId: string;
    mount: FoliumMount<Ctx>;
    /** The host's context, without the helpers. Memoize it: a new context identity remounts the entry. */
    ctx: FoliumHostContext<Ctx>;
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
    entryKind,
    entryId,
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

        // The mod gets a context that belongs to this mount: its listeners run through the
        // gate, and what it leaves subscribed or running ends with the mount.
        const scope = createFoliumMountScope<Ctx>(ctx, modId, where, container, entryKind);
        let returned = false;
        scope.adopt(callFoliumMod(modId, `${where} mount`, () => {
            const result = mount(container, scope.ctx);
            returned = true;
            return result;
        }, undefined, entryKind));
        // A mount that threw is over: the timers and listeners it had already started through the
        // context stop now, not when the entry is removed. Its container stays as the mount left it.
        if (!returned) scope.end();

        return () => {
            // The mod's own disposers first, then what it left behind.
            scope.end();
            container.remove();
        };
    }, [modId, where, entryKind, mount, ctx, shadow, fill, pointerEvents]);

    return (
        <div
            ref={hostRef}
            className={className}
            style={{ ...foliumThemeVars(theme), pointerEvents, ...style }}
            {...foliumEntryAttributes(modId, entryKind, entryId)}
        />
    );
}
