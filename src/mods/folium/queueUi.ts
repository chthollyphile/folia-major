import type { FoliumMount, FoliumSong } from './contract';
import { createFoliumRegistry, type FoliumRegistryEntry } from './registry';

// src/mods/folium/queueUi.ts
// Unfrozen, append-only queue contributions; no native action identifiers or editors.
export type QueueUiSurface = 'panel' | 'command' | 'wall' | 'lattice';
export type QueueUiPlacement = 'header' | 'overline' | 'trailing';
export interface QueueUiEntryContext {
    readonly song: FoliumSong;
    /** Original host queue position, never the filtered result position. */
    readonly index: number;
    readonly surface: QueueUiSurface;
}
export interface QueueUiMountContext {
    readonly surface: QueueUiSurface;
    readonly placement: QueueUiPlacement;
    readonly locale: string;
    readonly isDaylight: boolean;
    readonly entry: QueueUiEntryContext | null;
    /** False after unregistering, replacing the component or changing its queue occurrence. */
    isCurrent(): boolean;
    /** Guards a mod-owned handler against stale occurrences and reports errors against its owner. */
    run(handler: () => void | Promise<void>): Promise<boolean>;
}
export interface QueueUiComponent {
    id: string;
    /** Reserved inline size in CSS pixels; overlines fill the text area instead. */
    width?: number;
    mount: FoliumMount<QueueUiMountContext>;
}
export interface QueueUiExtension {
    id: string;
    getHeaderContent?(surface: QueueUiSurface): readonly QueueUiComponent[];
    /** Reserve an overline without inspecting every virtualized queue entry. */
    getEntryLayout?(surface: QueueUiSurface): 'plain' | 'overline';
    getEntryContent?(context: QueueUiEntryContext): { overline?: QueueUiComponent; trailing?: readonly QueueUiComponent[] } | null;
    /** Signals structural changes. Components can subscribe to their mod's own state inside mount. */
    subscribe?(notify: () => void): () => void;
}
export interface QueueUiComponentView extends QueueUiComponent {
    readonly modId: string;
    readonly context: Omit<QueueUiMountContext, 'locale' | 'isDaylight'>;
}
export interface QueueUiEntryContent {
    readonly overlines: readonly QueueUiComponentView[];
    readonly trailing: readonly QueueUiComponentView[];
}
interface StoredQueueUi {
    extension: Readonly<QueueUiExtension>;
    dispose?: () => void;
    errors: Set<string>;
}
export interface QueueUiSnapshot {
    readonly revision: number;
    readonly entries: readonly FoliumRegistryEntry<StoredQueueUi>[];
}
const listeners = new Set<() => void>();
let snapshot: QueueUiSnapshot = Object.freeze({ revision: 0, entries: Object.freeze([]) });
const publish = () => {
    snapshot = Object.freeze({ revision: snapshot.revision + 1, entries: queueUiRegistry.list() });
    for (const listener of listeners) {
        try { listener(); } catch (error) { console.warn('[Folium] queue.ui listener failed', error); }
    }
};
export const queueUiRegistry = createFoliumRegistry<QueueUiExtension, StoredQueueUi>('queue.ui', {
    validate: (def) => {
        for (const name of ['getHeaderContent', 'getEntryLayout', 'getEntryContent', 'subscribe'] as const) {
            if (def[name] !== undefined && typeof def[name] !== 'function') throw new TypeError(`queue.ui: ${name} must be a function`);
        }
        if (!def.getHeaderContent && !def.getEntryContent) throw new TypeError('queue.ui: a content provider is required');
        return { extension: Object.freeze({ ...def }), errors: new Set() };
    },
    onAdd: (entry) => {
        if (!entry.def.extension.subscribe) return;
        const dispose = entry.def.extension.subscribe(() => {
            // Ignore synchronous subscribe notifications until the registry publishes this entry.
            if (queueUiRegistry.get(entry.id) !== entry || !queueUiRegistry.list().includes(entry)) return;
            entry.def.errors.clear();
            publish();
        });
        if (typeof dispose !== 'function') throw new TypeError('queue.ui: subscribe must return a disposer');
        entry.def.dispose = dispose;
    },
    onRemove: (entry) => entry.def.dispose?.(),
});
queueUiRegistry.subscribe(publish);
export const getQueueUiSnapshot = () => snapshot;
export const subscribeQueueUi = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
