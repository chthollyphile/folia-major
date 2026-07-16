import type { LocalLibraryAssignment, LocalLibraryEntity, LocalLibraryEntityKind } from '../types/localLibrary';
import { appDatabase } from './appDatabase';

// src/services/localLibraryEntityRepository.ts
// Exposes typed entity reads used by catalog transactions and local-library UI adapters.

export const getLocalLibraryEntities = async (kind?: LocalLibraryEntityKind): Promise<LocalLibraryEntity[]> => (
  kind
    ? await appDatabase.local_library_entities.where('kind').equals(kind).toArray()
    : await appDatabase.local_library_entities.toArray()
);

export const getLocalLibraryAssignments = async (): Promise<LocalLibraryAssignment[]> => (
  await appDatabase.local_library_assignments.toArray()
);

export const getLocalLibraryAssignment = async (songId: string): Promise<LocalLibraryAssignment | undefined> => (
  await appDatabase.local_library_assignments.get(songId)
);

// Reads both entity tables in one transaction so consumers never combine different catalog revisions.
export const getLocalLibraryCatalogSnapshot = async (): Promise<{
  entities: LocalLibraryEntity[];
  assignments: LocalLibraryAssignment[];
}> => appDatabase.transaction(
  'r',
  [appDatabase.local_library_entities, appDatabase.local_library_assignments],
  async () => ({
    entities: await appDatabase.local_library_entities.toArray(),
    assignments: await appDatabase.local_library_assignments.toArray(),
  }),
);

export const resolveEntityRedirect = async (entityId: string): Promise<LocalLibraryEntity | undefined> => {
  const visited = new Set<string>();
  let entity = await appDatabase.local_library_entities.get(entityId);
  while (entity?.mergedInto && !visited.has(entity.id)) {
    visited.add(entity.id);
    entity = await appDatabase.local_library_entities.get(entity.mergedInto);
  }
  return entity;
};

