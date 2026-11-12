import type { FoliumEventMap } from './contract';
import type { FOLIUM_EXPERIMENTAL } from './shared';

// src/mods/folium/eventTypes.ts
// The one table of the event types a mod can listen to with `folium.events.on`:
// one row per member of FoliumEventMap in contract.ts. Each row says how its
// handlers run and which experimental opt-in a mod must declare to listen.
// `folium.events.on` (api.ts) refuses a name that has no row, and checks the
// opt-in from the row.
//
// Like kinds.ts, this file has only facts and imports nothing at run time, so
// the tools under dev/folium/ can import it straight into Node.
//
// Adding an event: its payload in contract.ts (under FoliumNotificationEvents
// or FoliumHookEvents), one row here (the compiler asks for it), and the place
// in the host that emits or dispatches it.

/** An experimental opt-in a mod declares in mod.json `experimental`, e.g. 'omni.hooks'. */
type FoliumExperimentalName = (typeof FOLIUM_EXPERIMENTAL)[keyof typeof FOLIUM_EXPERIMENTAL];

export interface FoliumEventType {
    /**
     * How the handlers run. 'notification': after the fact, each handler sees the same frozen
     * payload and nothing is awaited. 'hook': one event object passes through every handler in
     * priority order, and each may change it.
     */
    dispatch: 'notification' | 'hook';
    /** The experimental opt-in a mod must declare in mod.json to listen to this event, or null. */
    experimental: FoliumExperimentalName | null;
}

export const FOLIUM_EVENT_TYPES = {
    'playback.songChanged': { dispatch: 'notification', experimental: null },
    'playback.stateChanged': { dispatch: 'notification', experimental: null },
    'playback.seeked': { dispatch: 'notification', experimental: null },
    'lyrics.loaded': { dispatch: 'notification', experimental: null },
    'app.viewChanged': { dispatch: 'notification', experimental: null },
    'visualizer.modeChanged': { dispatch: 'notification', experimental: null },
    'theme.changed': { dispatch: 'notification', experimental: null },
    'playback.likeChanged': { dispatch: 'notification', experimental: null },
    'playback.volumeChanged': { dispatch: 'notification', experimental: null },
    'playback.loopModeChanged': { dispatch: 'notification', experimental: null },
    'playback.queueChanged': { dispatch: 'notification', experimental: null },
    'playback.failed': { dispatch: 'notification', experimental: null },
    'account.changed': { dispatch: 'notification', experimental: null },
    'equalizer.changed': { dispatch: 'notification', experimental: null },
    'visualizer.renderQualityChanged': { dispatch: 'notification', experimental: null },
    'visualizer.tuningChanged': { dispatch: 'notification', experimental: null },
    'visualizer.beatEffectsChanged': { dispatch: 'notification', experimental: null },
    'visualizer.backgroundChanged': { dispatch: 'notification', experimental: null },
    'visualizer.animationIntensityChanged': { dispatch: 'notification', experimental: null },
    'lyrics.transform': { dispatch: 'hook', experimental: null },
    'playback.beforePlay': { dispatch: 'hook', experimental: null },
    'omni.lyricsResolved': { dispatch: 'hook', experimental: 'omni.hooks' },
    'omni.audioSourceResolved': { dispatch: 'hook', experimental: 'omni.hooks' },
} as const satisfies Record<keyof FoliumEventMap, FoliumEventType>;
