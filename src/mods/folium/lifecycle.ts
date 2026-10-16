import { reportFoliumIssue } from './status';

// src/mods/folium/lifecycle.ts
// Services participate in the same owner-based cleanup as registries and event handlers.
const disposers = new Map<string, Set<() => void>>();
export function registerFoliumServiceDisposer(modId: string, dispose: () => void) {
    if (!disposers.has(modId)) disposers.set(modId, new Set());
    disposers.get(modId)!.add(dispose);
}
export function disposeFoliumServices(modId: string) {
    const owned = disposers.get(modId);
    disposers.delete(modId);
    for (const dispose of owned ?? []) {
        try {
            dispose();
        } catch (error) {
            reportFoliumIssue(modId, 'service dispose', error);
        }
    }
}
