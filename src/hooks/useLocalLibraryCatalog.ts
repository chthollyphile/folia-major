import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LocalLibraryAssignment, LocalLibraryEntity } from '../types/localLibrary';
import { ensureLocalLibraryInitialized } from '../services/localLibraryCatalogService';
import { getLocalLibraryAssignments, getLocalLibraryEntities } from '../services/localLibraryEntityRepository';

// src/hooks/useLocalLibraryCatalog.ts
// Refreshes the lightweight entity catalog whenever the owning local-song list changes.

export interface LocalLibraryCatalogSnapshot {
  entities: LocalLibraryEntity[];
  assignments: LocalLibraryAssignment[];
  ready: boolean;
  /** The catalog could not be read, and there is none from before: `ready` does not come by waiting. */
  failed: boolean;
  reload: () => Promise<void>;
}

export const useLocalLibraryCatalog = (refreshKey: unknown): LocalLibraryCatalogSnapshot => {
  const [catalog, setCatalog] = useState<Omit<LocalLibraryCatalogSnapshot, 'reload'>>({
    entities: [],
    assignments: [],
    ready: false,
    failed: false,
  });

  const reload = useCallback(async () => {
    await ensureLocalLibraryInitialized();
    const [entities, assignments] = await Promise.all([
      getLocalLibraryEntities(),
      getLocalLibraryAssignments(),
    ]);
    setCatalog({ entities, assignments, ready: true, failed: false });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await ensureLocalLibraryInitialized();
      const [entities, assignments] = await Promise.all([
        getLocalLibraryEntities(),
        getLocalLibraryAssignments(),
      ]);
      if (!cancelled) setCatalog({ entities, assignments, ready: true, failed: false });
    })().catch(error => {
      console.error('[LocalLibrary] Failed to load entity catalog', error);
      // A catalog read before stays the one in use.
      if (!cancelled) setCatalog(current => (current.ready ? current : { ...current, failed: true }));
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, reload]);

  return useMemo(() => ({ ...catalog, reload }), [catalog, reload]);
};
