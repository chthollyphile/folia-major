import type {
  LocalLibraryAssignment,
  LocalLibraryAssignmentOrigin,
  LocalLibraryEntity,
} from '../types/localLibrary';
import { resolveLocalLibraryEntity } from '../utils/localLibraryResolver';

// src/services/localLibraryCatalogInternals.ts
// Shares identity creation and assignment construction across focused catalog transaction modules.

export const createLocalLibraryEntityId = () => (
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `local-entity-${Date.now()}-${Math.random().toString(36).slice(2)}`
);

export const appendUnique = <T>(values: T[]): T[] => Array.from(new Set(values));

export const resolveEntityNames = (
  entities: LocalLibraryEntity[],
  kind: 'artist' | 'album',
  names: string[],
  preferredEntityIds: string[] = [],
): string[] => {
  const ids: string[] = [];
  names.forEach(name => {
    const resolved = resolveLocalLibraryEntity({
      entities,
      kind,
      name,
      preferredEntityIds,
      createId: createLocalLibraryEntityId,
    });
    if (!resolved) return;
    if (resolved.created) entities.push(resolved.entity);
    ids.push(resolved.entity.id);
  });
  return appendUnique(ids);
};

export const createLocalLibraryAssignment = (
  songId: string,
  artistEntityIds: string[],
  albumEntityId: string | undefined,
  origin: LocalLibraryAssignmentOrigin,
): LocalLibraryAssignment => ({
  songId,
  artistEntityIds,
  artistOrigin: origin,
  albumEntityId,
  albumOrigin: origin,
  updatedAt: Date.now(),
});

