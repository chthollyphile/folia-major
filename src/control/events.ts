import { CONTROL_EVENT_TYPES } from '../../shared/controlCatalog.mjs';
import { useAppViewStore } from '../stores/useAppViewStore';
import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { useSettingsModalStore } from '../stores/useSettingsModalStore';
import { useThemeSettingsStore } from '../stores/useThemeSettingsStore';
import { useVisualizerSettingsStore } from '../stores/useVisualizerSettingsStore';
import { queueIndexOf } from '../utils/playbackNeighbors';
import { playbackStateName, summarizeSong } from './helpers';
import { CONTROL_EVENT_TYPE_VALUES } from './types';
import type {
    ControlEvent,
    ControlEventStore,
    ControlEventType,
    ControlEventsQuery,
    ControlEventsResult,
} from './types';

// src/control/events.ts
// The control event stream: a 500-entry ring buffer plus the store subscriptions that fill it.
// Event type names come from shared/controlCatalog.mjs; the sequence starts at 1 and never resets.

const RING_CAPACITY = 500;
const CATALOG_EVENT_TYPES: ReadonlySet<string> = new Set(CONTROL_EVENT_TYPES as string[]);
const DECLARED_EVENT_TYPES: ReadonlySet<string> = new Set(CONTROL_EVENT_TYPE_VALUES);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_WAIT_MS = 10_000;

/** The in-memory event log behind folia_events and bridge.events(). */
export class ControlEventRing implements ControlEventStore {
    private readonly capacity: number;

    private buffer: ControlEvent[] = [];

    private nextSeq = 1;

    private readonly listeners = new Set<() => void>();

    constructor(capacity = RING_CAPACITY) {
        this.capacity = Math.max(1, Math.trunc(capacity));
    }

    record(type: ControlEventType, data: Record<string, unknown>): void {
        if (!DECLARED_EVENT_TYPES.has(type) || !CATALOG_EVENT_TYPES.has(type)) {
            throw new Error(`[Control] Undeclared control event type "${String(type)}"`);
        }
        const event: ControlEvent = {
            seq: this.nextSeq,
            ts: Date.now(),
            type,
            data,
        };
        this.nextSeq += 1;
        this.buffer.push(event);
        if (this.buffer.length > this.capacity) {
            this.buffer.splice(0, this.buffer.length - this.capacity);
        }
        this.listeners.forEach(listener => listener());
    }

    currentSeq(): number {
        return this.nextSeq - 1;
    }

    async read({ since, limit = DEFAULT_LIMIT, waitMs = 0 }: ControlEventsQuery = {}): Promise<ControlEventsResult> {
        const pageSize = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)));
        if (since === undefined) {
            return { cursor: this.currentSeq(), events: [] };
        }

        const start = Math.max(0, Math.trunc(since));
        const wait = Math.min(MAX_WAIT_MS, Math.max(0, Math.trunc(waitMs)));
        if (wait > 0 && this.buffer.every(event => event.seq <= start)) {
            await this.waitForChange(wait);
        }

        const events = this.buffer.filter(event => event.seq > start).slice(0, pageSize);
        const cursor = events.length > 0 ? events[events.length - 1]!.seq : Math.max(start, this.currentSeq());
        return { cursor, events };
    }

    private waitForChange(timeoutMs: number): Promise<void> {
        return new Promise(resolve => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                this.listeners.delete(finish);
                clearTimeout(timer);
                resolve();
            };
            const timer: ReturnType<typeof setTimeout> = setTimeout(finish, timeoutMs);
            this.listeners.add(finish);
        });
    }
}

export const createControlEventRing = (capacity = RING_CAPACITY): ControlEventRing => new ControlEventRing(capacity);

const playbackEventData = {
    songChanged: (song: ReturnType<typeof summarizeSong> | null) => ({ song }),
    stateChanged: (state: string, isLoadingToPlay: boolean, isFmMode: boolean) => ({ state, isLoadingToPlay, isFmMode }),
    queueChanged: (length: number, currentIndex: number) => ({ length, currentIndex }),
};

