import React, { Suspense } from 'react';
import type { Theme } from '@/types';
import type { FoliumStageLayerDef, FoliumStageSlot } from '../contract';
import { createFoliumRegistry, useFoliumRegistryEntries } from '../registry';

// src/mods/folium/registries/stageLayers.tsx
// `folium.registries.stageLayers`: mod layers on the player page. The host
// renders one slot per position (see FoliumStageSlot) and each layer mounts
// into its own full-size container there. Layers exist only on the real player
// page — never in previews, the OBS source or the export window — so their
// context reads the live playback state directly: the displayed lyrics and
// song, the lyric clock, and the current line.
//
// The part that reads those stores lives in ./stageLayerView and is loaded
// lazily, only once some layer exists: VisualizerShell renders a slot in every
// window (export page and OBS included), and a static import would drag the
// playback store and its dependency graph into those bundles.

const STAGE_SLOTS: readonly FoliumStageSlot[] = ['player.stage.back', 'player.stage.front', 'app.overlay'];

export const stageLayersRegistry = createFoliumRegistry<FoliumStageLayerDef>('stageLayers', {
    validate: (def) => {
        if (!STAGE_SLOTS.includes(def.slot)) {
            throw new Error(`stageLayers.register: slot must be one of ${STAGE_SLOTS.join(', ')}`);
        }
        if (typeof def.mount !== 'function') {
            throw new Error('stageLayers.register: mount must be a function');
        }
        return def;
    },
});

const LazyStageLayerSlotView = React.lazy(() => import('./stageLayerView'));

/*
 * One stage slot. Renders nothing (not even a wrapper, and no chunk load) while
 * no mod has a layer there, so the host tree and bundles are unchanged for
 * users without mods.
 */
export const FoliumStageLayerSlot: React.FC<{
    slot: FoliumStageSlot;
    theme: Theme;
    isDaylight: boolean;
    paused: boolean;
    className?: string;
}> = (props) => {
    const entries = useFoliumRegistryEntries(stageLayersRegistry);
    if (!entries.some((entry) => entry.def.slot === props.slot)) return null;
    return (
        <Suspense fallback={null}>
            <LazyStageLayerSlotView {...props} />
        </Suspense>
    );
};
