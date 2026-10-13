import type { SongResult } from '../../types';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { toFoliumSong } from './dto';
import { reportFoliumIssue } from './status';
import { getQueueUiSnapshot, queueUiRegistry, type QueueUiComponent, type QueueUiComponentView,
    type QueueUiEntryContent, type QueueUiEntryContext, type QueueUiPlacement, type QueueUiSurface } from './queueUi';

// src/mods/folium/queueUiContent.ts
// Validates append-only component mounts without knowing their markup, icons or business actions.
const empty: QueueUiEntryContent = Object.freeze({ overlines: Object.freeze([]), trailing: Object.freeze([]) });
const localId = /^[a-z0-9][a-z0-9-]*$/;
type Entry = ReturnType<typeof queueUiRegistry.list>[number];
type Input = { queue: readonly SongResult[]; index: number; surface: QueueUiSurface };
let cachedRevision = -1;
let cache = new WeakMap<readonly SongResult[], Map<string, QueueUiEntryContent>>();
const components = (value: unknown, overline = false): readonly QueueUiComponent[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 8) throw new TypeError('queue.ui: at most eight components per slot');
    const ids = new Set<string>();
    return Array.from(value, component => {
        if (!component || typeof component.id !== 'string' || !localId.test(component.id)
            || ids.has(component.id) || typeof component.mount !== 'function') throw new TypeError('queue.ui: invalid or duplicate component');
        if (!overline && (!Number.isFinite(component.width) || component.width < 1 || component.width > 512)) {
            throw new TypeError('queue.ui: component width must be between 1 and 512 CSS pixels');
        }
        ids.add(component.id);
        return Object.freeze({ id: component.id, width: overline ? undefined : component.width, mount: component.mount });
    });
};
const report = (entry: Entry, error: unknown) => {
    const key = error instanceof Error ? error.message : String(error);
    if (entry.def.errors.has(key) || entry.def.errors.size >= 20) return;
    entry.def.errors.add(key);
    // Providers are read during render: do not update the status store inside that render.
    queueMicrotask(() => { if (queueUiRegistry.get(entry.id) === entry) reportFoliumIssue(entry.modId, 'queue.ui', error); });
};
const context = ({ queue, index, surface }: Input): QueueUiEntryContext => Object.freeze({
    song: Object.freeze(toFoliumSong(queue[index])!), index, surface,
});
const read = (entry: Entry, surface: QueueUiSurface, input?: Input) => {
    try {
        if (!input) return { overlines: [], trailing: components(entry.def.extension.getHeaderContent?.(surface)) };
        const content = entry.def.extension.getEntryContent?.(context(input));
        if (content == null) return { overlines: [], trailing: [] };
        if (typeof content !== 'object' || Array.isArray(content)) throw new TypeError('queue.ui: invalid entry content');
        return { overlines: components(content.overline === undefined ? undefined : [content.overline], true),
            trailing: components(content.trailing) };
    } catch (error) { report(entry, error); return { overlines: [], trailing: [] }; }
};
const view = (entry: Entry, component: QueueUiComponent, surface: QueueUiSurface, placement: QueueUiPlacement, input?: Input): QueueUiComponentView => {
    const song = input?.queue[input.index];
    const stillOwned = () => queueUiRegistry.get(entry.id) === entry
        && (!input || (usePlaybackStore.getState().playQueue === input.queue && input.queue[input.index] === song));
    const isCurrent = () => {
        if (!stillOwned()) return false;
        const latest = read(entry, surface, input)[placement === 'overline' ? 'overlines' : 'trailing'];
        return latest.some(next => next.id === component.id && next.mount === component.mount) && stillOwned();
    };
    return Object.freeze({ ...component, id: `${entry.id}:${component.id}`, modId: entry.modId,
        context: Object.freeze({ surface, placement, entry: input ? context(input) : null, isCurrent,
            run: async (handler: () => void | Promise<void>) => {
                if (!isCurrent()) return false;
                try { await handler(); return true; } catch (error) { report(entry, error); return false; }
            },
        }),
    });
};
export const readQueueUiHeader = (surface: QueueUiSurface): readonly QueueUiComponentView[] => Object.freeze(
    getQueueUiSnapshot().entries.flatMap(entry => read(entry, surface).trailing.map(component => view(entry, component, surface, 'header'))),
);
/** Layout declarations avoid scanning a large queue merely to size its virtual rows. */
export const readQueueUiLayout = (surface: QueueUiSurface): 'plain' | 'overline' => {
    let overline = false;
    for (const entry of getQueueUiSnapshot().entries) {
        if (!entry.def.extension.getEntryContent) continue;
        try {
            const layout = entry.def.extension.getEntryLayout?.(surface) ?? 'overline';
            if (layout !== 'plain' && layout !== 'overline') throw new TypeError('queue.ui: invalid entry layout');
            if (layout === 'overline') overline = true;
        } catch (error) { report(entry, error); }
    }
    return overline ? 'overline' : 'plain';
};
export const readQueueUiEntry = (queue: readonly SongResult[], index: number, surface: QueueUiSurface): QueueUiEntryContent => {
    const snapshot = getQueueUiSnapshot();
    if (!snapshot.entries.length || !Number.isInteger(index) || index < 0 || index >= queue.length) return empty;
    if (snapshot.revision !== cachedRevision) { cachedRevision = snapshot.revision; cache = new WeakMap(); }
    const key = `${surface}:${index}`;
    let entries = cache.get(queue);
    if (!entries) { entries = new Map(); cache.set(queue, entries); }
    const cached = entries.get(key);
    if (cached) return cached;
    const input: Input = { queue, index, surface };
    const overlines: QueueUiComponentView[] = [], trailing: QueueUiComponentView[] = [];
    for (const entry of snapshot.entries) {
        const content = read(entry, surface, input);
        overlines.push(...content.overlines.map(component => view(entry, component, surface, 'overline', input)));
        trailing.push(...content.trailing.map(component => view(entry, component, surface, 'trailing', input)));
    }
    const result = Object.freeze({ overlines: Object.freeze(overlines), trailing: Object.freeze(trailing) });
    entries.set(key, result);
    return result;
};