const themeSnapshot = () => {
    const state = useThemeSettingsStore.getState();
    return {
        daylight: state.isDaylight,
        followSystemTheme: state.followSystemTheme,
        coverColorBg: state.useCoverColorBg,
        staticMode: state.staticMode,
        disableHomeDynamicBackground: state.disableHomeDynamicBackground,
    };
};

const viewSnapshot = () => {
    const view = useAppViewStore.getState();
    return {
        view: view.view,
        panelOpen: view.isPanelOpen,
        panelTab: view.panelTab,
        settingsOpen: useSettingsModalStore.getState().settingsModalState.isOpen,
    };
};

/**
 * Subscribes the stores PROTOCOL §2.3 names and records their changes in the ring.
 * Returns the unsubscribe function; ControlHost's unmount tears the bridge down with it.
 */
export const subscribeControlStoreEvents = (events: ControlEventStore): (() => void) => {
    const unsubscribers: Array<() => void> = [];

    unsubscribers.push(usePlaybackStore.subscribe((state, previous) => {
        if (state.currentSong !== previous.currentSong) {
            events.record('playback.songChanged', playbackEventData.songChanged(
                state.currentSong ? summarizeSong(state.currentSong) : null,
            ));
        }
        if (state.playerState !== previous.playerState || state.isLoadingToPlay !== previous.isLoadingToPlay) {
            events.record('playback.stateChanged', playbackEventData.stateChanged(
                playbackStateName(state.playerState),
                state.isLoadingToPlay,
                state.isFmMode,
            ));
        }
        if (state.playQueue !== previous.playQueue) {
            events.record('playback.queueChanged', playbackEventData.queueChanged(
                state.playQueue.length,
                queueIndexOf(state.playQueue, state.currentSong),
            ));
        }
    }));

    unsubscribers.push(useAudioSettingsStore.subscribe((state, previous) => {
        if (state.volume !== previous.volume || state.isMuted !== previous.isMuted) {
            events.record('playback.volumeChanged', {
                level: state.volume,
                percent: Math.round(state.volume * 100),
                muted: state.isMuted,
            });
        }
        if (state.loopMode !== previous.loopMode) {
            events.record('playback.loopModeChanged', { mode: state.loopMode });
        }
    }));

    unsubscribers.push(useVisualizerSettingsStore.subscribe((state, previous) => {
        if (state.visualizerMode !== previous.visualizerMode) {
            events.record('visualizer.modeChanged', { mode: state.visualizerMode });
        }
        if (state.visualizerBackgroundMode !== previous.visualizerBackgroundMode) {
            events.record('visualizer.backgroundChanged', { background: state.visualizerBackgroundMode });
        }
    }));

    unsubscribers.push(useThemeSettingsStore.subscribe((state, previous) => {
        const changed = state.isDaylight !== previous.isDaylight
            || state.followSystemTheme !== previous.followSystemTheme
            || state.useCoverColorBg !== previous.useCoverColorBg
            || state.staticMode !== previous.staticMode
            || state.disableHomeDynamicBackground !== previous.disableHomeDynamicBackground;
        if (changed) {
            events.record('theme.changed', themeSnapshot());
        }
    }));

    unsubscribers.push(useAppViewStore.subscribe((state, previous) => {
        if (state.view !== previous.view
            || state.isPanelOpen !== previous.isPanelOpen
            || state.panelTab !== previous.panelTab) {
            events.record('view.changed', viewSnapshot());
        }
    }));

    unsubscribers.push(useSettingsModalStore.subscribe((state, previous) => {
        if (state.settingsModalState.isOpen !== previous.settingsModalState.isOpen) {
            events.record('view.changed', viewSnapshot());
        }
    }));

    return () => unsubscribers.forEach(unsubscribe => unsubscribe());
};
