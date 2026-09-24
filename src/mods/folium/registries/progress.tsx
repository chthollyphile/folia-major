import React, { useEffect, useMemo, useRef } from 'react';
import type { MotionValue } from 'framer-motion';
import type {
    FoliumControlButtonDef,
    FoliumControlSlot,
    FoliumProgressContext,
    FoliumProgressLayerDef,
} from '../contract';
import { createFoliumRegistry, useFoliumRegistryEntries, type FoliumRegistryEntry } from '../registry';
import { FoliumMountHost } from '../FoliumMountHost';

// src/mods/folium/registries/progress.tsx
// `folium.registries.controlButtons` and `folium.registries.progressLayers`:
// extensions of the host progress bar (ProgressBar.tsx, used by the floating
// controls and Lattice). Buttons mount into the leading/trailing slots beside
// the time labels; layers mount over the track, above the fill. Both get the
// same FoliumProgressContext, so a layer can place markers with timeToRatio()
// and a button can seek.

const CONTROL_SLOTS: readonly FoliumControlSlot[] = ['progress.leading', 'progress.trailing'];

export const controlButtonsRegistry = createFoliumRegistry<FoliumControlButtonDef>('controlButtons', {
    validate: (def) => {
        if (!CONTROL_SLOTS.includes(def.slot)) {
            throw new Error(`controlButtons.register: slot must be one of ${CONTROL_SLOTS.join(', ')}`);
        }
        if (typeof def.mount !== 'function') {
            throw new Error('controlButtons.register: mount must be a function');
        }
        return def;
    },
});

export const progressLayersRegistry = createFoliumRegistry<FoliumProgressLayerDef>('progressLayers', {
    validate: (def) => {
        if (typeof def.mount !== 'function') {
            throw new Error('progressLayers.register: mount must be a function');
        }
        return def;
    },
});

const byOrder = <Def extends { order?: number }>(left: FoliumRegistryEntry<Def>, right: FoliumRegistryEntry<Def>) => (
    (left.def.order ?? 500) - (right.def.order ?? 500) || left.id.localeCompare(right.id)
);

export interface FoliumProgressInputs {
    currentTime: MotionValue<number>;
    duration: number;
    onSeek: (seconds: number) => void;
    /** Mirrors ProgressBar's `disabled`: while set, seek() is a no-op like the range input. */
    disabled?: boolean;
    colors: { fill: string; track: string; text: string };
}

/*
 * One context per progress bar. Fixed per currentTime source; duration, colors
 * and the seek callback are read through refs, and subscribe() fires when the
 * duration or the colors change (a new track, a theme switch).
 */
export const useFoliumProgressContext = (inputs: FoliumProgressInputs): FoliumProgressContext => {
    const inputsRef = useRef(inputs);
    inputsRef.current = inputs;
    const listenersRef = useRef(new Set<() => void>());
    const { currentTime } = inputs;
    const ctx = useMemo<FoliumProgressContext>(() => Object.freeze({
        currentTime: Object.freeze({
            get: () => currentTime.get(),
            on: (_event: 'change', listener: (seconds: number) => void) => currentTime.on('change', listener),
        }),
        getDuration: () => inputsRef.current.duration,
        timeToRatio: (seconds: number) => {
            const { duration } = inputsRef.current;
            if (!(duration > 0) || !Number.isFinite(seconds)) return 0;
            return Math.min(1, Math.max(0, seconds / duration));
        },
        seek: (seconds: number) => {
            if (!Number.isFinite(seconds)) return;
            const { duration, onSeek, disabled } = inputsRef.current;
            if (disabled) return;
            onSeek(duration > 0 ? Math.min(duration, Math.max(0, seconds)) : Math.max(0, seconds));
        },
        getColors: () => inputsRef.current.colors,
        subscribe: (listener: () => void) => {
            listenersRef.current.add(listener);
            return () => listenersRef.current.delete(listener);
        },
    }), [currentTime]);
    const { duration } = inputs;
    const { fill, track, text } = inputs.colors;
    const primedRef = useRef(false);
    useEffect(() => {
        if (!primedRef.current) {
            primedRef.current = true;
            return;
        }
        listenersRef.current.forEach((listener) => listener());
    }, [duration, fill, track, text]);
    return ctx;
};

/** A leading/trailing button slot. Renders nothing while no mod has a button there. */
export const FoliumControlButtonSlot: React.FC<{ slot: FoliumControlSlot; ctx: FoliumProgressContext }> = ({ slot, ctx }) => {
    const entries = useFoliumRegistryEntries(controlButtonsRegistry);
    const buttons = entries.filter((entry) => entry.def.slot === slot).sort(byOrder);
    if (buttons.length === 0) return null;
    return (
        <div className="flex items-center gap-1 shrink-0" data-folium-slot={slot}>
            {buttons.map((entry) => (
                <FoliumMountHost
                    key={entry.id}
                    modId={entry.modId}
                    where={`control button ${entry.id}`}
                    mount={entry.def.mount}
                    ctx={ctx}
                    shadow
                    fill={false}
                    className="flex items-center"
                />
            ))}
        </div>
    );
};

/*
 * Layers over the track. The containers are click-through, so seeking through
 * the range input underneath keeps working everywhere a layer draws nothing
 * clickable; a layer that wants clicks (markers that seek) sets
 * `pointer-events: auto` on exactly those elements.
 */
export const FoliumProgressLayers: React.FC<{ ctx: FoliumProgressContext }> = ({ ctx }) => {
    const entries = useFoliumRegistryEntries(progressLayersRegistry);
    if (entries.length === 0) return null;
    const layers = [...entries].sort(byOrder);
    return (
        <div className="absolute inset-0 pointer-events-none z-10" data-folium-slot="progress.track">
            {layers.map((entry) => (
                <FoliumMountHost
                    key={entry.id}
                    modId={entry.modId}
                    where={`progress layer ${entry.id}`}
                    mount={entry.def.mount}
                    ctx={ctx}
                    shadow
                    className="absolute inset-0"
                    pointerEvents="none"
                />
            ))}
        </div>
    );
};
