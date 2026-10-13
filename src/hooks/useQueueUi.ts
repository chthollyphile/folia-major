import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { SongResult } from '../types';
import { getQueueUiSnapshot, subscribeQueueUi, type QueueUiSurface } from '../mods/folium/queueUi';
import { readQueueUiEntry, readQueueUiHeader, readQueueUiLayout } from '../mods/folium/queueUiContent';

// src/hooks/useQueueUi.ts
// UI subscribers share the registration's one provider subscription and lazy entry cache.
export function useQueueUi(queue: readonly SongResult[], surface: QueueUiSurface) {
    const snapshot = useSyncExternalStore(subscribeQueueUi, getQueueUiSnapshot, getQueueUiSnapshot);
    const headerContent = useMemo(() => readQueueUiHeader(surface), [snapshot, surface]);
    const entryLayout = useMemo(() => readQueueUiLayout(surface), [snapshot, surface]);
    const readEntry = useCallback((index: number) => readQueueUiEntry(queue, index, surface), [snapshot, queue, surface]);
    return { headerContent, readEntry, entryLayout, hasEntryExtensions: snapshot.entries.some(entry => Boolean(entry.def.extension.getEntryContent)) };
}
