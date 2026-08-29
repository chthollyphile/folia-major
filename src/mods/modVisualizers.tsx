import React, { useEffect, useRef } from 'react';
import { appendVisualizerEntry, removeVisualizerEntry } from '@/components/visualizer/registry';
import type { VisualizerRegistryEntry, VisualizerSharedProps } from '@/components/visualizer/definition';
import type { VisualizerMode } from '@/types';
import type { Line, Theme } from '@/types';
import type { ModRuntimeInfo, ModVisualizerContribution } from './types';
import { listMods } from './ipc';
import { isModsBridgeAvailable } from './ipc';

// src/mods/modVisualizers.tsx
// Bridges mod-declared visualizer contributions into the live visualizer
// registry. A contribution is a browser ESM module served over the
// whitelisted folia-mod:// protocol with an imperative `mount(el, props)`
// contract; this module adapts it into the React VisualizerRegistryEntry
// shape so mod modes work everywhere a builtin mode works: player, preview,
// ThemePark, and the transparent video export page.

export interface ModVisualizerMountProps {
    lines: Line[];
    currentLineIndex: number;
    currentTime: { get(): number; on(event: 'change', cb: (v: number) => void): () => void };
    theme: Theme | null;
    songTitle: string | null;
    songArtist: string | null;
    staticMode: boolean;
    paused: boolean;
}

export interface ModVisualizerModule {
    default: {
        mount: (element: HTMLElement, props: ModVisualizerMountProps) => void | (() => void);
    };
}

export interface ModVisualizerDescriptor {
    mode: string;
    /**
     * folia-mod:// URL of the contribution's ESM entry, versioned by the mod's
     * content digest. The version matters: a bare URL would be served from the
     * browser's ES module map on every re-import, so an updated mod would keep
     * running the code imported the first time (Cache-Control cannot reach the
     * module map). A changed digest is a different specifier, so it re-imports.
     */
    url: string;
    label: Record<string, string | undefined>;
    order: number;
    modName: string;
}

const resolveModVisualizerLabel = (label: Record<string, string | undefined>, modName: string): string =>
    label['zh-CN'] ?? label.en ?? label[document?.documentElement?.lang] ?? modName;

/*
 * React host for one mod visualizer. mount() owns the DOM inside the host div;
 * the returned disposer (if any) runs on unmount or song change. Continuous
 * time flows through the MotionValue subscription, never React state.
 */
const ModVisualizerHost: React.FC<{
    mount: ModVisualizerModule['default']['mount'];
    sharedProps: VisualizerSharedProps;
}> = ({ mount, sharedProps }) => {
    const hostRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const element = hostRef.current;
        if (!element) {
            return;
        }
        const dispose = mount(element, {
            lines: sharedProps.lines,
            currentLineIndex: sharedProps.currentLineIndex,
            currentTime: sharedProps.currentTime,
            theme: sharedProps.theme,
            songTitle: sharedProps.songTitle ?? null,
            songArtist: sharedProps.songArtist ?? null,
            staticMode: Boolean(sharedProps.staticMode),
            paused: Boolean(sharedProps.paused),
        });
        return () => {
            if (typeof dispose === 'function') {
                dispose();
            }
        };
        // Re-mount when the song's lyric data changes; MotionValue identity is
        // stable across renders, so it is intentionally not a dependency.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mount, sharedProps.lines, sharedProps.currentLineIndex]);

    return <div ref={hostRef} className="w-full h-full" />;
};

const buildRegistryEntry = (descriptor: ModVisualizerDescriptor, mount: ModVisualizerModule['default']['mount']): VisualizerRegistryEntry => ({
    mode: descriptor.mode as VisualizerRegistryEntry['mode'],
    order: descriptor.order,
    // Intentionally-unmapped key: getVisualizerModeLabel falls back to
    // labelFallback when the i18n dictionary has no entry, so mod labels work
    // in every locale without touching the locale files.
    labelKey: `ui.modVisualizer.${descriptor.mode}`,
    labelFallback: resolveModVisualizerLabel(descriptor.label, descriptor.modName),
    previewSeed: descriptor.mode,
    previewStartOffset: 0,
    tuningKind: 'none',
    render: (props) => <ModVisualizerHost mount={mount} sharedProps={props} />,
});

const collectDescriptors = (mods: ModRuntimeInfo[]): ModVisualizerDescriptor[] =>
    mods.flatMap((mod) =>
        (mod.visualizers ?? []).map((visualizer: ModVisualizerContribution) => ({
            mode: visualizer.mode,
            url: visualizer.url,
            label: visualizer.label ?? {},
            order: visualizer.order ?? 500,
            modName: mod.name,
        }))
    );

let initPromise: Promise<void> | null = null;

// Modes currently registered from mod contributions, mapped to the exact URL
// each one was imported from. Kept in sync with the live registry so a reload
// can add newly-declared modes, drop modes whose mod was disabled or
// uninstalled, and re-import a mode whose code changed under it.
const registeredModModes = new Map<string, string>();

/*
 * Reconciles a descriptor list against the live visualizer registry. A mode
 * whose URL is unchanged keeps its existing registration; a mode that vanished
 * or whose URL moved is removed first and re-imported, so "reload" genuinely
 * picks up edited mod code instead of replaying the module already in memory.
 * Idempotent, and a per-mod import failure only skips that mod.
 */
export const registerModVisualizers = async (descriptors: ModVisualizerDescriptor[]): Promise<void> => {
    const desired = new Map(descriptors.map((descriptor) => [descriptor.mode, descriptor.url]));

    for (const [mode, url] of Array.from(registeredModModes)) {
        if (desired.get(mode) !== url) {
            removeVisualizerEntry(mode as VisualizerMode);
            registeredModModes.delete(mode);
        }
    }

    await Promise.all(descriptors.map(async (descriptor) => {
        if (registeredModModes.has(descriptor.mode)) {
            return;
        }
        try {
            const module = await import(/* @vite-ignore */ descriptor.url) as ModVisualizerModule;
            if (typeof module?.default?.mount !== 'function') {
                throw new Error('missing default.mount');
            }
            if (appendVisualizerEntry(buildRegistryEntry(descriptor, module.default.mount))) {
                registeredModModes.set(descriptor.mode, descriptor.url);
            }
        } catch (error) {
            console.warn(`[Mods] Failed to load visualizer "${descriptor.mode}":`, error);
        }
    }));
};

/*
 * Reconciles mod visualizer contributions against the latest mod state, read
 * over the IPC bridge. Only usable where that bridge exists (the main window);
 * the export window has no preload and registers from injected descriptors via
 * registerModVisualizers instead.
 */
export const initModVisualizers = async (): Promise<void> => {
    if (initPromise) {
        return initPromise;
    }
    initPromise = (async () => {
        if (!isModsBridgeAvailable()) {
            return;
        }
        const { mods } = await listMods();
        await registerModVisualizers(collectDescriptors(mods));
    })();
    return initPromise;
};

/*
 * Clears the cached init promise so the next call re-runs the reconciliation.
 * Called after the main-process mod state changes (install/enable/disable/
 * reload) so contributed visualizer modes track the current mod set.
 */
export const reloadModVisualizers = (): void => {
    initPromise = null;
};
