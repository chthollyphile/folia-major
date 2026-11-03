import { create } from 'zustand';

// src/components/command-palette/globalShortcuts/globalShortcutStatusStore.ts
// What the main process answered the last time the shortcuts were registered: whether the desktop
// portal handles them, and which accelerators the system refused. The settings rows read it; the
// registering hook writes it. Not persisted: it is a fact about this run.

export type GlobalShortcutBackend = 'native' | 'portal';

type GlobalShortcutStatusState = {
    /** Null until the main process has answered once (and always on web). */
    backend: GlobalShortcutBackend | null;
    /** Accelerators the system would not give us, usually because another program holds them. */
    refused: ReadonlyArray<string>;
    setBackend: (backend: GlobalShortcutBackend) => void;
    publish: (answer: { backend: GlobalShortcutBackend; results: ReadonlyArray<{ accelerator: string; registered: boolean }> }) => void;
};

export const useGlobalShortcutStatusStore = create<GlobalShortcutStatusState>((set) => ({
    backend: null,
    refused: [],
    setBackend: (backend) => set({ backend }),
    publish: (answer) => set({
        backend: answer.backend,
        refused: answer.results.filter(result => !result.registered).map(result => result.accelerator),
    }),
}));
